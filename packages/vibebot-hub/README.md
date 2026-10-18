# vibebot-hub

Zero-dependency Node (≥ 18) hub that shows **every coding-agent session on your machine** on the robot. Agent hooks (Claude Code, Cursor, Codex, Antigravity) and the Vibe Deck VS Code / Chrome extensions report events to the hub. The hub keeps a session table and pushes it to the robot with `POST /session`. The robot then picks the pose (waiting → `attention`, error → `error`, working → `typing|reading|thinking`, working → idle → `ring`) and lights one LED per session.

```text
Claude Code / Cursor / Codex / Antigravity hooks
        │  stdin JSON (Codex notify: argv JSON)
        ▼
  vibebot-send <agent>  ──POST /hook/<agent>──┐   (1 s timeout, silent, exit 0)
                                              ▼
Vibe Deck VS Code ──POST /vscode/register──▶ vibebot-hub (127.0.0.1:17826)
Vibe Deck Chrome  ──POST /event───────────▶   session table (≤ 8, 30-min reaper)
                                              │  POST /session?id=&state=&activity=&agent=&label=
                                              ▼  (coalesced, ≤ 4 req/s, 60 s keepalive)
                                            robot
```

Alternative without the hub: run the [AgentDeck](https://github.com/puritysb/AgentDeck) daemon. The robot finds it over mDNS (`_agentdeck._tcp`) and follows its sessions over WebSocket (setting `agentdeck=on`, the default). Both can run at once; the robot merges them.

## Install

```bash
npm install -g ./packages/vibebot-hub     # from this repo: puts vibebot-hub and vibebot-send on PATH
vibebot-hub --help
```

Without a global install, use `node /abs/path/to/packages/vibebot-hub/bin/vibebot-send.js` wherever this README says `vibebot-send`.

## Run the hub

```bash
vibebot-hub                                  # 127.0.0.1:17826 → http://vibebot.local
vibebot-hub --robot http://192.168.1.42      # robot by IP
VIBEBOT_TOKEN=… vibebot-hub                  # robot has an access_token
vibebot-hub --port 17825                     # also serve the Vibe Deck extensions unchanged
```

| Setting | Flag | Env | Default |
|---|---|---|---|
| Listen port (always 127.0.0.1) | `--port` | `VIBEBOT_HUB_PORT` | `17826` |
| Robot URL | `--robot` | `VIBEBOT_URL`, else deprecated `TINY_ENGINEER_URL` | `http://vibebot.local` |
| Bearer token | — | `VIBEBOT_TOKEN`, else deprecated `TINY_ENGINEER_TOKEN` | none (no header) |
| Clear stale REST sessions at start | `--no-clear` turns it off | — | on (`POST /sessions/clear`) |
| Quiet logs | `-q` | — | logs to stderr |

The token is never logged. `vibebot-send` reads `VIBEBOT_HUB_PORT` too, so set it in both places if you change the port.

Run at login: [`examples/com.vibebot.hub.plist`](examples/com.vibebot.hub.plist) (macOS launchd) or [`examples/vibebot-hub.service`](examples/vibebot-hub.service) (systemd user unit). Both stop the hub with SIGTERM. On SIGTERM or SIGINT the hub posts `state=ended` for every session, waiting up to 3 s.

### Hub routes

| Route | Body | Notes |
|---|---|---|
| `POST /hook/claude-code` | Claude Code hook JSON | `?cwd=` fallback label |
| `POST /hook/cursor` | Cursor hook JSON | |
| `POST /hook/codex` | Codex hook JSON or `notify` JSON | `?type=` hook name if the payload lacks it |
| `POST /hook/antigravity?type=<Hook>` | Antigravity hook JSON | hook type is not in the payload |
| `POST /event` | Vibe Deck event | also generic `{agent, sessionId, project, event|state, activity}` |
| `POST /vscode/register` | Vibe Deck VS Code register/end | |
| `GET /vscode/commands` | — | long-poll stub (answers `{}` after 55 s) so the VS Code extension does not spin |
| `POST /lovable/hello` | — | Vibe Deck Chrome liveness ping, ignored |
| `GET /sessions` | — | `{ok, sessions:[{id, agent, label, state, activity, age_s, updated_s}], robot}` |
| `GET /health` | — | `{ok, name, uptime_s, sessions, events, ignored, robot:{url, reachable, last_error, …}}` |

Requests that carry a web page `Origin` or a non-local `Host` get `403`. This blocks drive-by browser requests and DNS rebinding. Extension origins (`chrome-extension://…`) are allowed.

### Behaviour

- **Session id on the robot:** `<agent>:<native id>` when it fits the robot's 40-char `[A-Za-z0-9._:-]` rule. Otherwise `<agent>:<sha1 prefix>`, which is always the case for UUIDs. The label is the project folder name, folded to printable ASCII, max 24 chars.
- **Table:** max 8 sessions. A new one evicts the oldest idle session, or the least recently updated one if none is idle. The evicted session is sent to the robot as `ended`. `ended` removes a session. Idle and error sessions are reaped after 30 min without events. Working and waiting sessions are reaped after 2 h, so a long build or an unanswered permission prompt stays visible.
- **Pushing:** only changes are sent (state, activity or label). Updates are coalesced per session, at most 4 requests start per second (2 in flight), and each request times out after 1.5 s. A failed request is retried on a later tick with a 250 ms → 10 s backoff while the robot is offline; a newer update replaces the retry. `4xx` responses are dropped and logged once. Every live session is re-sent every 60 s so the robot's own 30-min reaper never drops it.

## `vibebot-send <agent> [--type X] [--port N] [json]`

- `<agent>` is one of `claude-code`, `cursor`, `codex`, `antigravity`.
- Reads hook JSON from stdin, or from a JSON argument, which is how Codex `notify` passes it. With a JSON argument, stdin is not read.
- Strips prompts, file contents and tool output before sending (`tool_input`, `prompt`, `last-assistant-message`, …).
- POSTs to `http://127.0.0.1:<VIBEBOT_HUB_PORT|17826>/hook/<agent>?type=&cwd=` with a 1 s timeout.
- Prints nothing and always exits 0, calling `process.exit` explicitly so no socket keeps Node alive. A missing hub never stalls the agent. Claude Code and Codex add some hook stdout to the model context, so silence matters.
- **Antigravity exception:** prints the decision JSON Antigravity expects (`{"decision":"allow"}` for `PreToolUse`/`Stop`, `{}` otherwise), even when the hub is down.

## Event maps

`(keep)` means the session is registered or touched: the current state is kept, and a new session starts `idle`. `working/x` means state `working` with activity `x`. Unlisted events are ignored.

### Claude Code (`session_id`, label = `cwd` basename)

| Hook | Session |
|---|---|
| `SessionStart` | (keep) |
| `UserPromptSubmit` | working/reading |
| `PreToolUse` `Read` `Grep` `Glob` `LS` `WebFetch` `WebSearch` | working/reading |
| `PreToolUse` `Bash` `PowerShell` `Edit` `Write` `MultiEdit` `NotebookEdit` | working/typing |
| `PreToolUse` other tools | working/thinking |
| `PostToolUse`, `PostToolBatch`, `SubagentStart`, `PreCompact` | working/thinking |
| `PermissionRequest` | waiting |
| `Notification` `permission_prompt` / `elicitation_dialog` (or no type + "permission" in the message) | waiting |
| `Notification` other types (`idle_prompt`, …) | ignored |
| `PostToolUseFailure`, `StopFailure` | error |
| `Stop` | idle |
| `SessionEnd` (reason ≠ `clear`/`resume`) | ended |
| `SessionEnd` `clear` / `resume`, `PermissionDenied`, `SubagentStop` | ignored |

### Cursor (`conversation_id`, label = `workspace_roots[0]` basename)

| Hook | Session |
|---|---|
| `sessionStart` | (keep) |
| `beforeSubmitPrompt`, `beforeReadFile` | working/reading |
| `preToolUse` | working + activity by tool (`Read`/`Grep`/`Glob`/… reading; `Shell`/`Write`/`StrReplace`/`Delete`/… typing; else thinking) |
| `beforeShellExecution`, `beforeMCPExecution`, `afterFileEdit`, `subagentStart` | working/typing |
| `afterAgentThought`, `preCompact`, `afterShellExecution`, `afterMCPExecution`, `postToolUse` | working/thinking |
| `postToolUseFailure` | error |
| `stop` `completed` / `aborted` / missing | idle |
| `stop` `error` | error |
| `sessionEnd` | ended |

Events whose `conversation_id` or `generation_id` is `""` are skipped, the same rule as `vibebot-cursor`.

### Antigravity (hook type from `?type=`; id from `conversationId`/`cascadeId`/`trajectoryId`/`sessionId`, else the cwd)

| Hook | Session |
|---|---|
| `PreInvocation` | working/thinking |
| `PreToolUse` `view_file` `grep_search` `find_by_name` `list_dir` `read_url_content` `read_resource` `list_resources` | working/reading |
| `PreToolUse` `write_to_file` `replace_file_content` `run_command` `generate_image` `call_mcp_tool` | working/typing |
| `PreToolUse` other | working/thinking |
| `PostToolUse` (no error) | working/thinking |
| `PostToolUse` with `error` | error |
| `Stop` with `error` or `terminationReason: "error"` | error |
| `Stop` otherwise (`model_stop`, `aborted`, …) | idle |

### Codex (`session_id` / `thread-id`, label = `cwd` basename)

| Event | Session |
|---|---|
| hook `SessionStart` | (keep) |
| hook `UserPromptSubmit` | working/reading |
| hook `PreToolUse` | working + activity by tool (`Bash`/`shell`/`exec_command`/`apply_patch` typing; `read_file`/`list_dir`/`grep_files`/`web_search` reading; else thinking) |
| hook `PostToolUse`, `SubagentStart`, `PreCompact`, `PostCompact` | working/thinking |
| hook `PermissionRequest` | waiting |
| hook `Stop`, `Interrupt` | idle |
| hook `SessionEnd` | ended |
| notify `agent-turn-complete` | idle |
| notify `approval-requested` (if a future Codex forwards it) | waiting |

### Vibe Deck extensions (`sessionId`, label = `project`, else `cwd` basename)

| `event` | Session |
|---|---|
| `register` (VS Code) | (keep) |
| `end` (VS Code) | ended |
| `tool` (Chrome: stream opened / Lovable build started) | working/typing |
| `stop` (Chrome: quiet done) | idle |
| `notify` (Chrome: "your turn" after a long or unattended turn) | idle (the robot rings on working → idle) |
| `notify` with `error`/`fail` in `detail` (Lovable build failed) | error |
| generic `start`, `prompt`, `working`, `waiting`/`permission`, `error`, `idle`, `ended` | as named (`state` + `activity` fields are honoured too) |

`agent` is passed through (`vscode`, `lovable`, `claude`, `chatgpt`, `grok`).

## Hook configuration

### Claude Code: `~/.claude/settings.json`

Every hook is `async`, so Claude Code never waits on it.

```json
{
  "hooks": {
    "SessionStart":       [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "SessionEnd":         [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "UserPromptSubmit":   [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "PreToolUse":         [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "PostToolUse":        [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "PostToolUseFailure": [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "SubagentStart":      [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "PreCompact":         [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "PermissionRequest":  [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "Notification":       [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "Stop":               [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }],
    "StopFailure":        [{ "hooks": [{ "type": "command", "command": "vibebot-send claude-code", "async": true }] }]
  }
}
```

The project hooks in this repo's `.claude/settings.json` still drive `/anim` directly through `vibebot-claude-code`. Use one or the other per robot: once the hub has sessions, the robot's session arbitration owns the pose.

### Cursor: `~/.cursor/hooks.json` (or a project `.cursor/hooks.json`)

```json
{
  "version": 1,
  "hooks": {
    "sessionStart":         [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "sessionEnd":           [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "beforeSubmitPrompt":   [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "afterAgentThought":    [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "preCompact":           [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "preToolUse":           [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "postToolUse":          [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "postToolUseFailure":   [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "beforeReadFile":       [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "beforeShellExecution": [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "subagentStart":        [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "afterFileEdit":        [{ "command": "vibebot-send cursor", "timeout": 2 }],
    "stop":                 [{ "command": "vibebot-send cursor", "timeout": 2 }]
  }
}
```

### Antigravity: `~/.gemini/config/hooks.json`

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

### Codex: `~/.codex/config.toml`

`notify` alone gives turn-complete only (session goes idle). Lifecycle hooks add working, waiting and ended. Hooks must be trusted once with `/hooks` inside Codex. `notify` must sit above the first `[table]`.

```toml
notify = ["vibebot-send", "codex"]

[features]
hooks = true

[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type = "command"
command = "vibebot-send codex"
timeout = 3

[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "vibebot-send codex"
timeout = 3

[[hooks.PreToolUse]]
matcher = "*"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "vibebot-send codex"
timeout = 3

[[hooks.PostToolUse]]
matcher = "*"
[[hooks.PostToolUse.hooks]]
type = "command"
command = "vibebot-send codex"
timeout = 3

[[hooks.PermissionRequest]]
[[hooks.PermissionRequest.hooks]]
type = "command"
command = "vibebot-send codex"
timeout = 3

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "vibebot-send codex"
timeout = 3

[[hooks.SessionEnd]]
[[hooks.SessionEnd.hooks]]
type = "command"
command = "vibebot-send codex"
timeout = 1
```

Codex runs a single `notify` program. If another tool (for example the AgentDeck installer) already owns `notify`, keep it and rely on the hooks: hook arrays take several handlers.

### Vibe Deck VS Code and Chrome extensions

Both extensions post to the hardcoded `127.0.0.1:17825`. The VS Code extension's `vibedeck.port` setting can change its port; the Chrome extension's port is fixed in its manifest. When the Vibe Deck daemon is **not** running, start the hub on that port and both extensions work unchanged:

```bash
vibebot-hub --port 17825
```

Hook shims must then use the same port: `export VIBEBOT_HUB_PORT=17825` in the environment that agents inherit, or add `--port 17825` to each `vibebot-send` command.

## Smoke test

```bash
vibebot-hub --robot http://vibebot.local &
echo '{"hook_event_name":"UserPromptSubmit","session_id":"demo","cwd":"/tmp/demo"}' | vibebot-send claude-code
curl -s http://127.0.0.1:17826/sessions
echo '{"hook_event_name":"Stop","session_id":"demo","cwd":"/tmp/demo"}' | vibebot-send claude-code
```

## Tests

```bash
npm test --prefix packages/vibebot-hub
```

No robot or network needed: the pusher tests use a fake `fetch` and a fake clock, and the server tests listen on port 0.
