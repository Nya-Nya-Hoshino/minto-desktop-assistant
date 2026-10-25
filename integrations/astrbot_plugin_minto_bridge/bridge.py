"""External OneBot v11 bridge. Only Python standard-library dependencies.

Protocol names/layouts are pinned in README.md; never reconstruct raw events
from display names, MessageChain components, or forwarded message contents.
"""
import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
import http.client
import io
import ipaddress
import json
import re
import socket
import sqlite3
import time
from urllib.parse import quote, urljoin, urlsplit
import wave

IMAGE_LIMIT = 2 * 1024 * 1024
WAV_LIMIT = 10 * 1024 * 1024
JSON_LIMIT = 14 * 1024 * 1024
API_TIMEOUT = 12


def decimal_id(value, signed=False):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError('Invalid numeric identifier')
    text = str(value)
    if not re.fullmatch(r'-?[0-9]+' if signed else r'[0-9]+', text):
        raise ValueError('Invalid numeric identifier')
    if len(text) > 20:
        raise ValueError('Numeric identifier too long')
    return text


def image_type(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return None


def public_address(host, port):
    answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not answers:
        raise ValueError('Image host has no address')
    for answer in answers:
        ip = ipaddress.ip_address(answer[4][0])
        if not ip.is_global or ip.is_multicast or ip.is_unspecified:
            raise ValueError('Image host is not globally routable')
    return answers[0]


def bounded_read(response, limit, deadline):
    length = response.getheader('Content-Length')
    if length is not None and (not length.isdecimal() or int(length) > limit):
        raise ValueError('HTTP response exceeds size limit')
    chunks = []
    size = 0
    while True:
        if time.monotonic() >= deadline:
            raise TimeoutError('HTTP response deadline exceeded')
        chunk = response.read(min(65536, limit + 1 - size))
        if not chunk:
            return b''.join(chunks)
        size += len(chunk)
        if size > limit:
            raise ValueError('HTTP response exceeds size limit')
        chunks.append(chunk)


def download_image(url):
    """No proxy, credentials, local files, private DNS, rebinding or redirects to LAN."""
    deadline = time.monotonic() + 10
    for _ in range(4):
        if not isinstance(url, str) or len(url) > 8192:
            raise ValueError('Invalid image URL')
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname:
            raise ValueError('Unsupported image URL')
        if parsed.username is not None or parsed.password is not None:
            raise ValueError('Image URL credentials forbidden')
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        address = public_address(parsed.hostname, port)
        timeout = min(3, deadline - time.monotonic())
        if timeout <= 0:
            raise TimeoutError('Image deadline exceeded')
        connection_type = http.client.HTTPSConnection if parsed.scheme == 'https' else http.client.HTTPConnection
        connection = connection_type(parsed.hostname, port, timeout=timeout)

        def pinned_connection(_address, timeout=timeout, source_address=None):
            sock = socket.socket(address[0], address[1], address[2])
            sock.settimeout(timeout)
            try:
                sock.connect(address[4])
            except BaseException:
                sock.close()
                raise
            return sock

        # HTTPSConnection still validates TLS against the original hostname.
        connection._create_connection = pinned_connection
        try:
            path = parsed.path or '/'
            if parsed.query:
                path += '?' + parsed.query
            connection.request('GET', path, headers={'Accept': 'image/jpeg,image/png,image/webp',
                                                      'Accept-Encoding': 'identity'})
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader('Location')
                if not location:
                    raise ValueError('Image redirect has no location')
                url = urljoin(url, location)
                continue
            if response.status != 200 or response.getheader('Content-Encoding', 'identity') != 'identity':
                raise ValueError('Image response rejected')
            data = bounded_read(response, IMAGE_LIMIT, deadline)
            if not image_type(data):
                raise ValueError('Unsupported image bytes')
            return data
        finally:
            connection.close()
    raise ValueError('Too many image redirects')


class LocalClient:
    def __init__(self, url, token):
        parsed = urlsplit(url)
        if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or
                not parsed.port or parsed.username is not None or
                parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise ValueError('Pairing URL must be http://127.0.0.1:<port>')
        if not isinstance(token, str) or not 16 <= len(token) <= 4096 or not token.isascii() or any(c.isspace() for c in token):
            raise ValueError('Invalid pairing token')
        self.port = parsed.port
        self._token = token
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix='minto-bridge')
        self.slots = asyncio.Semaphore(4)
        self.closed = False

    async def blocking(self, function, *args):
        if self.closed:
            raise RuntimeError('Bridge transport closed')
        await asyncio.wait_for(self.slots.acquire(), timeout=0.1)
        try:
            future = asyncio.get_running_loop().run_in_executor(self.pool, function, *args)
        except BaseException:
            self.slots.release()
            raise
        def complete(result):
            self.slots.release()
            if not result.cancelled():
                # Timed-out awaiters cannot retrieve late worker failures. Consume
                # them here so asyncio never logs a remote error body or secret.
                result.exception()
        # A timeout leaves the worker slot occupied until the real worker exits.
        future.add_done_callback(complete)
        return await asyncio.wait_for(asyncio.shield(future), API_TIMEOUT)

    def request(self, method, path, body, limit):
        if not path.startswith('/v1/') or '\r' in path or '\n' in path:
            raise ValueError('Invalid local bridge path')
        data = None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
        if data is not None and len(data) > JSON_LIMIT:
            raise ValueError('Local request exceeds size limit')
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            connection.request(method, path, body=data, headers={
                'Authorization': 'Bearer ' + self._token,
                'Content-Type': 'application/json', 'Accept-Encoding': 'identity'})
            response = connection.getresponse()
            if response.status != 200:
                raise ConnectionError('Local bridge HTTP status ' + str(response.status))
            return bounded_read(response, limit, time.monotonic() + 10)
        finally:
            connection.close()

    async def json(self, method, path, body=None):
        data = await self.blocking(self.request, method, path, body, JSON_LIMIT)
        try:
            result = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            raise ValueError('Invalid local JSON response') from None
        if not isinstance(result, dict):
            raise ValueError('Invalid local JSON response')
        return result

    async def media(self, media_id):
        if not isinstance(media_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', media_id):
            raise ValueError('Invalid media identifier')
        return await self.blocking(self.request, 'GET', '/v1/media/' + quote(media_id, safe=''), None, WAV_LIMIT)

    def close(self):
        self.closed = True
        self.pool.shutdown(wait=False, cancel_futures=True)


class DeliveryJournal:
    """Keep acknowledged IDs too, so a stale lease can never repeat a send.

    Reservation is durable before side effects. Interrupted reservations fail
    closed because OneBot v11 has no standard idempotency key for send APIs.
    """
    def __init__(self, path, bot_id):
        self.db = sqlite3.connect(str(path))
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS deliveries (bot_id TEXT, id TEXT, result TEXT, acked INTEGER DEFAULT 0, PRIMARY KEY(bot_id,id))')
        self.bot_id = bot_id
        with self.db:
            self.db.execute('UPDATE deliveries SET result=? WHERE bot_id=? AND result IS NULL',
                            (json.dumps({'ok': False, 'error': 'Delivery interrupted; outcome unknown; not resent'}), bot_id))

    def get(self, item_id):
        row = self.db.execute('SELECT result FROM deliveries WHERE bot_id=? AND id=?', (self.bot_id, item_id)).fetchone()
        return json.loads(row[0]) if row and row[0] is not None else None

    def reserve(self, item_id):
        with self.db:
            if self.db.execute('SELECT COUNT(*) FROM deliveries').fetchone()[0] >= 50000:
                raise RuntimeError('Delivery journal full; manual archive required')
            self.db.execute('INSERT INTO deliveries(bot_id,id) VALUES(?,?)', (self.bot_id, item_id))

    def finish(self, item_id, result):
        with self.db:
            self.db.execute('UPDATE deliveries SET result=? WHERE bot_id=? AND id=?',
                            (json.dumps(result), self.bot_id, item_id))

    def pending(self):
        return [(row[0], json.loads(row[1])) for row in self.db.execute(
            'SELECT id,result FROM deliveries WHERE bot_id=? AND acked=0 AND result IS NOT NULL LIMIT 100', (self.bot_id,))]

    def acknowledge(self, item_id):
        with self.db:
            self.db.execute('UPDATE deliveries SET acked=1 WHERE bot_id=? AND id=?', (self.bot_id, item_id))

    def close(self):
        self.db.close()


class Bridge:
    def __init__(self, bot_id, bot, local, journal_path, warn=None):
        self.bot_id = decimal_id(bot_id)
        self.bot = bot
        self.local = local
        self.journal = DeliveryJournal(journal_path, self.bot_id)
        self.warn = warn or (lambda message: None)
        self.event_slots = asyncio.Semaphore(4)
        self.delivery_lock = asyncio.Lock()
        self.task = None
        self.closed = False
        self.history_enabled = False
        self.history_keywords = ('薄荷', 'ミント')
        self.history_cache = {}

    async def action(self, action, **params):
        return await asyncio.wait_for(self.bot.call_action(action, self_id=int(self.bot_id), **params), API_TIMEOUT)

    async def fetch_image(self, url):
        return await self.local.blocking(download_image, url)

    def valid_event(self, raw):
        if not isinstance(raw, dict) or raw.get('post_type') != 'message' or raw.get('message_type') not in ('group', 'private'):
            return False
        try:
            if decimal_id(raw['self_id']) != self.bot_id or decimal_id(raw['user_id']) == self.bot_id:
                return False
            decimal_id(raw['message_id'], signed=True)
            if raw['message_type'] == 'group':
                decimal_id(raw['group_id'])
            if raw['sub_type'] not in (('normal', 'anonymous', 'notice') if raw['message_type'] == 'group' else ('friend', 'group', 'other')):
                return False
            if not isinstance(raw['raw_message'], str) or not isinstance(raw['time'], int) or isinstance(raw['time'], bool):
                return False
            if not isinstance(raw['message'], (str, list)):
                return False
            if isinstance(raw['message'], list):
                if len(raw['message']) > 256 or any(not isinstance(s, dict) or not isinstance(s.get('type'), str) or not isinstance(s.get('data'), dict) for s in raw['message']):
                    return False
            return len(json.dumps(raw, allow_nan=False).encode('utf-8')) <= 1024 * 1024
        except (KeyError, TypeError, ValueError):
            return False

    def valid_recall(self, raw):
        if not isinstance(raw, dict) or raw.get('post_type') != 'notice' or raw.get('notice_type') not in ('group_recall', 'friend_recall'):
            return False
        try:
            if decimal_id(raw['self_id']) != self.bot_id:
                return False
            decimal_id(raw['user_id'])
            decimal_id(raw['message_id'], signed=True)
            if raw['notice_type'] == 'group_recall':
                decimal_id(raw['group_id'])
                decimal_id(raw['operator_id'])
            return (isinstance(raw['time'], int) and not isinstance(raw['time'], bool) and
                    len(json.dumps(raw, allow_nan=False).encode('utf-8')) <= 65536)
        except (KeyError, TypeError, ValueError):
            return False

    async def forward(self, event):
        if self.closed:
            return False
        # Exact verified AstrBot -> aiocqhttp boundary; no alternate spellings.
        raw = event.message_obj.raw_message
        recall = self.valid_recall(raw)
        if not recall and not self.valid_event(raw):
            return False
        try:
            await asyncio.wait_for(self.event_slots.acquire(), 0.1)
        except TimeoutError:
            self.warn('Minto bridge incoming capacity reached')
            return False
        try:
            raw_copy = json.loads(json.dumps(dict(raw), ensure_ascii=False, allow_nan=False))
            if recall:
                if raw_copy['notice_type'] == 'group_recall':
                    self.history_cache.pop(decimal_id(raw_copy['group_id']), None)
                response = await self.local.json('POST', '/v1/events', {'event': raw_copy})
                return response.get('accepted') is True
            images = []
            attempted = 0
            if isinstance(raw_copy['message'], list):
                for index, segment in enumerate(raw_copy['message']):
                    if segment['type'] != 'image' or attempted >= 4:
                        continue
                    url = segment['data'].get('url')
                    if not isinstance(url, str):
                        continue
                    attempted += 1
                    try:
                        data = await self.fetch_image(url)
                        mime = image_type(data)
                        if mime and len(data) <= IMAGE_LIMIT:
                            images.append({'segment_index': index, 'data_url': 'data:' + mime + ';base64,' + base64.b64encode(data).decode('ascii')})
                    except Exception:
                        # Missing images remain missing; raw text/event still forwards.
                        self.warn('Minto bridge image unavailable')
            payload = {'event': raw_copy, 'images': images}
            history = await self.recent_history(raw_copy)
            if history:
                payload['history'] = history
            try:
                response = await self.local.json('POST', '/v1/events', payload)
                if not isinstance(response, dict) or type(response.get('accepted')) is not bool:
                    raise ValueError('Event submission outcome unknown')
            except Exception:
                # The core may already have accepted and queued this event even
                # when its response is lost, late, or malformed. Do not let the
                # same event enter AstrBot's default AI while that is unknown.
                event.stop_event()
                raise
            if response['accepted']:
                event.stop_event()
                return True
            return False
        finally:
            self.event_slots.release()

    async def recent_history(self, raw):
        if not self.history_enabled or raw['message_type'] != 'group' or not isinstance(raw['message'], list):
            return []
        wake = any((s['type'] == 'at' and s['data'].get('qq') == self.bot_id) or
                   (s['type'] == 'text' and isinstance(s['data'].get('text'), str) and
                    any(word in s['data']['text'] for word in self.history_keywords)) for s in raw['message'])
        if not wake:
            return []
        group_id = decimal_id(raw['group_id'])
        current_id = decimal_id(raw['message_id'], signed=True)
        def visible(rows):
            return [message for message in rows
                    if decimal_id(message['message_id'], signed=True) != current_id and
                    message['time'] <= raw['time']]
        now = time.monotonic()
        cached = self.history_cache.get(group_id)
        if cached is not None and cached[0] > now:
            return visible(cached[1])
        rows = []
        try:
            # NapCat extension; exact response schema is linked in README.
            result = await asyncio.wait_for(self.action('get_group_msg_history', group_id=group_id, count=50), 4)
            messages = result['messages']
            if not isinstance(messages, list) or len(messages) > 50:
                raise ValueError('Unsupported history response')
            budget = 0
            for message in messages:
                if (self.valid_event(message) and message['message_type'] == 'group' and
                        decimal_id(message['group_id']) == group_id):
                    size = len(json.dumps(message, allow_nan=False).encode('utf-8'))
                    if budget + size > 1024 * 1024:
                        break
                    budget += size
                    rows.append(json.loads(json.dumps(message, allow_nan=False)))
        except Exception:
            self.warn('Minto bridge recent history unavailable; live event retained')
        if len(self.history_cache) >= 64:
            self.history_cache.pop(next(iter(self.history_cache)))
        self.history_cache[group_id] = (now + 60, rows)
        return visible(rows)

    async def snapshot(self):
        login = await self.action('get_login_info')
        if decimal_id(login['user_id']) != self.bot_id:
            raise ValueError('Configured bot does not match OneBot login')
        groups = await self.action('get_group_list')
        friends = await self.action('get_friend_list')
        if not isinstance(groups, list) or not isinstance(friends, list) or len(groups) > 10000 or len(friends) > 20000:
            raise ValueError('OneBot catalog exceeds limits')
        def name(value):
            if not isinstance(value, str) or len(value) > 4096:
                raise ValueError('Invalid catalog name')
            return value
        await self.local.json('POST', '/v1/snapshot', {
            'bot_id': self.bot_id, 'nickname': name(login['nickname']),
            'groups': [{'group_id': decimal_id(g['group_id']), 'group_name': name(g['group_name'])} for g in groups],
            'friends': [{'user_id': decimal_id(f['user_id']), 'nickname': name(f['nickname']), 'remark': name(f['remark'])} for f in friends]})

    async def execute(self, item):
        kind = item['kind']
        if kind == 'refresh':
            await self.snapshot()
            return {'ok': True}
        if kind == 'delete':
            await self.action('delete_msg', message_id=int(decimal_id(item['message_id'], signed=True)))
            return {'ok': True}
        if kind != 'send' or item['message_type'] not in ('group', 'private'):
            raise ValueError('Unsupported delivery kind')
        peer_id = int(decimal_id(item['peer_id']))
        message = []
        if 'media_id' in item:
            if 'text' in item or 'reply_to' in item:
                raise ValueError('Voice must be a separate delivery item')
            data = await self.local.media(item['media_id'])
            if len(data) > WAV_LIMIT:
                raise ValueError('Voice exceeds size limit')
            with wave.open(io.BytesIO(data), 'rb') as wav:
                if wav.getnchannels() not in (1, 2) or wav.getsampwidth() not in (1, 2, 3, 4) or not 8000 <= wav.getframerate() <= 96000 or not 0 < wav.getnframes() <= wav.getframerate() * 120:
                    raise ValueError('Invalid WAV parameters')
                if len(wav.readframes(wav.getnframes())) != wav.getnframes() * wav.getnchannels() * wav.getsampwidth():
                    raise ValueError('Incomplete WAV data')
            message.append({'type': 'record', 'data': {'file': 'base64://' + base64.b64encode(data).decode('ascii')}})
        else:
            if not isinstance(item['text'], str) or not 0 < len(item['text']) <= 12000:
                raise ValueError('Invalid outgoing text')
            if 'reply_to' in item:
                message.append({'type': 'reply', 'data': {'id': decimal_id(item['reply_to'], signed=True)}})
            message.append({'type': 'text', 'data': {'text': item['text']}})
        if item['message_type'] == 'group':
            result = await self.action('send_group_msg', group_id=peer_id, message=message)
        else:
            result = await self.action('send_private_msg', user_id=peer_id, message=message)
        return {'ok': True, 'message_id': decimal_id(result['message_id'], signed=True)}

    async def ack(self, item_id, result):
        await self.local.json('POST', '/v1/ack', {'id': item_id, **result})
        self.journal.acknowledge(item_id)

    async def poll_once(self):
        async with self.delivery_lock:
            for item_id, result in self.journal.pending():
                await self.ack(item_id, result)
            response = await self.local.json('GET', '/v1/outbox?bot_id=' + quote(self.bot_id, safe=''))
            items = response['items']
            if not isinstance(items, list) or len(items) > 100:
                raise ValueError('Outbox exceeds limits')
            for item in items:
                if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not 0 < len(item['id']) <= 128:
                    raise ValueError('Invalid outbox identifier')
                item_id = item['id']
                result = self.journal.get(item_id)
                if result is None:
                    self.journal.reserve(item_id)
                    try:
                        result = await self.execute(item)
                    except Exception:
                        # Never return exception text: remote errors can contain secrets.
                        result = {'ok': False, 'error': 'OneBot delivery failed; inspect bridge setup and protocol status'}
                    self.journal.finish(item_id, result)
                await self.ack(item_id, result)

    def start(self):
        if self.task is None:
            self.task = asyncio.create_task(self.run(), name='minto-qq-bridge')

    async def run(self):
        next_snapshot = 0
        while True:
            try:
                if time.monotonic() >= next_snapshot:
                    await self.snapshot()
                    next_snapshot = time.monotonic() + 300
                await self.poll_once()
            except Exception:
                self.warn('Minto bridge unavailable; retrying with bounded backoff')
            await asyncio.sleep(2)

    async def stop(self):
        self.closed = True
        if self.task is not None:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)

    def close(self):
        if not self.closed:
            self.closed = True
        if self.journal is not None:
            self.journal.close()
            self.journal = None
        if isinstance(self.local, LocalClient):
            self.local.close()
