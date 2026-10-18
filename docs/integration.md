# Integrating Tiny Engineer

Tiny Engineer is a Wi-Fi desk robot. Drive it from any tool that can make HTTP requests, use one of the dedicated helpers (Cursor, Antigravity, Claude Code) that map agent hook events to poses, or run the session hub to show several agents at once.

Robot must be on the same network. Base URL: `http://tiny-engineer.local` (or the IP shown on the OLED). Full HTTP reference: [`api.md`](api.md).

Five integration paths:

| Path | Best for | How |
|---|---|---|
| **REST API** | Any AI IDE, script, CI, custom agent | `POST /anim?name=…` |
| **Cursor CLI** | Cursor project hooks | `npx` → `tiny-engineer-cursor` |
| **Antigravity CLI** | Antigravity CLI lifecycle hooks | `tiny-engineer-antigravity` |
| **Claude Code CLI** | Claude Code project hooks | `tiny-engineer-claude-code` |
| **Session hub** | Several agents / windows at once (Claude Code, Cursor, Codex, Antigravity, Vibe Deck extensions) | `vibebot-hub` + `vibebot-send` → `POST /session` |

```mermaid
flowchart TB
  subgraph anyIde [Any AI IDE or script]
    HookOrScript[Agent event or your code]
    HookOrScript --> Post["POST /anim?name=typing|reading|…"]
  end
  subgraph cursorPath [Cursor]
    CursorHook[Cursor hooks.json]
    CursorHook --> Npx["npx tiny-engineer-cursor"]
    Npx --> Post
  end
  subgraph antigravityPath [Antigravity]
    AgHook[Antigravity hooks.json]
    AgHook --> AgCli["tiny-engineer-antigravity"]
    AgCli --> Post
  end
  subgraph claudeCodePath [Claude Code]
    CcHook[Claude Code settings.json]
    CcHook --> CcCli["tiny-engineer-claude-code"]
    CcCli --> Post
  end
  Post --> Robot[Tiny Engineer on Wi-Fi]
```

---

## 1. REST API (any AI IDE)

Call the board directly. Works with Claude Code, Windsurf, Continue, custom plugins, shell hooks, or anything that can `POST` over HTTP.

### Main call

```bash
curl -X POST "http://tiny-engineer.local/anim?name=typing"
```

| `name` | Typical use |
|---|---|
| `typing` | Agent writing / editing / running tools |
| `reading` | Agent reading files / context |
| `thinking` | Agent reasoning / waiting on a long step |
| `ring` | Turn finished (attention ping) |
| `welcome` | Session start / greeting |
| `wakeup` | Sleep-inertia wake (eyes/head) |
| `sleep` | Force sleep (eye close + OLED off) |
| `attention` | Needs user input |
| `error` / `abort` | Failure / cancel |
| `dead` | Out of power (`dead.wav`, then X X hold) |
| `none` | Idle / clear pose |

Firmware holds each pose ≥1s and keeps only the **latest** pending switch — spam-safe. Auth is optional: if you set an access token on the device, send `Authorization: Bearer <token>` (check `GET /auth` for `required`). Prefer short timeouts (e.g. 2s) and ignore network errors so the agent never stalls if the robot is offline.

### Minimal examples

**Shell**

```bash
curl -4 -sS -m 2 -X POST "http://tiny-engineer.local/anim?name=reading" >/dev/null || true
```

**JavaScript (Node 18+)**

```js
await fetch("http://tiny-engineer.local/anim?name=thinking", {
  method: "POST",
  signal: AbortSignal.timeout(2000),
}).catch(() => {});
```

**Python**

```python
import urllib.request
urllib.request.urlopen(
    urllib.request.Request(
        "http://tiny-engineer.local/anim?name=typing",
        method="POST",
    ),
    timeout=2,
)
```

Wire these into your IDE’s hook / plugin / lifecycle events (prompt submitted → `reading`, tool use → `typing`, turn end → `ring`, etc.). Mapping is yours; the robot only cares about `name`.

Health check (no motion):

```bash
curl http://tiny-engineer.local/health
```

More routes (tests, servo, web UI): [`api.md`](api.md).

