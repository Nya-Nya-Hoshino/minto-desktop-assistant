# Tools in 0.4.0

Use the existing chat window to ask Mint to inspect a file, search a folder or run a command. Mint selects tools when needed and answers in Japanese with the existing voice and Live2D behavior. Tool activity appears in a collapsed panel; expand it to inspect exact inputs, output and errors. Cancel stops model requests and waits for a running command to exit; changes already completed remain.

Settings → Tools and skills enables tools and sets the working directory. Blank uses `agent-workspace` under the application's data directory. Absolute paths can access other locations with the current Windows user's permissions. No individual tool approval is requested. Commands use Windows PowerShell. This is a lightweight capability in the existing chat, with no separate autonomous-agent dashboard or additional LLM configuration.

## Examples

- “List the files in this folder and read the log I name.”
- “Read this configuration and explain the exact error in Japanese.”
- “Run `[Console]::WriteLine('HELLO_MINTO')` and report its actual exit code.”

Files are read as UTF-8; `read_file` reads 200 lines by default. Search is literal, returns up to 200 matches and scans at most 2,000 files. Individual searches skip files above 512 KiB; `read_file` accepts text files up to 2 MiB. Use an appropriate command or skill for larger files. Output is capped at 24,000 characters per tool result, with truncation marked.

## Optional advanced settings

The collapsed advanced section contains a step limit (1–50, default 12) and command timeout (5–600 seconds, default 60). A step is one model round; each round runs requested tools sequentially. If the step limit is reached, Mint reports verified results and any unfinished work.

MCP servers are configured as a JSON array. For stdio, each object uses `id`, `transport: "stdio"`, `command`, `args` and optional `env`. For Streamable HTTP, use `id`, `transport: "http"`, `url` and optional `headers`. Obtain the exact command, arguments and endpoint from your server's documentation; the app does not install servers. Server IDs must be unique. Credentials in `env` and `headers` are encrypted with Windows safeStorage, masked in the UI and excluded from save exports. Keep `__MINTO_KEEP_SECRET__` unchanged to preserve a saved value, or replace it with a new value. Checking tools connects to the server and lists tools without invoking them. OAuth login and legacy HTTP SSE are outside this release.

Skill directories are a JSON array of root paths. Each root contains skill folders with YAML-frontmatter `SKILL.md` files, using the required `name` and `description`; the name matches its folder. Import copies one skill folder into the data directory's `skills` folder. Names must be unique. Mint sees the catalog descriptions and loads relevant instructions and referenced resources only when needed. Bundled `file-inspection` and `command-workflow` cover the basic workflows. Scripts are available through the command tool and require their documented runtimes. Skill import preserves files and rejects links; it does not install dependencies.

The normal conversation, affection and save format continue to work. Tool-generated messages are not treated as new human affection evidence. Screen/file/tool text is context, not authority to replace Mint's personality or the user's task.

## Implementation references

The small local tool loop was informed by the local DeepSeek Harness checkout and the upstream [Pi tool loop](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts) and [OpenCode session processor](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts). MCP uses the official TypeScript SDK, pinned in `package-lock.json`. Skill loading follows the [Agent Skills specification](https://agentskills.io/specification). DeepSeek tool rounds retain call IDs and `reasoning_content` according to its [thinking-mode documentation](https://api-docs.deepseek.com/guides/thinking_mode/). No complete harness platform is bundled.
