# QQ integration implementation contract

Approved basis: QQ-INTEGRATION-RESEARCH.zh-CN.md. Development target: 0.6.0.

## Tasks

- [ ] Write failing isolation, identity, replay, summary and bridge HTTP tests.
- [ ] Implement a scoped SQLite store and one Minto QQ coordinator; never write legacy saves from AstrBot.
- [ ] Implement the external AstrBot OneBot v11 bridge and its Python tests.
- [ ] Implement the QQ settings page and narrow IPC endpoints.
- [ ] Integrate Chinese QQ replies, optional Japanese TTS and authorized desktop memory access.
- [ ] Run simulated end-to-end and native UI checks, package and verify with copied profiles.
- [ ] Preserve current data and rollback files; clean only verified rebuildable copies.

QQ stays disabled until the user specifies the bot QQ number and bound save. Shared notes start empty. Only sender 2992576898 is master. No QQ login or live sends during development tests.

## Local bridge HTTP v1 (new interface, not an existing AstrBot API)

All paths bind 127.0.0.1, require `Authorization: Bearer <pairing token>`, and use JSON except media. The token is generated and encrypted by the desktop core. It never appears in ordinary public state.

- `GET /v1/health`: `{version:1, enabled, bot_id, master_qq:"2992576898"}`.
- `POST /v1/snapshot`: `{bot_id,nickname,groups:[{group_id,group_name}],friends:[{user_id,nickname,remark}]}`. IDs are decimal strings; catalog names are untrusted plain text.
- `POST /v1/events` for messages: `{event:<OneBot v11 raw message event>,images:[{segment_index:0,data_url:"data:image/jpeg;base64,..."}],history:[<raw message event>,...]}`. `images` and `history` are optional. Maximum four image data URLs, each at most 2 MiB decoded, with JPEG/PNG/WebP/GIF MIME types; the core does not fetch arbitrary media URLs. This bridge hydrates JPEG/PNG/WebP only and leaves unsupported image contents absent. `history` has at most 60 entries; each must match the live event's bot, message type and peer. The plugin supplies group history only, requests at most 50 records from the verified NapCat `get_group_msg_history` response `{messages:[...]}`, and never fabricates missing raw metadata. On each use, including a cache hit, it excludes the current `message_id` and any history `time` later than the live event. History supplies context only and cannot trigger replies. Raw event fields come from the actual OneBot event, never sender nicknames or forwarded contents. Success returns `{accepted:true,duplicate:false}`, `{accepted:true,duplicate:true}` or `{accepted:false,reason}`; an optional `reason` can explain an accepted event that does not trigger AI. Processing is queued; this endpoint does not wait for the LLM.
- `POST /v1/events` for recalls: `{event:<OneBot v11 raw notice>}` with `post_type:"notice"` and `notice_type:"group_recall"` or `"friend_recall"`. Forward the real `self_id,user_id,message_id,time`; group recall also includes `group_id,operator_id`. Do not attach images/history or stop AstrBot notice propagation. The core scopes the recalled message to the configured bot and corresponding group/private conversation, cancels pending conversation work and invalidates its derived summary. The plugin clears the affected group's history cache. Success returns `{accepted:true}`. Other notice types are not forwarded by the plugin.
- `GET /v1/outbox?bot_id=<id>`: `{items:[{id,kind:"send"|"delete"|"refresh",message_type:"group"|"private",peer_id,text,reply_to,media_id,message_id}]}`. Optional action-specific fields are absent when unused. Delivery items have a lease; the bridge must acknowledge each item before polling again. Repeated polling after lease expiry may return an unacknowledged item, so the plugin retains delivered IDs and retries acknowledgements without resending.
- `POST /v1/ack`: `{id,ok,message_id?,error?}`. Delivery confirmation is idempotent. Known failed sends do not silently retry; the manager shows the failure.
- `GET /v1/media/<media_id>`: authenticated WAV download. The plugin sends it as a voice record after text, without delaying or resending text when TTS fails. The plugin only appends an ACK after all actions belonging to that outbox item complete; each voice is a separate delivery item.

The AstrBot plugin snapshots the catalog at startup and periodically, forwards OneBot events, and polls outbox. Supported send operations are `send_group_msg`, `send_private_msg`, `delete_msg`; refresh obtains `get_login_info`, `get_group_list`, `get_friend_list`. These names are taken from OneBot documentation. Stop AstrBot's default reply for messages accepted by Minto to prevent duplicate AI replies. Also stop the default reply when submission encounters a transport error, timeout, lost/malformed response or no explicit boolean `accepted`: the core may already have queued the event, so an unknown result must not fall through to a second AI. Log a fixed local error without emitting a default AI reply or automatically resubmitting that request. An explicit `accepted:false` leaves subsequent AstrBot processing available. Reject unverified event layouts; do not invent fallback field spellings. Local JSON request/response bodies are bounded at 14 MiB; WAV delivery items are separate from text and bounded at 10 MiB by the bridge.

## Desktop integration contract

Settings acquire a new `qq` group: `enabled` (false), `bot_id` (empty), `save_id` (empty), `shared_notes` (empty), `port` (0 = OS allocated), `private_mode` (`owner`/`all`/`off`, default `owner`). Master QQ is fixed in code, not an editable identity field.

Preload methods, available to the trusted settings page:

- `qqState()` -> QQ public state below.
- `qqPairing()` -> `{url,token}` for explicit setup display/copy.
- `qqConversation(session_id)` -> `{session,messages,memory}`.
- `qqPolicy({session_id,policy})` -> refreshed QQ state.
- `qqMemory({session_id,text,forget})` -> refreshed conversation; `forget:true` establishes a history cutoff and clears derived summaries/indexes.
- `qqSend({session_id,text})` -> `{queued:true}`; plain manual text only.
- `qqWithdraw({session_id,message_id})` -> `{queued:true}`.
- `qqRefresh()` -> `{queued:true}`.

Public state at `state.qq` and `qqState()`:

`{enabled,configured,online,bridge_url,master_qq,bot_id,save_id,last_seen,error,sessions:[{id,kind,peer_id,name,enabled,voice,last_at,last_text}],stats}`.

Conversation result:

`session` includes `id,kind,peer_id,name,policy`. Policy is `{enabled,voice,meme_probability,cooldown_seconds,followup_seconds,keywords}`. Defaults: disabled group, no voice, 0.08 meme probability, 15-second ordinary-message cooldown, 60-second followup, keywords `["薄荷","ミント"]`.

`messages` contains `{id,remote_id,user_id,text,direction,at,status,trigger,reply_to,error}`; direction is `in`/`out`, status is `received`/`generating`/`queued`/`sent`/`failed`/`cancelled`.

`memory` contains `{summary,notes,updated_at,cursor}`. Manual notes are pinned and cannot be overwritten by summaries.

The QQ page is an independent `renderer/qq-settings.js` and `renderer/qq.css`, mounted in `#page-qq`. It can call `window.minto.state()` and `onState()`, use existing appearance/i18n, and save only `{qq:<collected settings>}` using `settingsSave`. Main integration adds the page/nav/script and IPC methods. No direct secrets in renderer state except explicit pairing result.

Automatic port selection is persisted as qq/bridge-port.json {version:1,port:<integer>}; token remains encrypted in bridge-token.enc. Existing bindings fail visibly if that port is occupied. Private sessions start enabled under private_mode; explicit per-session disabling persists.