---

## 2. Cursor dedicated script

For [Cursor](https://cursor.com/) only: a small Node CLI reads Cursor hook JSON on stdin, picks an animation, and POSTs `/anim`. No need to implement the event map yourself.

### Command

```bash
npx -y --package=https://github.com/jamro/tiny-engineer/archive/refs/heads/main.tar.gz tiny-engineer-cursor
```

- HTTPS **tarball** (not `github:…` SSH shorthand — that often fails in Cursor hooks with no SSH agent).
- Bin name `tiny-engineer-cursor` required after `--package=…`.
- Optional: `--url http://192.168.x.x` (default `http://tiny-engineer.local`).
- Auth: if the device has an `access_token`, set `TINY_ENGINEER_TOKEN` in the process env or a project-root `.env` file (same value). The CLI sends `Authorization: Bearer …`. No token → no header (auth disabled on device).
- `--help` for usage and event map.

### Smoke test

```bash
npx -y --package=https://github.com/jamro/tiny-engineer/archive/refs/heads/main.tar.gz tiny-engineer-cursor --help
echo '{"hook_event_name":"stop"}' | npx -y --package=https://github.com/jamro/tiny-engineer/archive/refs/heads/main.tar.gz tiny-engineer-cursor
```

### Wire into any Cursor project

In that project’s `.cursor/hooks.json`, use the same command for each anim hook. Set **`timeout` ≥ 30** (cold `npx` can exceed 2s). Full sample + event table: [`hooks.md`](hooks.md).

Inside this firmware repo you can instead run the local bin while developing the CLI:

```bash
node packages/tiny-engineer-cursor/bin/tiny-engineer-cursor.js
```

---

## 3. Antigravity CLI dedicated script

For [Google Antigravity](https://github.com/google/antigravity) (`antigravity-cli`): a lightweight Node CLI receives Antigravity lifecycle hook payloads on stdin, maps the agent lifecycle / tool calls to animations, and responds with the expected hook decision JSON while posting `/anim`.

### Event Mapping
- **`PreInvocation`** (Model thinking) → `thinking`
- **`PreToolUse`** (Reading tools: `view_file`, `grep_search`, `find_by_name`, `list_dir`, etc.) → `reading`
- **`PreToolUse`** (Writing tools: `write_to_file`, `replace_file_content`, `run_command`) → `typing`
- **`PostToolUse`** (Tool error) → `attention`
- **`Stop`** (`model_stop` / completion) → `ring` (rings the physical desk bell!)
- **`Stop`** (`error` / `aborted`) → `error` / `abort`

### Setup

Inside this firmware repository, [`.agents/hooks.json`](../.agents/hooks.json) is pre-configured. Run the local bin: `node packages/tiny-engineer-antigravity/bin/tiny-engineer-antigravity.js`. Other machines can `npx -y --package=https://github.com/jamro/tiny-engineer/archive/refs/heads/main.tar.gz tiny-engineer-antigravity` (same tarball pattern as Cursor).

To run globally across all projects on your machine, configure `~/.gemini/config/hooks.json`:

```json
{
  "tiny-engineer": {
    "PreInvocation": [
      {
        "command": "tiny-engineer-antigravity PreInvocation",
        "timeout": 3
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "command": "tiny-engineer-antigravity PreToolUse",
            "timeout": 3
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "command": "tiny-engineer-antigravity PostToolUse",
            "timeout": 3
          }
        ]
      }
    ],
    "Stop": [
      {
        "command": "tiny-engineer-antigravity Stop",
        "timeout": 3
      }
    ]
  }
}
```

---

## 4. Claude Code dedicated script

For [Claude Code](https://code.claude.com/): a small Node CLI reads Claude Code hook JSON on stdin, picks an animation, and POSTs `/anim`. Same shape as the Cursor CLI — one command for every hook, no animation args.

### Event Mapping
- **`SessionStart`** (`startup`, a fresh launch) → `welcome`
- **`SessionStart`** (`resume`, `clear`, `compact`, `fork`, or no `source`) → `wakeup`
- **`SessionEnd`** → `sleep` (skipped for `clear` and `resume`, where the next `SessionStart` wakes the robot)
- **`UserPromptSubmit`** → `reading`
- **`PreToolUse`** (Reading tools: `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`) → `reading`
- **`PreToolUse`** (Writing tools: `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`) → `typing`
- **`SubagentStart`** → `thinking`
- **`PostToolBatch`** (tool results go back to the model) → `thinking`
- **`PostToolUseFailure`** (a tool call failed) → `error`
- **`PreCompact`** → `thinking`
- **`PermissionRequest`** → `attention`
- **`PermissionDenied`** (auto mode denied a tool call) → `abort`
- **`Notification`** (permission prompt, or waiting for input) → `attention`
- **`Stop`** (turn finished) → `ring` (rings the physical desk bell!)
- **`StopFailure`** → `error`

To change the map, edit [`packages/tiny-engineer-claude-code/src/map.js`](../packages/tiny-engineer-claude-code/src/map.js).

### Setup

Inside this firmware repository, [`.claude/settings.json`](../.claude/settings.json) is pre-configured: open the repo in Claude Code (Node.js 18+) and the hooks run `node packages/tiny-engineer-claude-code/bin/tiny-engineer-claude-code.js`.

- Every hook is `"async": true`, so Claude Code runs it in the background — an offline robot never stalls a tool call on the 2s HTTP timeout.
- Robot address: `TINY_ENGINEER_URL` or `--url http://192.168.x.x` (default `http://tiny-engineer.local`).
- Auth: if the device has an `access_token`, set `TINY_ENGINEER_TOKEN` in the process env or a project-root `.env` file. The CLI sends `Authorization: Bearer …`. No token → no header (auth disabled on device). When the token comes from the process env, a `TINY_ENGINEER_URL` in the project `.env` is ignored, so a project can't redirect your token; set the URL in the env or with `--url`.
- The CLI never writes to stdout in hook mode — Claude Code adds `SessionStart` / `UserPromptSubmit` hook stdout to the model's context.
- If a hook never fires, run `/hooks` inside Claude Code to confirm the project settings loaded.

To use it in every project, copy the `hooks` block into `~/.claude/settings.json` and replace `$CLAUDE_PROJECT_DIR/packages/…` with the absolute path to this repo's bin.

### Smoke test

```bash
node packages/tiny-engineer-claude-code/bin/tiny-engineer-claude-code.js --help
echo '{"hook_event_name":"Stop"}' | node packages/tiny-engineer-claude-code/bin/tiny-engineer-claude-code.js
```

---

## 5. Session hub (several agents at once)

The `/anim` helpers above each drive one pose and know nothing about each other. [`packages/vibebot-hub`](../packages/vibebot-hub/) runs one local hub on `127.0.0.1:17826`. It collects events from every agent on the machine, keeps a session table (up to 8, one LED each), and pushes it to the robot with `POST /session?id=&state=&activity=&agent=&label=`. The robot arbitrates the pose: any waiting → `attention`; any error → `error`; working → `typing|reading|thinking`; working → idle → `ring`.

```mermaid
flowchart LR
  CC[Claude Code hooks] --> Send["vibebot-send agent"]
  CU[Cursor hooks] --> Send
  CX[Codex hooks / notify] --> Send
  AG[Antigravity hooks] --> Send
  Send -->|"POST /hook/agent (1 s, silent, exit 0)"| Hub["vibebot-hub 127.0.0.1:17826"]
  VS[Vibe Deck VS Code] -->|POST /vscode/register| Hub
  CR[Vibe Deck Chrome] -->|POST /event| Hub
  Hub -->|"POST /session (≤ 4/s, 60 s keepalive)"| Robot[Robot]
  AD[AgentDeck daemon] -.->|"WebSocket, mDNS _agentdeck._tcp"| Robot
```

**Alternative, no hub:** if you already run the [AgentDeck](https://github.com/puritysb/AgentDeck) daemon, the robot discovers it over mDNS and follows its sessions over WebSocket (setting `agentdeck=on`, the default). Hub and AgentDeck can run together; the robot merges both sources.

### Setup

```bash
npm install -g ./packages/vibebot-hub          # vibebot-hub + vibebot-send on PATH
vibebot-hub --robot http://tiny-engineer.local  # VIBEBOT_URL / TINY_ENGINEER_URL also work
```

- Auth: `VIBEBOT_TOKEN` (else `TINY_ENGINEER_TOKEN`) is sent as `Authorization: Bearer …` and never logged.
- Run at login: [launchd plist](../packages/vibebot-hub/examples/com.vibebot.hub.plist) (macOS) or [systemd user unit](../packages/vibebot-hub/examples/vibebot-hub.service) (Linux). On SIGTERM the hub posts `state=ended` for every session.
- Hub status: `curl http://127.0.0.1:17826/sessions` and `/health`.
- `vibebot-send` never writes to stdout, which Claude Code and Codex would feed to the model, and always exits 0 within about 1 s, even when the hub is down. The one exception is Antigravity, which gets the decision JSON it requires.
- Use the hub **or** the `/anim` helpers for a given agent, not both.

### Hook snippets

Claude Code, `~/.claude/settings.json`: add the same entry under `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `PreCompact`, `PermissionRequest`, `Notification`, `Stop` and `StopFailure`:

```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }] } }
```

Cursor, `~/.cursor/hooks.json` (same entry per event: `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `afterAgentThought`, `preCompact`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `beforeReadFile`, `beforeShellExecution`, `subagentStart`, `afterFileEdit`, `stop`):

