import { ACTIVITIES, STATES, baseName, firstString } from "../util.js";

/**
 * Vibe Deck-style events (POST /event and POST /vscode/register).
 *
 * Shapes accepted (from the Vibe Deck VS Code and Chrome extensions):
 *
 *   VS Code  → /vscode/register
 *     { _vibedeck_synthetic, agent: "vscode", surface: "vscode-window",
 *       sessionId: "vscode:<windowId>", windowId, project, workspacePath,
 *       windowTitle, event: "register" | "end" }
 *
 *   Chrome   → /event
 *     { _vibedeck_synthetic, agent: "lovable"|"claude"|"chatgpt"|"grok",
 *       surface, sessionId, threadId, cwd: "/<Label>/<title>",
 *       event: "tool" | "stop" | "notify", detail, reason }
 *
 * Plus a small generic vocabulary so scripts can post
 * `{ agent, sessionId, project, event: "working" }` or `{ ..., state, activity }`.
 */
const EVENTS = new Map([
  // Vibe Deck vocabulary
  ["register", { state: undefined }],
  ["start", { state: undefined }],
  ["session_start", { state: undefined }],
  ["tool", { state: "working", activity: "typing" }], // 'generating' / 'building'
  ["prompt", { state: "working", activity: "reading" }],
  ["stop", { state: "idle" }],
  ["end", { state: "ended" }],
  ["session_end", { state: "ended" }],
  ["permission", { state: "waiting" }],
  // Generic names
  ["working", { state: "working" }],
  ["idle", { state: "idle" }],
  ["waiting", { state: "waiting" }],
  ["error", { state: "error" }],
  ["ended", { state: "ended" }],
]);

/**
 * @param {Record<string, any>} msg
 * @param {{ cwd?: string }} [_meta]
 */
export function mapVibeDeck(msg, _meta = {}) {
  if (!msg || typeof msg !== "object") return null;

  const id = firstString(msg.sessionId, msg.session_id, msg.id);
  if (!id) return null;
  const label =
    firstString(msg.project, msg.label) ??
    (baseName(msg.cwd) || baseName(msg.workspacePath) || firstString(msg.surface) || "");
  const agent = firstString(msg.agent) ?? "vibedeck";
  const base = { agent, id, label };

  // Direct state wins when it is valid.
  if (typeof msg.state === "string" && STATES.has(msg.state)) {
    const out = { ...base, state: msg.state };
    if (msg.state === "working") {
      out.activity = ACTIVITIES.has(msg.activity) ? msg.activity : "thinking";
    }
    return out;
  }

  const event = typeof msg.event === "string" ? msg.event : "";

  // 'notify' = Vibe Deck's amber "your turn" after a long or unattended turn.
  // For the robot that is a finished turn (idle → it rings), unless the
  // detail says the build failed.
  if (event === "notify") {
    const failed = /error|fail/i.test(String(msg.detail ?? ""));
    return { ...base, state: failed ? "error" : "idle" };
  }

  const mapped = EVENTS.get(event);
  if (!mapped) return null;
  const out = { ...base, ...mapped };
  if (out.state === "working" && !out.activity) {
    out.activity = ACTIVITIES.has(msg.activity) ? msg.activity : "thinking";
  }
  return out;
}
