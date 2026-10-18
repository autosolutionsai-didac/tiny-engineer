import { baseName, firstString } from "../util.js";

/** Same tool sets as packages/tiny-engineer-antigravity/src/map.js. */
export const READING_TOOLS = new Set([
  "view_file",
  "grep_search",
  "find_by_name",
  "list_dir",
  "read_url_content",
  "read_resource",
  "list_resources",
]);

export const TYPING_TOOLS = new Set([
  "write_to_file",
  "replace_file_content",
  "run_command",
  "generate_image",
  "call_mcp_tool",
]);

/**
 * Antigravity lifecycle hook → session update. The hook type is not in the
 * payload; vibebot-send passes it as `?type=` (from `--type X` or the first
 * positional argument, like `tiny-engineer-antigravity PreToolUse`).
 *
 * Antigravity's payload has no documented session id, so several plausible
 * keys are tried and the working directory is the fallback.
 *
 * @param {Record<string, any>} payload
 * @param {{ type?: string, cwd?: string }} [meta]
 */
export function mapAntigravity(payload, meta = {}) {
  const type = meta.type;
  if (!type) return null;
  const p = payload && typeof payload === "object" ? payload : {};

  const cwd = firstString(
    p.cwd,
    p.workspaceRoot,
    p.workspace_root,
    Array.isArray(p.workspaceRoots) ? p.workspaceRoots[0] : undefined,
    Array.isArray(p.workspace_roots) ? p.workspace_roots[0] : undefined,
    meta.cwd
  );
  const id =
    firstString(
      p.conversationId,
      p.conversation_id,
      p.cascadeId,
      p.trajectoryId,
      p.sessionId,
      p.session_id
    ) ?? (cwd ? `cwd-${cwd}` : undefined);
  if (!id) return null;
  const base = { agent: "antigravity", id, label: baseName(cwd) };

  switch (type) {
    case "PreInvocation":
      return { ...base, state: "working", activity: "thinking" };
    case "PreToolUse": {
      const tool = p.toolCall?.name;
      let activity = "thinking";
      if (READING_TOOLS.has(tool)) activity = "reading";
      else if (TYPING_TOOLS.has(tool)) activity = "typing";
      return { ...base, state: "working", activity };
    }
    case "PostToolUse":
      return p.error
        ? { ...base, state: "error" }
        : { ...base, state: "working", activity: "thinking" };
    case "Stop":
      return p.error || p.terminationReason === "error"
        ? { ...base, state: "error" }
        : { ...base, state: "idle" };
    default:
      return null;
  }
}

/**
 * JSON that Antigravity expects on stdout (same as tiny-engineer-antigravity).
 * @param {string | undefined} type
 */
export function antigravityResponse(type) {
  return type === "PreToolUse" || type === "Stop" ? { decision: "allow" } : {};
}