```json
{ "version": 1, "hooks": { "stop": [{ "command": "vibebot-send cursor", "timeout": 2 }] } }
```

Antigravity, `~/.gemini/config/hooks.json` (hook type as the second argument):

```json
{
  "vibebot": {
    "PreInvocation": [{ "command": "vibebot-send antigravity PreInvocation", "timeout": 3 }],
    "PreToolUse":    [{ "matcher": "*", "hooks": [{ "command": "vibebot-send antigravity PreToolUse", "timeout": 3 }] }],
    "PostToolUse":   [{ "matcher": "*", "hooks": [{ "command": "vibebot-send antigravity PostToolUse", "timeout": 3 }] }],
    "Stop":          [{ "command": "vibebot-send antigravity Stop", "timeout": 3 }]
  }
}
```

Codex, `~/.codex/config.toml`. `notify` (turn complete) must come before any table. Lifecycle hooks add working, waiting and ended, and need a one-time `/hooks` trust inside Codex:

```toml
notify = ["vibebot-send", "codex"]

[features]
hooks = true

[[hooks.PreToolUse]]
matcher = "*"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "vibebot-send codex"
timeout = 3
# repeat for SessionStart, UserPromptSubmit, PostToolUse, PermissionRequest, Stop, SessionEnd
```

Vibe Deck extensions: the VS Code extension (`/vscode/register`) and the Chrome extension (`/event`) hardcode `127.0.0.1:17825`. When the Vibe Deck daemon is not running, start `vibebot-hub --port 17825` and both work unchanged. Then set `VIBEBOT_HUB_PORT=17825` for the hook shims too.

Full event → state tables, hub routes and behaviour: [`packages/vibebot-hub/README.md`](../packages/vibebot-hub/README.md).

---

## Which to choose?

- **Building for one IDE / custom agent** → REST. One `POST`, zero Node dependency.
- **Using Cursor and want zero mapping code** → Cursor CLI + hooks.
- **Using Antigravity CLI** → Antigravity CLI + hooks.
- **Using Claude Code** → Claude Code CLI + hooks.
- **Several agents or windows at once** → session hub (`vibebot-hub`), or the AgentDeck daemon with no hub.
- **The four `/anim` paths** are fine together: the CLIs are thin clients of the same `/anim` API. The session hub replaces them for the agents it covers.

Prerequisites for any path: flash firmware, join 2.4 GHz Wi-Fi, confirm `http://tiny-engineer.local/health` (or the OLED IP) responds.

---

## Optional extras

Same `POST /anim` API; not part of the paths above. On macOS you can run a small host helper that POSTs `sleep` / `wakeup` when the screen locks or unlocks: [`macos-lock-unlock.md`](macos-lock-unlock.md). The robot does not need it.
