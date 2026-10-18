import { activityForTool, baseName, firstString } from "../util.js";

/**
 * Cursor hook → session update. Mirrors packages/vibebot-cursor/src/map.js:
 * reading/typing/thinking poses become working + activity, stop becomes
 * idle (or error for status=error).
 */
const SIMPLE = {
  beforeSubmitPrompt: { state: "working", activity: "reading" },
  beforeReadFile: { state: "working", activity: "reading" },
  afterAgentThought: { state: "working", activity: "thinking" },
  preCompact: { state: "working", activity: "thinking" },
  beforeShellExecution: { state: "working", activity: "typing" },
  beforeMCPExecution: { state: "working", activity: "typing" },
  afterShellExecution: { state: "working", activity: "thinking" },
  afterMCPExecution: { state: "working", activity: "thinking" },
  subagentStart: { state: "working", activity: "typing" },
  afterFileEdit: { state: "working", activity: "typing" },
  postToolUse: { state: "working", activity: "thinking" },
  postToolUseFailure: { state: "error" },
  sessionEnd: { state: "ended" },
};

/**
 * @param {Record<string, any>} event Cursor hook stdin JSON
 * @param {{ cwd?: string }} [meta]
 */
export function mapCursor(event, meta = {}) {
  if (!event || typeof event !== "object") return null;
  // Same rule as the /anim CLI: explicit empty ids are background noise.
  if (event.conversation_id === "" || event.generation_id === "") return null;

  const name = event.hook_event_name;
  if (typeof name !== "string" || !name) return null;

  const roots = Array.isArray(event.workspace_roots) ? event.workspace_roots : [];
  const root = firstString(...roots, meta.cwd);
  const id =
    firstString(event.conversation_id, event.session_id) ??
    (root ? `ws-${root}` : undefined);
  if (!id) return null;
  const base = { agent: "cursor", id, label: baseName(root) };

  if (name === "sessionStart") return { ...base, state: undefined };

  if (name === "preToolUse") {
    return { ...base, state: "working", activity: activityForTool(event.tool_name) };
  }

  if (name === "stop") {
    return { ...base, state: event.status === "error" ? "error" : "idle" };
  }

  const simple = SIMPLE[name];
  return simple ? { ...base, ...simple } : null;
}
