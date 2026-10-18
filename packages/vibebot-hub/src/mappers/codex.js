import { activityForTool, baseName, firstString } from "../util.js";

/**
 * Codex CLI → session update. Two input shapes:
 *
 * 1. Lifecycle hooks (`[features] hooks = true`, `[[hooks.<Event>]]` in
 *    ~/.codex/config.toml or ~/.codex/hooks.json): stdin JSON with
 *    `hook_event_name`, `session_id`, `cwd`, `turn_id`, `tool_name`, …
 *    (Claude Code-compatible field names).
 * 2. The legacy `notify` program: one JSON argument with `type`
 *    ("agent-turn-complete"), `thread-id`, `turn-id`, `cwd`,
 *    `input-messages`, `last-assistant-message`, optional `client`.
 *    Only turn completion is sent today; "approval-requested" is accepted
 *    in case a later Codex forwards it.
 */
const HOOKS = new Map([
  ["UserPromptSubmit", { state: "working", activity: "reading" }],
  ["SubagentStart", { state: "working", activity: "thinking" }],
  ["PostToolUse", { state: "working", activity: "thinking" }],
  ["PreCompact", { state: "working", activity: "thinking" }],
  ["PostCompact", { state: "working", activity: "thinking" }],
  ["PermissionRequest", { state: "waiting" }],
  ["Stop", { state: "idle" }],
  ["Interrupt", { state: "idle" }],
  ["SessionEnd", { state: "ended" }],
]);

const NOTIFY = new Map([
  ["agent-turn-complete", { state: "idle" }],
  ["approval-requested", { state: "waiting" }],
]);

/**
 * @param {Record<string, any>} event
 * @param {{ cwd?: string, type?: string }} [meta]
 */
export function mapCodex(event, meta = {}) {
  if (!event || typeof event !== "object") return null;

  const cwd = firstString(event.cwd, meta.cwd);
  const id =
    firstString(
      event.session_id,
      event["thread-id"],
      event.thread_id,
      event["session-id"],
      event.conversation_id
    ) ?? (cwd ? `cwd-${cwd}` : undefined);
  if (!id) return null;
  const base = { agent: "codex", id, label: baseName(cwd) };

  const hook = firstString(event.hook_event_name, meta.type);
  if (hook && !NOTIFY.has(hook)) {
    if (hook === "SessionStart") return { ...base, state: undefined };
    if (hook === "PreToolUse") {
      return { ...base, state: "working", activity: activityForTool(event.tool_name) };
    }
    const mapped = HOOKS.get(hook);
    if (mapped) return { ...base, ...mapped };
    if (!event.type) return null;
  }

  const notify = NOTIFY.get(event.type ?? hook);
  return notify ? { ...base, ...notify } : null;
}
