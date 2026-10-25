"""AstrBot lifecycle adapter; protocol and state logic live in bridge.py."""
import asyncio
from pathlib import Path

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, StarTools

from .bridge import Bridge, LocalClient, decimal_id


class MintoBridgePlugin(Star):
    def __init__(self, context: Context, config: dict):
        super().__init__(context)
        self.config = config
        self.bridge = None
        self.handlers = set()
        self.stopping = False

    async def initialize(self):
        await self.connect()

    @filter.on_astrbot_loaded()
    async def on_loaded(self):
        await self.connect()

    async def connect(self):
        if self.stopping or self.bridge is not None or self.config.get('enabled') is not True:
            return
        try:
            platform_id = self.config['platform_id']
            bot_id = decimal_id(self.config['bot_id'])
            if not isinstance(platform_id, str) or not platform_id:
                raise ValueError('Explicit AstrBot platform ID required')
            adapter = self.context.get_platform_inst(platform_id)
            if adapter is None:
                return  # Startup platforms may not be loaded yet; on_loaded retries.
            if adapter.meta().name != 'aiocqhttp':
                raise ValueError('Only aiocqhttp is supported')
            token_path = Path(self.config['token_file'])
            if not token_path.is_absolute() or not token_path.is_file() or token_path.stat().st_size > 4096:
                raise ValueError('Explicit token file required')
            with token_path.open('r', encoding='utf-8-sig') as token_file:
                token = token_file.read(4097).strip()
            local = LocalClient(self.config['minto_url'], token)
            try:
                data = StarTools.get_data_dir('astrbot_plugin_minto_bridge')
                self.bridge = Bridge(bot_id, adapter.get_client(), local,
                                     data / ('deliveries-' + bot_id + '.sqlite3'), logger.warning)
            except BaseException:
                local.close()
                raise
            keywords = self.config.get('history_keywords', ['薄荷', 'ミント'])
            if not isinstance(keywords, list) or len(keywords) > 32 or any(not isinstance(x, str) or not 0 < len(x) <= 64 for x in keywords):
                self.bridge.close()
                self.bridge = None
                raise ValueError('Invalid history keywords')
            self.bridge.history_enabled = self.config.get('history_enabled') is True
            self.bridge.history_keywords = tuple(keywords)
            self.bridge.start()
        except Exception:
            # Never log exception text, token, raw event, URL, or file contents.
            logger.warning('Minto bridge setup unavailable; check explicit platform, bot and pairing settings')

    @filter.platform_adapter_type(filter.PlatformAdapterType.AIOCQHTTP, priority=100)
    async def on_event(self, event: AstrMessageEvent):
        if self.stopping or self.bridge is None or event.get_platform_id() != self.config['platform_id']:
            return
        task = asyncio.current_task()
        self.handlers.add(task)
        try:
            await self.bridge.forward(event)
        except Exception:
            logger.warning('Minto bridge event delivery unavailable')
        finally:
            self.handlers.discard(task)

    async def terminate(self):
        self.stopping = True
        if self.bridge is None:
            return
        await self.bridge.stop()
        for task in tuple(self.handlers):
            task.cancel()
        if self.handlers:
            await asyncio.gather(*tuple(self.handlers), return_exceptions=True)
        self.bridge.close()
        self.bridge = None
