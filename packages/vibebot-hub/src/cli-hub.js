import { parseHubArgs } from "./config.js";
import { createHub } from "./hub.js";
import { createServer } from "./server.js";

const HELP = `Usage: vibebot-hub [options]

Local hub: receives coding-agent hook events, keeps a session table, and
pushes POST /session updates to the robot.

Options:
  --port <n>       Listen port on 127.0.0.1 (default: VIBEBOT_HUB_PORT, else 17826).
                   Use --port 17825 to receive the Vibe Deck VS Code / Chrome
                   extensions unchanged (stop the Vibe Deck daemon first).
  --robot <url>    Robot base URL (default: VIBEBOT_URL, else deprecated TINY_ENGINEER_URL,
                   else http://vibebot.local)
  --no-clear       Do not POST /sessions/clear to the robot at start-up
  -q, --quiet      No log output
  -h, --help       Show this help

Auth: VIBEBOT_TOKEN (else deprecated TINY_ENGINEER_TOKEN) is sent as
Authorization: Bearer <token>. It is never logged.

Routes: POST /hook/<claude-code|cursor|codex|antigravity>, POST /event,
POST /vscode/register, GET /sessions, GET /health.
`;

/** @param {string[]} argv */
export async function run(argv) {
  const opts = parseHubArgs(argv);
  if (opts.error) {
    console.error(opts.error);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const log = opts.quiet
    ? () => {}
    : (m) => console.error(`${new Date().toISOString()} vibebot-hub: ${m}`);

  const hub = createHub({
    log,
    clearOnStart: opts.clearOnStart,
    pusherOptions: { robotUrl: opts.robot, token: opts.token },
  });
  const server = createServer({ hub, port: opts.port, log });

  try {
    await server.listen(opts.port);
  } catch (err) {
    log(`cannot listen on 127.0.0.1:${opts.port}: ${err?.code || err?.message}`);
    process.exitCode = 1;
    return;
  }
  log(`robot ${opts.robot}${opts.token ? " (token set)" : ""}`);

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: ending ${hub.store.size} session(s)`);
    await server.close();
    await hub.shutdown({ deadlineMs: 3000 });
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}
