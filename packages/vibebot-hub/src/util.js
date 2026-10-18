import { createHash } from "node:crypto";

/** Robot-side session states (see the robot's POST /session). */
export const STATES = new Set(["idle", "working", "waiting", "error", "ended"]);
/** Activities, only meaningful with state=working. */
export const ACTIVITIES = new Set(["typing", "reading", "thinking"]);

const ID_MAX = 40;
const AGENT_MAX = 16;
const LABEL_MAX = 24;

/**
 * Tool names (across Claude Code, Codex, Cursor, AgentDeck) that read context.
 * Antigravity has its own snake_case set in mappers/antigravity.js.
 */
export const READING_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "WebFetch",
  "WebSearch",
  "AwaitShell",
  // Codex built-in tool names (defensive: hooks may report either style).
  "read_file",
  "list_dir",
  "grep_files",
  "view_image",
  "web_search",
]);

/** Tool names that write files or run commands. */
export const TYPING_TOOLS = new Set([
  "Bash",
  "PowerShell",
  "Shell",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  // Cursor
  "StrReplace",
  "EditNotebook",
  "Delete",
  // Codex
  "shell",
  "local_shell",
  "exec_command",
  "write_stdin",
  "apply_patch",
  "unified_exec",
]);

/**
 * Activity for a tool name: reading, typing, or thinking for anything else.
 * @param {unknown} tool
 * @returns {"reading" | "typing" | "thinking"}
 */
export function activityForTool(tool) {
  if (typeof tool !== "string" || !tool) return "thinking";
  if (READING_TOOLS.has(tool)) return "reading";
  if (TYPING_TOOLS.has(tool)) return "typing";
  return "thinking";
}

/**
 * Last path segment of a POSIX or Windows path, or "" if none.
 * @param {unknown} p
 */
export function baseName(p) {
  if (typeof p !== "string") return "";
  let s = p.trim();
  // file:// URIs (Cursor workspace roots can be URIs on some platforms)
  if (s.startsWith("file://")) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
    } catch {
      // keep as-is
    }
  }
  s = s.replace(/[\\/]+$/, "");
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

/**
 * Robot agent token: lowercase `[a-z0-9-]`, ≤16 chars.
 * @param {unknown} agent
 */
export function sanitizeAgent(agent) {
  const s = String(agent ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, AGENT_MAX)
    .replace(/-+$/, "");
  return s || "agent";
}

/**
 * Robot label: printable ASCII, ≤24 chars, or "" when nothing is left.
 * Accents are folded (é → e) so non-English project names survive.
 * @param {unknown} label
 */
export function sanitizeLabel(label) {
  if (typeof label !== "string") return "";
  return label
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LABEL_MAX)
    .trim();
}

/**
 * Deterministic robot session id (1–40 chars, `[A-Za-z0-9._:-]`) for an
 * agent + agent-native session id. Short valid ids are kept readable as
 * `<agent>:<id>`; long or odd ones become `<agent>:<sha1 prefix>`.
 * @param {string} agent sanitized agent token
 * @param {string} rawId
 */
export function robotSessionId(agent, rawId) {
  const id = String(rawId);
  const plain = `${agent}:${id}`;
  if (plain.length <= ID_MAX && /^[A-Za-z0-9._:-]+$/.test(plain)) return plain;
  const prefix = `${agent}:`;
  const hash = createHash("sha1").update(id).digest("hex");
  return prefix + hash.slice(0, Math.max(8, ID_MAX - prefix.length));
}

/**
 * First non-empty string among values.
 * @param {...unknown} values
 * @returns {string | undefined}
 */
export function firstString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}
