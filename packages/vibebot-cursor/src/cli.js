import { DEFAULT_URL, getBaseUrl, getToken, loadDotEnv } from "./env.js";
import { animationForEvent } from "./map.js";
import { postAnim } from "./post.js";

function printHelp() {
  console.log(`Usage: vibebot-cursor [options]

Cursor hook helper: read event JSON from stdin, pick an animation, POST to the robot.

Options:
  --url <base>   Robot base URL (default: VIBEBOT_URL, else ${DEFAULT_URL})
  -h, --help     Show this help

Auth:
  If VIBEBOT_TOKEN is set (process env or project-root .env), requests
  send Authorization: Bearer <token>. Must match the device access_token.
  No token → no Authorization header (device auth disabled).
  TINY_ENGINEER_TOKEN / TINY_ENGINEER_URL are still read as deprecated
  fallbacks when the VIBEBOT_* names are unset.

Hook mode (no animation args):
  Cursor pipes JSON with hook_event_name (tool_name for preToolUse,
  status for stop). The CLI maps the event to reading / thinking / typing /
  ring / abort / error and POSTs \${url}/anim?name=…. Unknown or unmatched events,
  and events whose conversation_id or generation_id is "", exit 0 with no request.

Event map:
  sessionStart, beforeSubmitPrompt, beforeReadFile  → reading
  afterAgentThought, preCompact                     → thinking
  beforeShellExecution, subagentStart, afterFileEdit → typing
  stop + status aborted                             → abort
  stop + status error                               → error
  stop (completed / missing / other)                → ring
  preToolUse + Read                                 → reading
  preToolUse + edit/search/shell tools              → typing
  other preToolUse tools                            → (skip)

Examples:
  echo '{"hook_event_name":"stop","status":"completed"}' | vibebot-cursor
  echo '{"hook_event_name":"stop","status":"aborted"}' | vibebot-cursor
  echo '{"hook_event_name":"stop","status":"error"}' | vibebot-cursor
  echo '{"hook_event_name":"preToolUse","tool_name":"Read"}' | vibebot-cursor --url http://192.168.1.10
`);
}

/**
 * @param {string[]} argv
 * @returns {{ help: boolean, url?: string, error?: string }}
 */
export function parseArgs(argv) {
  let url;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--url") {
      const next = argv[++i];
      if (!next) return { help: false, url, error: "--url requires a value" };
      url = next;
      continue;
    }
    if (arg.startsWith("--url=")) {
      url = arg.slice("--url=".length);
      if (!url) return { help: false, url, error: "--url requires a value" };
      continue;
    }
    return { help: false, url, error: `Unknown argument: ${arg}` };
  }

  return { help, url };
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", () => resolve(""));
  });
}

/**
 * @param {string[]} argv
 */
export async function run(argv) {
  loadDotEnv();

  const opts = parseArgs(argv);
  if (opts.error) {
    console.error(opts.error);
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    printHelp();
    return;
  }

  const raw = await readStdin();
  let event = null;
  if (raw.trim()) {
    try {
      event = JSON.parse(raw);
    } catch {
      process.exitCode = 0;
      return;
    }
  }

  const anim = animationForEvent(event);
  if (anim) {
    await postAnim(opts.url ?? getBaseUrl(), anim, getToken());
  }
  process.exitCode = 0;
}
