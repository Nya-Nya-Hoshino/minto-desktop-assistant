# Minto AstrBot QQ 桥接插件（0.6.0）

此目录是外部 AstrBot 插件。它连接 Minto 桌面端的本地 HTTP v1 接口，通过已配置的 `aiocqhttp` 平台使用 OneBot v11；不读写 Minto 旧存档，不处理昵称身份，不直接调用模型。

本次只做离线协议测试。未安装 AstrBot / NapCat、未登录 QQ、未向真实账号发消息。手机语音播放、QQ 实际撤回权限、账号长期在线及运行中 AstrBot 兼容性仍须用户在明确指定的测试账号和测试群验收。

## 安装与配对

1. 在 **独立 Python 环境**部署 AstrBot 和用户自行选择的 OneBot v11 协议端。不要把 AstrBot 装入 Minto 当前 TTS Python 环境。
2. 在 AstrBot 配置 `aiocqhttp` 平台。记录该平台实例的准确 `id`；插件不会按名称搜索或挑选其他平台。
3. 由用户在 Minto QQ 设置页明确填写机器人 QQ 号和绑定主存档。机器人 QQ 号不能填主人的 QQ 号代替；插件不选择账号或存档。共享笔记由用户明确填写，未填写时保持空白。
4. 将本目录完整复制到该 AstrBot 实例的 `data/plugins/astrbot_plugin_minto_bridge`。本插件没有额外 pip 依赖。重新加载插件。
5. 在 Minto 配对界面读取 `url` 和 `token`。在 AstrBot **同一主机**上，创建仅运行 AstrBot 的操作系统用户可读的 UTF-8 文本文件，文件只放该 token。不要把 token 写进命令行、截图、仓库或聊天。
6. 在插件配置中原样填写 `platform_id`、`bot_id`、`minto_url`、`token_file`（绝对路径），再启用 `enabled`。`minto_url` 必须是配对页显示的 `http://127.0.0.1:<端口>`。Minto 自动端口变更后同步更新它。token 文件路径会保存在 AstrBot 插件配置中，token 正文本插件不写入该配置。
7. 在桌面 QQ 页确认账号、群/好友目录和最后连接时间，再由用户启用测试群。默认 `enabled=false`，没有运行账号或绑定存档时不开始实际接入。

插件采用回环鉴权接口，因此普通 Docker 容器内的 `127.0.0.1` 并不指向宿主桌面。当前插件要求同机、同网络命名空间；不要把桌面接口改绑到公网地址来绕过这一限制。协议端可以独立运行，WAV 通过 `base64://` 消息段发送，不依赖双方共享本地文件路径。

## 配置项

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `false` | 显式开启插件 |
| `platform_id` | 空 | 精确的 AstrBot 平台实例 ID |
| `bot_id` | 空 | 用户指定的机器人数字 QQ 号 |
| `minto_url` | 空 | 桌面配对界面的回环 URL |
| `token_file` | 空 | 受操作系统文件权限保护的令牌文件绝对路径 |
| `history_enabled` | `false` | 尽力调用 NapCat 群历史扩展 |
| `history_keywords` | `["薄荷","ミント"]` | 历史补取的文本关键词，应与桌面群策略对照设置 |

历史补取只由原始顶层消息段里的 `at`（`data.qq` 等于机器人号）或文本关键词触发；不解析引用或转发节点以查找唤醒。每次请求 `count=50`，同群缓存 60 秒，最多 64 群、每群至多 1 MiB 历史。写入缓存前过滤其他群、其他机器人及不符合真实事件结构的记录；每次使用缓存时，仍按这次实时事件的 `message_id` 和 `time` 重新排除当前消息及比它更新的记录，因此重放或延迟到达的事件不会被缓存污染。不补造字段。协议端不支持、返回结构不符或超时时仍提交实时事件。通过 `POST /v1/events` 的可选 `history` 数组提交原始历史事件；条目只提供上下文，不触发新回复。NapCat 自身发出的历史消息使用 `message_sent`，当前标准 `message` 接口不会把它改造成他人消息。

