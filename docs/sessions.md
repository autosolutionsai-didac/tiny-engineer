# Multi-session mode

The robot can follow several agent sessions at once (Claude Code, Cursor, Codex, Antigravity, …). Each session reports a small state; the firmware keeps a table of up to **8** sessions, picks **one** animation for the robot, and shows **every** session on the 8-LED bar (XIAO ESP32S3 build).

Code: [`src/sessions/`](../src/sessions/) — table + validation (`session_table.cpp`), arbiter (`arbiter.cpp`), bar colours (`led_bar.cpp`), runtime glue (`sessions.cpp`), AgentDeck client (`agentdeck_client.cpp`). The pure parts are host-tested: `pio test -e native` (`test/test_sessions`).

## Session model

| State | Meaning |
| --- | --- |
| `idle` | Session open, nothing running |
| `working` | Agent busy; `activity` = `typing` / `reading` / `thinking` |
| `waiting` | Agent needs you (permission prompt, question, diff review) |
| `error` | Agent hit a problem |
| `ended` | Removes the session |

- Max 8 sessions (one per LED). A session keeps its LED slot until it ends. When the table is full, the oldest **idle** session is evicted (if none is idle, the least recently updated one).
- A session not updated for **30 min** is dropped. Pushers re-send live sessions as keepalives; a keepalive refreshes this timer but is not treated as a state change.

## What the robot does

Evaluated on every table change and once per second:

1. any `waiting` → `attention`
2. any `error` → `error`
3. any `working` → the activity of the working session whose state/activity changed most recently
4. a session just went `working → idle` → `ring` (once per transition)
5. otherwise → `none`

The firmware only switches when the target changes, and re-posts a still-working target every 60 s so `continuous_timeout` does not kick in. With **no** sessions the robot is in manual mode: `POST /anim` works exactly as before. A manual `POST /anim` while sessions exist pauses arbitration for **15 s**.

LED bar: idle = dim green, working = cyan breathing, waiting = amber fast pulse, error = solid red, just finished = 2 s bright green flash. Lamp LED (index 0) keeps the single-LED animation colours. Details: [api.md#session-led-bar](api.md#session-led-bar).

## Data sources

Both sources can be active at the same time; `GET /sessions` reports `source` = `agentdeck`, `rest`, `mixed`, or `none`.

### 1. vibebot-hub (REST pusher)

A small zero-dependency Node service on your computer (`packages/vibebot-hub`). Agent hooks call the `vibebot-send <agent>` shim, the hub keeps its own session table and pushes it to the robot:

```bash
curl -X POST "http://vibebot.local/session?id=cc-1&state=working&activity=reading&agent=claude-code&label=my-repo"
curl http://vibebot.local/sessions
curl -X POST "http://vibebot.local/sessions/clear"
```

The hub coalesces updates (≤ 4 posts/s), re-posts every live session every 60 s, sends `state=ended` when a session ends, and calls `POST /sessions/clear` on startup. Use `Authorization: Bearer <token>` when the robot has an `access_token`. Params and responses: [api.md#sessions](api.md#sessions).

### 2. AgentDeck daemon (automatic, LAN)

With the `agentdeck` setting **on** (default) and Wi-Fi connected, the robot:

1. browses mDNS `_agentdeck._tcp` every 10 s, preferring the service whose TXT has `agent=daemon`;
2. reads the TXT `token` (the daemon requires it for non-local clients) and connects to `ws://<ip>:<port>/?token=<token>`;
3. on every `sessions_list` message, replaces all AgentDeck-sourced sessions.

| AgentDeck | Robot |
| --- | --- |
| `processing` | `working` |
| `awaiting_permission`, `awaiting_option`, `awaiting_diff` | `waiting` |
| `idle` | `idle` |
| `disconnected`, or `alive: false` | removed |
| `currentTool` `Read` / `Grep` / `Glob` / `LS` / `WebFetch` / `WebSearch` | activity `reading` |
| `currentTool` `Edit` / `Write` / `MultiEdit` / `NotebookEdit` / `Bash` / `Shell` | activity `typing` |
| any other / empty tool | activity `thinking` |

`id`, `projectName` and `agentType` become the session id, label and agent (sanitised to the REST rules). Reconnects back off exponentially from 1 s to 30 s and re-run discovery each time; if the daemon stays unreachable for 60 s its sessions are cleared. The client runs in its own FreeRTOS task (mDNS queries and TCP connects block), so the main loop never waits on the network. The token is never logged.

Turn it off with `POST /settings?agentdeck=off` or the Config page if you only use the hub.

## Troubleshooting

- `GET /sessions` empty while agents run: check the hub is running / pointed at the robot, or that the AgentDeck daemon is on the same 2.4 GHz LAN and mDNS is not blocked (guest/isolated Wi-Fi).
- Robot ignores `POST /anim`: sessions exist and arbitration took over again after the 15 s manual window. `POST /sessions/clear` (REST sessions) or turn `agentdeck` off.
- Enable `serial_log=1` to see `[sessions]` and `[agentdeck]` lines on USB serial.
