import { activityForTool, baseName, firstString } from "../util.js";

/**
 * Claude Code hook → session update. Mirrors the semantics of
 * packages/tiny-engineer-claude-code/src/map.js, but as session state:
 * poses that meant "busy" become working (+activity), attention becomes
 * waiting, error stays error, ring (turn finished) becomes idle and sleep
 * becomes ended.
 *
 * `state: undefined` means "touch / register only": keep the current state
 * (new sessions start idle).
 */
const SIMPLE = new Map([
  ["UserPromptSubmit", { state: "working", activity: "reading" }],
  ["SubagentStart", { state: "working", activity: "thinking" }],
  ["PostToolBatch", { state: "working", activity: "thinking" }],
  ["PostToolUse", { state: "working", activity: "thinking" }],
  ["PreCompact", { state: "working", activity: "thinking" }],
  ["PermissionRequest", { state: "waiting" }],
  ["PostToolUseFailure", { state: "error" }],
  ["StopFailure", { state: "error" }],
  ["Stop", { state: "idle" }],
]);

/** Notification types that mean "the user has to answer something". */
const WAITING_NOTIFICATIONS = new Set(["permission_prompt", "elicitation_dialog"]);

/**
 * @param {Record<string, any>} event Claude Code hook stdin JSON
 * @param {{ cwd?: string }} [meta] extra info from vibebot-send
 */
export function mapClaudeCode(event, meta = {}) {
  if (!event || typeof event !== "object") return null;
  const name = event.hook_event_name;
  if (typeof name !== "string" || !name) return null;

  const cwd = firstString(event.cwd, meta.cwd);
  const id = firstString(event.session_id) ?? (cwd ? `cwd-${cwd}` : undefined);
  if (!id) return null;
  const base = { agent: "claude-code", id, label: baseName(cwd) };

  if (name === "SessionStart") return { ...base, state: undefined };

  // /clear and /resume end one session and start the next at once; the old
  // session id is left to the idle reaper (same skip as the /anim CLI).
  if (name === "SessionEnd") {
    if (event.reason === "clear" || event.reason === "resume") return null;
    return { ...base, state: "ended" };
  }

  if (name === "PreToolUse") {
    return { ...base, state: "working", activity: activityForTool(event.tool_name) };
  }

  if (name === "Notification") {
    const type = event.notification_type;
    if (WAITING_NOTIFICATIONS.has(type)) return { ...base, state: "waiting" };
    // Older Claude Code builds send no notification_type; fall back to text.
    if (type === undefined && /permission/i.test(String(event.message ?? ""))) {
      return { ...base, state: "waiting" };
    }
    return null; // idle_prompt, auth_success, …: nothing changes
  }

  const simple = SIMPLE.get(name);
  return simple ? { ...base, ...simple } : null;
}