## 运行与数据边界

- 仅读取 `event.message_obj.raw_message`，以真实事件的 `self_id` 和 `user_id` 校验范围。只处理该平台/账号的标准群/私聊消息，以及标准 `group_recall` / `friend_recall` 通知。撤回通知使用同一个 `POST /v1/events`，请求体仅含 `{event:<原始通知>}`；不附图片或历史、不调用 `stop_event()`，其他通知不提交。群撤回会立即清除此群的历史缓存。
- Minto 返回 `accepted:true` 后调用 `event.stop_event()`，由桌面群策略决定是否回应。接受但不回复的消息也停止 AstrBot 默认回复。如果请求遇到连接错误、超时、响应丢失、无效 JSON 或缺少明确布尔值 `accepted`，提交结果按未知处理：也停止该条消息的 AstrBot 默认 AI，只记录固定错误，不自动重复提交。这能覆盖核心已经排队但响应未到达的情况；后续已排队回复仍走 outbox。只有收到明确的 `accepted:false` 才保留框架后续处理。其他自动回复插件应与本插件错开，已经执行的较高优先级插件不能被撤销。
- 首次启动及每 300 秒获取登录、群与好友快照；每 2 秒串行轮询出站动作。每次轮询前先重试此前未成功的 ACK。
- 每次发送/撤回前在 AstrBot `data/plugin_data/astrbot_plugin_minto_bridge/deliveries-<bot_id>.sqlite3` 中持久写入预留记录。成功的远端 `message_id` 在 ACK 之前以 SQLite `synchronous=FULL` 持久化。ACK 失败或重启只重试 ACK，不重复发送。
- OneBot v11 没有标准发送幂等键。发送已经开始后进程中断，不能证明它是否到达 QQ；重启会报告“结果未知，未重发”，交由桌面人工核对。已确认失败也不自动重发。不要删除投递数据库来修复连接问题；它保存防重记录。最多保留 50000 条，达到上限停止新动作，由用户归档后处理。
- 文本使用标准 `text` 数组段，正文中的 CQ 码不作为指令解释。引用使用独立 `reply` 段。语音必须是另一个只有 `media_id` 的出站项，校验为有实际 PCM 帧的 WAV 后发送一个 `record` 段；语音失败不会重发文字。
- 最多同时处理 4 条实时事件；满载等待至多 0.1 秒，不建立无界队列。最多 4 个 HTTP 工作线程、每请求读取/连接超时、HTTP 调用等待上限 12 秒。系统 DNS 解析由操作系统管理，超过等待上限的线程仍占用固定工作槽，避免积累线程。关闭插件会取消事件/轮询任务并关闭数据库和传输池。
- 实时原始 JSON 上限 1 MiB；最多 4 张图片，每张 2 MiB；本地 JSON 请求/响应上限 14 MiB；WAV 上限 10 MiB、120 秒。图片只读标准 `image.data.url`，不读取 `file` 所指的本地文件。仅保留识别出 JPEG / PNG / WebP 文件头的真实字节；核心再次解码校验。GIF 及其他格式当前省略图片内容，原消息仍提交。
- 图片请求不携带配对 token，不使用环境代理。每个 DNS 结果都须全局可路由，连接固定到已验证 IP，HTTPS 仍校验原主机名；每次重定向重新校验，最多三次跳转。私网、回环、链路本地、共享地址、组播和本地文件全部拒绝。媒体失败只记录固定错误描述，不伪造视觉内容。
- 插件日志和 ACK 错误均为固定描述，不回显 token、远端异常正文、原消息、图片 URL 或媒体内容。

## 兼容依据（2026-10-25 核对）

以下是源码边界核对，不是运行中的 AstrBot 验收。锁定 AstrBot 提交 `de1d4ef6c1d21e4ed3c143af3b099aed68c1527f`；其他版本需按这些入口逐项核对，禁止猜测替代字段：

