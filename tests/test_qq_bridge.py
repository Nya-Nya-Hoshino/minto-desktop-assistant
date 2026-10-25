"""Offline contract tests; no AstrBot install, QQ login, or QQ network calls."""
import asyncio
import base64
import gc
import importlib.util
import io
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
import sys
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'integrations' / 'astrbot_plugin_minto_bridge' / 'bridge.py'


def load_bridge():
    spec = importlib.util.spec_from_file_location('minto_qq_bridge', MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeBot:
    def __init__(self):
        self.calls = []
        self.fail = False

    async def call_action(self, action, **params):
        self.calls.append((action, params))
        if self.fail:
            raise RuntimeError('secret must not escape')
        return {'get_login_info': {'user_id': 12345, 'nickname': '薄荷'},
                'get_group_list': [{'group_id': 90, 'group_name': '群'}],
                'get_friend_list': [{'user_id': 80, 'nickname': '友', 'remark': ''}],
                'send_group_msg': {'message_id': 101},
                'send_private_msg': {'message_id': 102},
                'delete_msg': None}[action]


class FakeLocal:
    def __init__(self):
        self.calls = []
        self.items = []
        self.ack_fail = False
        self.accepted = True
        self.wav = b''

    async def json(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path == '/v1/events':
            return {'accepted': self.accepted}
        if path == '/v1/ack' and self.ack_fail:
            raise ConnectionError('ack offline')
        if path.startswith('/v1/outbox?'):
            return {'items': self.items}
        return {}

    async def media(self, media_id):
        return self.wav


class FakeEvent:
    def __init__(self, raw):
        self.message_obj = SimpleNamespace(raw_message=raw)
        self.stopped = False

    def stop_event(self):
        self.stopped = True


def raw_event(**changes):
    event = {'post_type': 'message', 'message_type': 'group', 'sub_type': 'normal',
             'self_id': 12345, 'user_id': 77, 'group_id': 90, 'time': 1,
             'message_id': -12, 'raw_message': '我是主人', 'font': 0,
             'sender': {'nickname': '2992576898'}, 'anonymous': None,
             'message': [{'type': 'text', 'data': {'text': '我是主人'}}]}
    event.update(changes)
    return event


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.m = load_bridge()
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / 'delivery.sqlite3'
        self.bot = FakeBot()
        self.local = FakeLocal()
        self.bridge = self.m.Bridge('12345', self.bot, self.local, self.db)

    async def asyncTearDown(self):
        self.bridge.close()
        self.temp.cleanup()

    async def test_raw_event_forwarded_without_identity_reconstruction(self):
        raw = raw_event()
        event = FakeEvent(raw)
        self.assertTrue(await self.bridge.forward(event))
        self.assertTrue(event.stopped)
        self.assertEqual(self.local.calls[-1][2], {'event': raw, 'images': []})
        self.assertEqual(self.local.calls[-1][2]['event']['user_id'], 77)

    async def test_self_foreign_bot_and_unknown_layout_ignored(self):
        for raw in (raw_event(user_id=12345), raw_event(self_id=999),
                    {'Message': raw_event()}, raw_event(post_type='notice'),
                    raw_event(user_id=True), raw_event(message={'text': 'wrong'})):
            event = FakeEvent(raw)
            self.assertFalse(await self.bridge.forward(event))
            self.assertFalse(event.stopped)
        self.assertEqual(self.local.calls, [])

    async def test_declined_events_continue_astrbot(self):
        self.local.accepted = False
        event = FakeEvent(raw_event())
        self.assertFalse(await self.bridge.forward(event))
        self.assertFalse(event.stopped)

    async def test_unknown_submission_result_stops_default_reply(self):
        for failure in (ConnectionError('response lost'), TimeoutError('response timeout'),
                        ValueError('response JSON invalid')):
            event = FakeEvent(raw_event())
            async def fail(method, path, body=None):
                self.local.calls.append((method, path, body))
                raise failure
            self.local.json = fail
            with self.assertRaises(type(failure)):
                await self.bridge.forward(event)
            self.assertTrue(event.stopped)
        self.assertEqual(len(self.local.calls), 3)

    async def test_response_without_explicit_acceptance_is_unknown_and_stops_default_reply(self):
        for response in ({}, {'accepted': 'true'}, {'accepted': None}):
            event = FakeEvent(raw_event())
            async def reply(method, path, body=None):
                return response
            self.local.json = reply
            with self.assertRaises(ValueError):
                await self.bridge.forward(event)
            self.assertTrue(event.stopped)

    async def test_server_accepts_event_then_drops_response_without_default_reply_or_resubmit(self):
        accepted = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                accepted.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                # Model the core accepting/queuing the event before its response
                # disappears. This is a real local HTTP connection, not QQ.
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        local = self.m.LocalClient('http://127.0.0.1:' + str(server.server_port), 'test-token-1234567890')
        original = self.bridge.local
        self.bridge.local = local
        try:
            event = FakeEvent(raw_event())
            with self.assertRaises(ConnectionError):
                await self.bridge.forward(event)
            self.assertTrue(event.stopped)
            self.assertEqual(len(accepted), 1)
            self.assertEqual(accepted[0]['event'], event.message_obj.raw_message)
        finally:
            self.bridge.local = original
            local.close()
            await asyncio.to_thread(server.shutdown)
            server.server_close()
            thread.join()

    async def test_hydration_preserves_raw_and_segment_indexes_skips_failures(self):
        raw = raw_event(message=[{'type': 'text', 'data': {'text': 'x'}},
                                 {'type': 'image', 'data': {'url': 'https://images.example/a'}},
                                 {'type': 'image', 'data': {'url': 'http://127.0.0.1/b'}}])
        png = b'\x89PNG\r\n\x1a\nreal image bytes'
        async def fetch(url):
            if '127.0.0.1' in url:
                raise ValueError('blocked')
            return png
        self.bridge.fetch_image = fetch
        await self.bridge.forward(FakeEvent(raw))
        payload = self.local.calls[-1][2]
        self.assertEqual(payload['event'], raw)
        self.assertEqual(payload['images'], [{'segment_index': 1, 'data_url':
                          'data:image/png;base64,' + base64.b64encode(png).decode()}])

    async def test_snapshot_uses_exact_onebot_catalog_fields_and_routing(self):
        await self.bridge.snapshot()
        self.assertEqual([x[0] for x in self.bot.calls],
                         ['get_login_info', 'get_group_list', 'get_friend_list'])
        self.assertTrue(all(x[1] == {'self_id': 12345} for x in self.bot.calls))
        self.assertEqual(self.local.calls[-1], ('POST', '/v1/snapshot', {
            'bot_id': '12345', 'nickname': '薄荷',
            'groups': [{'group_id': '90', 'group_name': '群'}],
            'friends': [{'user_id': '80', 'nickname': '友', 'remark': ''}]}))

    async def test_mismatched_login_never_publishes_snapshot(self):
        self.bridge.bot_id = '111'
        with self.assertRaises(ValueError):
            await self.bridge.snapshot()
        self.assertEqual(self.local.calls, [])

    async def test_ack_failure_and_restart_do_not_resend_successful_send(self):
        item = {'id': 'a', 'kind': 'send', 'message_type': 'group',
                'peer_id': '90', 'text': '[CQ:at,qq=all]', 'reply_to': '-12'}
        self.local.items = [item]
        self.local.ack_fail = True
        with self.assertRaises(ConnectionError):
            await self.bridge.poll_once()
        self.assertEqual(len(self.bot.calls), 1)
        self.assertEqual(self.bot.calls[0], ('send_group_msg', {'self_id': 12345,
            'group_id': 90, 'message': [{'type': 'reply', 'data': {'id': '-12'}},
            {'type': 'text', 'data': {'text': '[CQ:at,qq=all]'}}]}))
        self.bridge.close()
        self.bridge = self.m.Bridge('12345', self.bot, self.local, self.db)
        self.local.ack_fail = False
        await self.bridge.poll_once()
        self.assertEqual(len(self.bot.calls), 1)
        acks = [x[2] for x in self.local.calls if x[1] == '/v1/ack']
        self.assertEqual(acks[-1], {'id': 'a', 'ok': True, 'message_id': '101'})

    async def test_ack_retry_blocks_new_poll(self):
        self.local.items = [{'id': 'a', 'kind': 'delete', 'message_id': '5'}]
        self.local.ack_fail = True
        for _ in range(2):
            with self.assertRaises(ConnectionError):
                await self.bridge.poll_once()
        self.assertEqual(sum(x[1].startswith('/v1/outbox') for x in self.local.calls), 1)
        self.assertEqual(len(self.bot.calls), 1)

    async def test_failure_ack_is_sanitized_and_not_resent(self):
        self.bot.fail = True
        self.local.items = [{'id': 'bad', 'kind': 'send', 'message_type': 'private',
                             'peer_id': '80', 'text': 'hi'}]
        await self.bridge.poll_once()
        await self.bridge.poll_once()
        ack = [x[2] for x in self.local.calls if x[1] == '/v1/ack'][-1]
        self.assertFalse(ack['ok'])
        self.assertNotIn('secret', ack['error'])
        self.assertEqual(len(self.bot.calls), 1)

    async def test_refresh_and_delete(self):
        self.local.items = [{'id': 'refresh', 'kind': 'refresh'},
                            {'id': 'delete', 'kind': 'delete', 'message_id': '-9'}]
        await self.bridge.poll_once()
        self.assertIn(('delete_msg', {'self_id': 12345, 'message_id': -9}), self.bot.calls)
        self.assertEqual(len([x for x in self.local.calls if x[1] == '/v1/ack']), 2)

    async def test_voice_is_separate_base64_record_without_text(self):
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(b'\0\0' * 100)
        self.local.wav = output.getvalue()
        self.local.items = [{'id': 'voice', 'kind': 'send', 'message_type': 'private',
                             'peer_id': '80', 'media_id': 'wav-1'}]
        await self.bridge.poll_once()
        segments = self.bot.calls[0][1]['message']
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]['type'], 'record')
        self.assertEqual(base64.b64decode(segments[0]['data']['file'][9:]), self.local.wav)

    async def test_invalid_wav_or_mixed_voice_text_never_sends(self):
        self.local.wav = b'not audio'
        self.local.items = [{'id': 'voice', 'kind': 'send', 'message_type': 'private',
                             'peer_id': '80', 'media_id': 'wav-1'},
                            {'id': 'mixed', 'kind': 'send', 'message_type': 'group',
                             'peer_id': '90', 'media_id': 'wav-2', 'text': 'bad'}]
        await self.bridge.poll_once()
        self.assertEqual(self.bot.calls, [])
        self.assertTrue(all(not x[2]['ok'] for x in self.local.calls if x[1] == '/v1/ack'))

    async def test_inflight_crash_record_does_not_resend(self):
        self.bridge.journal.reserve('interrupted')
        self.bridge.close()
        self.bridge = self.m.Bridge('12345', self.bot, self.local, self.db)
        self.local.items = [{'id': 'interrupted', 'kind': 'send', 'message_type': 'group',
                             'peer_id': '90', 'text': 'do not repeat'}]
        await self.bridge.poll_once()
        self.assertEqual(self.bot.calls, [])
        self.assertFalse([x[2] for x in self.local.calls if x[1] == '/v1/ack'][-1]['ok'])

    async def test_background_task_shutdown_is_clean(self):
        self.bridge.start()
        task = self.bridge.task
        self.bridge.start()
        self.assertIs(self.bridge.task, task)
        await self.bridge.stop()
        self.assertTrue(task.done())

    async def test_history_on_at_only_filters_scope_and_caches_queries(self):
        self.bridge.history_enabled = True
        history = [raw_event(message_id=-10), raw_event(message_id=-9, group_id=91),
                   raw_event(message_id=-8, self_id=999), raw_event(post_type='message_sent')]
        original = self.bot.call_action
        async def action(name, **params):
            if name == 'get_group_msg_history':
                self.bot.calls.append((name, params))
                return {'messages': history}
            return await original(name, **params)
        self.bot.call_action = action
        at = raw_event(message=[{'type': 'at', 'data': {'qq': '12345'}}])
        await self.bridge.forward(FakeEvent(raw_event()))
        self.assertNotIn('history', self.local.calls[-1][2])
        await self.bridge.forward(FakeEvent(at))
        self.assertEqual(self.local.calls[-1][2]['history'], [history[0]])
        await self.bridge.forward(FakeEvent(at))
        calls = [x for x in self.bot.calls if x[0] == 'get_group_msg_history']
        self.assertEqual(calls, [('get_group_msg_history', {'self_id': 12345, 'group_id': '90', 'count': 50})])

    async def test_history_unsupported_extension_does_not_block_live_event(self):
        self.bridge.history_enabled = True
        self.bridge.history_keywords = ('薄荷',)
        self.bot.fail = True
        event = FakeEvent(raw_event(message=[{'type': 'text', 'data': {'text': '薄荷你好'}}]))
        self.assertTrue(await self.bridge.forward(event))
        self.assertNotIn('history', self.local.calls[-1][2])

    async def test_cached_history_refilters_current_message_and_future_records_on_each_event(self):
        self.bridge.history_enabled = True
        history = [raw_event(message_id=80, time=80), raw_event(message_id=90, time=90),
                   raw_event(message_id=95, time=95)]
        queries = []
        async def action(name, **params):
            queries.append(name)
            return {'messages': history}
        self.bot.call_action = action
        def wake(message_id, timestamp):
            return FakeEvent(raw_event(message_id=message_id, time=timestamp,
                             message=[{'type': 'at', 'data': {'qq': '12345'}}]))
        await self.bridge.forward(wake(100, 100))
        self.assertEqual(self.local.calls[-1][2]['history'], history)
        await self.bridge.forward(wake(90, 90))
        self.assertEqual(self.local.calls[-1][2]['history'], [history[0]])
        await self.bridge.forward(wake(70, 70))
        self.assertNotIn('history', self.local.calls[-1][2])
        await self.bridge.forward(wake(100, 100))
        self.assertEqual(self.local.calls[-1][2]['history'], history)
        self.assertEqual(queries, ['get_group_msg_history'])

    async def test_event_capacity_declines_without_unbounded_queue(self):
        for _ in range(4):
            await self.bridge.event_slots.acquire()
        try:
            self.assertFalse(await self.bridge.forward(FakeEvent(raw_event())))
        finally:
            for _ in range(4):
                self.bridge.event_slots.release()
        self.assertEqual(self.local.calls, [])

    async def test_timeout_worker_errors_are_consumed_without_secret_logs(self):
        local = self.m.LocalClient('http://127.0.0.1:1234', 'test-token-1234567890')
        errors = []
        loop = asyncio.get_running_loop()
        previous = loop.get_exception_handler()
        loop.set_exception_handler(lambda loop, context: errors.append(context))
        def late_error():
            time.sleep(0.03)
            raise RuntimeError('sensitive remote error body')
        try:
            with patch.object(self.m, 'API_TIMEOUT', 0.01):
                with self.assertRaises(TimeoutError):
                    await local.blocking(late_error)
            await asyncio.sleep(0.08)
            gc.collect()
            self.assertEqual(errors, [])
            self.assertEqual(local.slots._value, 4)
        finally:
            local.close()
            loop.set_exception_handler(previous)

    async def test_recall_notices_forward_exact_fields_without_stopping_propagation(self):
        for notice in ({'post_type': 'notice', 'notice_type': 'group_recall',
                        'self_id': 12345, 'group_id': 90, 'user_id': 77,
                        'operator_id': 12345, 'message_id': -12, 'time': 2},
                       {'post_type': 'notice', 'notice_type': 'friend_recall',
                        'self_id': 12345, 'user_id': 77, 'message_id': -12, 'time': 2}):
            event = FakeEvent(notice)
            self.assertTrue(await self.bridge.forward(event))
            self.assertEqual(self.local.calls[-1][2], {'event': notice})
            self.assertFalse(event.stopped)

    async def test_unrelated_or_malformed_notices_are_ignored(self):
        for notice in ({'post_type': 'notice', 'notice_type': 'group_increase'},
                       {'post_type': 'notice', 'notice_type': 'group_recall',
                        'self_id': 12345, 'group_id': 90, 'user_id': 77, 'message_id': 12, 'time': 2}):
            self.assertFalse(await self.bridge.forward(FakeEvent(notice)))
        self.assertEqual(self.local.calls, [])


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.m = load_bridge()

    def test_loopback_only_pairing_url(self):
        for url in ['http://localhost:10', 'http://192.168.1.2:10',
                    'https://example.com', 'http://127.0.0.1:10/evil',
                    'http://user:password@127.0.0.1:10', 'http://127.0.0.1:10?x=1']:
            with self.assertRaises(ValueError):
                self.m.LocalClient(url, 'test-token-1234567890')

    def test_global_only_dns_blocks_all_non_global_answers(self):
        for ip in ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1',
                   '100.64.0.1', '192.0.2.1', '::ffff:127.0.0.1']:
            answer = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, 443))]
            with patch.object(socket, 'getaddrinfo', return_value=answer):
                with self.assertRaises(ValueError):
                    self.m.public_address('example.com', 443)

    def test_download_rejects_file_credentials_and_private_urls(self):
        for url in ['file:///etc/passwd', 'https://u:p@example.com/image',
                    'http://127.0.0.1/image']:
            with self.assertRaises(ValueError):
                self.m.download_image(url)

    def test_redirect_to_private_address_does_not_connect(self):
        response = SimpleNamespace(status=302, getheader=lambda name, default=None:
                                   'http://127.0.0.1/private' if name == 'Location' else default)
        connection = SimpleNamespace(request=lambda *a, **k: None,
                                     getresponse=lambda: response, close=lambda: None)
        public = (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 80))
        def dns(host, port, **kwargs):
            return [public if host == 'example.com' else
                    (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 80))]
        with patch.object(socket, 'getaddrinfo', side_effect=dns), \
             patch.object(self.m.http.client, 'HTTPConnection', return_value=connection) as connect:
            with self.assertRaises(ValueError):
                self.m.download_image('http://example.com/image')
            self.assertEqual(connect.call_count, 1)

    def test_chunked_or_declared_oversized_images_are_rejected(self):
        for length in (str(self.m.IMAGE_LIMIT + 1), None):
            response = SimpleNamespace(getheader=lambda name: length,
                                       read=lambda count: b'x' * count)
            with self.assertRaises(ValueError):
                self.m.bounded_read(response, self.m.IMAGE_LIMIT, float('inf'))

    def test_local_http_auth_exact_json_and_no_redirect(self):
        records = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                records.append((self.path, self.headers['Authorization'],
                                json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"accepted":true}')

            def do_GET(self):
                self.send_response(302)
                self.send_header('Location', 'http://example.com/leak')
                self.end_headers()
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = self.m.LocalClient('http://127.0.0.1:' + str(server.server_port), 'test-token-1234567890')
            reply = asyncio.run(client.json('POST', '/v1/events', {'event': '真实'}))
            self.assertEqual(reply, {'accepted': True})
            self.assertEqual(records, [('/v1/events', 'Bearer test-token-1234567890', {'event': '真实'})])
            with self.assertRaises(Exception) as caught:
                asyncio.run(client.json('GET', '/v1/health'))
            self.assertNotIn('test-token', str(caught.exception))
            client.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


class PluginTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        import importlib
        sys.path.insert(0, str(ROOT / 'integrations'))
        self.fake_logger = SimpleNamespace(warning=lambda *_: None)
        api = ModuleType('astrbot.api')
        api.logger = self.fake_logger
        event_api = ModuleType('astrbot.api.event')
        event_api.AstrMessageEvent = FakeEvent
        def decorator(*args, **kwargs):
            return lambda function: function
        event_api.filter = SimpleNamespace(platform_adapter_type=decorator,
            on_astrbot_loaded=decorator, PlatformAdapterType=SimpleNamespace(AIOCQHTTP=1))
        star_api = ModuleType('astrbot.api.star')
        class Star:
            def __init__(self, context):
                self.context = context
        star_api.Star = Star
        star_api.Context = object
        self.temp = tempfile.TemporaryDirectory()
        star_api.StarTools = SimpleNamespace(get_data_dir=lambda _: Path(self.temp.name))
        self.patcher = patch.dict(sys.modules, {'astrbot': ModuleType('astrbot'),
            'astrbot.api': api, 'astrbot.api.event': event_api, 'astrbot.api.star': star_api})
        self.patcher.start()
        sys.modules.pop('astrbot_plugin_minto_bridge.main', None)
        self.main = importlib.import_module('astrbot_plugin_minto_bridge.main')

    def tearDown(self):
        self.patcher.stop()
        sys.path.remove(str(ROOT / 'integrations'))
        self.temp.cleanup()

    async def test_disabled_plugin_does_not_open_network_or_load_token(self):
        plugin = self.main.MintoBridgePlugin(SimpleNamespace(), {'enabled': False})
        await plugin.initialize()
        self.assertIsNone(plugin.bridge)
        await plugin.terminate()

    async def test_unknown_adapter_is_rejected_before_token_read(self):
        adapter = SimpleNamespace(meta=lambda: SimpleNamespace(name='qq_official'))
        context = SimpleNamespace(get_platform_inst=lambda platform_id: adapter)
        plugin = self.main.MintoBridgePlugin(context, {'enabled': True,
            'platform_id': 'explicit-platform', 'bot_id': '12345',
            'minto_url': 'http://127.0.0.1:1234', 'token_file': 'does-not-exist'})
        await plugin.initialize()
        self.assertIsNone(plugin.bridge)
        await plugin.terminate()

    async def test_explicit_platform_token_and_account_setup_routes_only_matching_event(self):
        bot = FakeBot()
        adapter = SimpleNamespace(meta=lambda: SimpleNamespace(name='aiocqhttp'), get_client=lambda: bot)
        context = SimpleNamespace(get_platform_inst=lambda platform_id: adapter)
        token = Path(self.temp.name) / 'pairing-token.txt'
        token.write_text('test-token-1234567890', encoding='utf-8')
        plugin = self.main.MintoBridgePlugin(context, {'enabled': True,
            'platform_id': 'explicit-platform', 'bot_id': '12345',
            'minto_url': 'http://127.0.0.1:1234', 'token_file': str(token)})
        with patch.object(self.main.Bridge, 'start') as start:
            await plugin.initialize()
        self.assertIsNotNone(plugin.bridge)
        self.assertEqual(start.call_count, 1)
        plugin.bridge.local.close()
        plugin.bridge.local = FakeLocal()
        event = FakeEvent(raw_event())
        event.get_platform_id = lambda: 'other-platform'
        await plugin.on_event(event)
        self.assertEqual(plugin.bridge.local.calls, [])
        event.get_platform_id = lambda: 'explicit-platform'
        await plugin.on_event(event)
        self.assertTrue(event.stopped)
        self.assertEqual(plugin.handlers, set())
        await plugin.terminate()
        self.assertIsNone(plugin.bridge)

    async def test_plugin_network_failure_logs_fixed_error_without_default_ai_reply(self):
        bot = FakeBot()
        adapter = SimpleNamespace(meta=lambda: SimpleNamespace(name='aiocqhttp'), get_client=lambda: bot)
        token = Path(self.temp.name) / 'pairing-token.txt'
        token.write_text('test-token-1234567890', encoding='utf-8')
        plugin = self.main.MintoBridgePlugin(SimpleNamespace(get_platform_inst=lambda _: adapter),
            {'enabled': True, 'platform_id': 'explicit-platform', 'bot_id': '12345',
             'minto_url': 'http://127.0.0.1:1234', 'token_file': str(token)})
        with patch.object(self.main.Bridge, 'start'):
            await plugin.initialize()
        self.addAsyncCleanup(plugin.terminate)
        plugin.bridge.local.close()
        plugin.bridge.local = FakeLocal()
        async def fail(method, path, body=None):
            raise ConnectionError('secret response body')
        plugin.bridge.local.json = fail
        event = FakeEvent(raw_event())
        event.get_platform_id = lambda: 'explicit-platform'
        messages = []
        with patch.object(self.main.logger, 'warning', side_effect=messages.append):
            await plugin.on_event(event)
        self.assertTrue(event.stopped)
        self.assertEqual(messages, ['Minto bridge event delivery unavailable'])
        self.assertEqual(plugin.handlers, set())
        await plugin.terminate()


if __name__ == '__main__':
    unittest.main()