- [AstrBot OneBot 适配器](https://github.com/AstrBotDevs/AstrBot/blob/de1d4ef6c1d21e4ed3c143af3b099aed68c1527f/astrbot/core/platform/sources/aiocqhttp/aiocqhttp_platform_adapter.py)：`abm.raw_message = event`；`get_client()` 返回 `CQHttp`。
- [AstrBot Context](https://github.com/AstrBotDevs/AstrBot/blob/de1d4ef6c1d21e4ed3c143af3b099aed68c1527f/astrbot/core/star/context.py)：`get_platform_inst(platform_id)`；[事件对象](https://github.com/AstrBotDevs/AstrBot/blob/de1d4ef6c1d21e4ed3c143af3b099aed68c1527f/astrbot/core/platform/astr_message_event.py)：`message_obj`、`get_platform_id()`、`stop_event()`。
- [插件过滤器导出](https://github.com/AstrBotDevs/AstrBot/blob/de1d4ef6c1d21e4ed3c143af3b099aed68c1527f/astrbot/api/event/filter/__init__.py)：`platform_adapter_type`、`PlatformAdapterType.AIOCQHTTP`、`on_astrbot_loaded`；[Star](https://github.com/AstrBotDevs/AstrBot/blob/de1d4ef6c1d21e4ed3c143af3b099aed68c1527f/astrbot/core/star/base.py)：类注册、`initialize()` / `terminate()`；[StarTools](https://github.com/AstrBotDevs/AstrBot/blob/de1d4ef6c1d21e4ed3c143af3b099aed68c1527f/astrbot/core/star/star_tools.py)：`get_data_dir()`。
- [aiocqhttp Event](https://github.com/richardchien/python-aiocqhttp/blob/master/aiocqhttp/event.py) 明确继承 `dict`，故转换 `dict(raw_event)` 来自真实边界；[CQHttp](https://github.com/richardchien/python-aiocqhttp/blob/master/aiocqhttp/__init__.py) 提供异步 `call_action(action, **params)`，`self_id` 选择反向 WebSocket 账号。
- [OneBot 公开 API](https://github.com/botuniverse/onebot-11/blob/master/api/public.md)：`get_login_info`、`get_group_list`、`get_friend_list`、`send_group_msg(group_id,message)`、`send_private_msg(user_id,message)`、`delete_msg(message_id)`；发送结果的 `message_id`。
- [OneBot 消息事件](https://github.com/botuniverse/onebot-11/blob/master/event/message.md)、[撤回通知](https://github.com/botuniverse/onebot-11/blob/master/event/notice.md)、[消息段](https://github.com/botuniverse/onebot-11/blob/master/message/segment.md)：标准原始字段、`image.data.url`、`text` / `reply` / `record`、语音文件支持 `base64://`。
- NapCat 提交 `3420f0b76d7dc0ac92cde1663f21ea27f61e13bb`：[GetGroupMsgHistory](https://github.com/NapNeko/NapCatQQ/blob/3420f0b76d7dc0ac92cde1663f21ea27f61e13bb/packages/napcat-onebot/action/go-cqhttp/GetGroupMsgHistory.ts) 的响应为 `{messages:[...]}`；[MsgApi](https://github.com/NapNeko/NapCatQQ/blob/3420f0b76d7dc0ac92cde1663f21ea27f61e13bb/packages/napcat-onebot/api/msg.ts) 的 `initializeMessage` / `handleGroupMessage` 产生完整真实事件字段。插件不把通用 API 包装层的 `data` 再套到已解包的 aiocqhttp 返回值上。
- [AstrBot 配置文档](https://docs.astrbot.app/dev/star/guides/plugin-config.html)：`_conf_schema.json` 配置结构。

## 离线测试

在 MintoAssistant 工作目录运行：

```powershell
& .\runtime\python\python.exe -m unittest discover -s tests -p test_qq_bridge.py -v
```

测试替身只模拟以上核对过的 AstrBot / aiocqhttp 边界。真实 HTTP 测试只监听随机本地回环端口，不连接 QQ，也不安装任何 Python 包。
