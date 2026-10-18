import test from "node:test";
import assert from "node:assert/strict";
import {
  mapAntigravity,
  mapClaudeCode,
  mapCodex,
  mapCursor,
  mapVibeDeck,
} from "../src/mappers/index.js";
import { antigravityResponse } from "../src/mappers/antigravity.js";

const pick = (m) => (m ? { state: m.state, activity: m.activity } : null);

// ---------------------------------------------------------------- Claude Code

const cc = (hook_event_name, extra = {}) =>
  mapClaudeCode({ hook_event_name, session_id: "s1", cwd: "/home/u/proj-a", ...extra });

test("claude-code: identity from session_id and cwd basename", () => {
  const m = cc("Stop");
  assert.equal(m.agent, "claude-code");
  assert.equal(m.id, "s1");
  assert.equal(m.label, "proj-a");
});

test("claude-code: event → state/activity table", () => {
  assert.deepEqual(pick(cc("SessionStart", { source: "startup" })), { state: undefined, activity: undefined });
  assert.deepEqual(pick(cc("UserPromptSubmit")), { state: "working", activity: "reading" });
  assert.deepEqual(pick(cc("SubagentStart")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cc("PostToolBatch")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cc("PostToolUse")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cc("PreCompact")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cc("PermissionRequest")), { state: "waiting", activity: undefined });
  assert.deepEqual(pick(cc("PostToolUseFailure")), { state: "error", activity: undefined });
  assert.deepEqual(pick(cc("StopFailure")), { state: "error", activity: undefined });
  assert.deepEqual(pick(cc("Stop")), { state: "idle", activity: undefined });
  assert.equal(cc("PermissionDenied"), null);
  assert.equal(cc("SubagentStop"), null);
  assert.equal(cc("Bogus"), null);
});

test("claude-code: PreToolUse activity by tool", () => {
  for (const t of ["Read", "Grep", "Glob", "WebFetch", "WebSearch", "LS"]) {
    assert.equal(cc("PreToolUse", { tool_name: t }).activity, "reading", t);
  }
  for (const t of ["Bash", "PowerShell", "Edit", "Write", "MultiEdit", "NotebookEdit"]) {
    assert.equal(cc("PreToolUse", { tool_name: t }).activity, "typing", t);
  }
  for (const t of ["Task", "mcp__x__y", undefined]) {
    const m = cc("PreToolUse", { tool_name: t });
    assert.equal(m.state, "working");
    assert.equal(m.activity, "thinking", String(t));
  }
});

test("claude-code: Notification only waits on permission/elicitation", () => {
  assert.equal(cc("Notification", { notification_type: "permission_prompt" }).state, "waiting");
  assert.equal(cc("Notification", { notification_type: "elicitation_dialog" }).state, "waiting");
  assert.equal(cc("Notification", { notification_type: "idle_prompt" }), null);
  assert.equal(cc("Notification", { notification_type: "auth_success" }), null);
  assert.equal(cc("Notification", { message: "Claude needs your permission to use Bash" }).state, "waiting");
  assert.equal(cc("Notification", { message: "Claude is waiting for your input" }), null);
});

test("claude-code: SessionEnd ends, except clear/resume", () => {
  assert.equal(cc("SessionEnd", { reason: "prompt_input_exit" }).state, "ended");
  assert.equal(cc("SessionEnd").state, "ended");
  assert.equal(cc("SessionEnd", { reason: "clear" }), null);
  assert.equal(cc("SessionEnd", { reason: "resume" }), null);
});

test("claude-code: missing ids fall back to cwd, junk is ignored", () => {
  assert.equal(mapClaudeCode(null), null);
  assert.equal(mapClaudeCode({}), null);
  assert.equal(mapClaudeCode({ hook_event_name: "Stop" }), null);
  const m = mapClaudeCode({ hook_event_name: "Stop" }, { cwd: "/x/y" });
  assert.equal(m.id, "cwd-/x/y");
  assert.equal(m.label, "y");
});

// --------------------------------------------------------------------- Cursor

const cu = (hook_event_name, extra = {}) =>
  mapCursor({
    hook_event_name,
    conversation_id: "c-1",
    generation_id: "g-1",
    workspace_roots: ["/Users/me/site"],
    ...extra,
  });

test("cursor: identity from conversation_id and workspace_roots", () => {
  const m = cu("stop");
  assert.equal(m.agent, "cursor");
  assert.equal(m.id, "c-1");
  assert.equal(m.label, "site");
});

test("cursor: event → state/activity table", () => {
  assert.equal(cu("sessionStart").state, undefined);
  assert.deepEqual(pick(cu("beforeSubmitPrompt")), { state: "working", activity: "reading" });
  assert.deepEqual(pick(cu("beforeReadFile")), { state: "working", activity: "reading" });
  assert.deepEqual(pick(cu("afterAgentThought")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cu("preCompact")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cu("beforeShellExecution")), { state: "working", activity: "typing" });
  assert.deepEqual(pick(cu("beforeMCPExecution")), { state: "working", activity: "typing" });
  assert.deepEqual(pick(cu("afterShellExecution")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cu("subagentStart")), { state: "working", activity: "typing" });
  assert.deepEqual(pick(cu("afterFileEdit")), { state: "working", activity: "typing" });
  assert.deepEqual(pick(cu("postToolUse")), { state: "working", activity: "thinking" });
  assert.equal(cu("postToolUseFailure").state, "error");
  assert.equal(cu("sessionEnd").state, "ended");
  assert.equal(cu("stop").state, "idle");
  assert.equal(cu("stop", { status: "completed" }).state, "idle");
  assert.equal(cu("stop", { status: "aborted" }).state, "idle");
  assert.equal(cu("stop", { status: "error" }).state, "error");
  assert.equal(cu("afterAgentResponse"), null);
});

test("cursor: preToolUse activity by tool", () => {
  assert.equal(cu("preToolUse", { tool_name: "Read" }).activity, "reading");
  assert.equal(cu("preToolUse", { tool_name: "Grep" }).activity, "reading");
  assert.equal(cu("preToolUse", { tool_name: "StrReplace" }).activity, "typing");
  assert.equal(cu("preToolUse", { tool_name: "Shell" }).activity, "typing");
  assert.equal(cu("preToolUse", { tool_name: "Task" }).activity, "thinking");
});

test("cursor: empty ids skip, missing conversation falls back to workspace", () => {
  assert.equal(cu("stop", { conversation_id: "" }), null);
  assert.equal(cu("stop", { generation_id: "" }), null);
  const m = mapCursor({ hook_event_name: "stop", workspace_roots: ["/a/b"] });
  assert.equal(m.id, "ws-/a/b");
  assert.equal(mapCursor({ hook_event_name: "stop" }), null);
  assert.equal(mapCursor({ hook_event_name: "stop" }, { cwd: "/q/r" }).label, "r");
});

// ---------------------------------------------------------------- Antigravity

const ag = (type, payload = {}) => mapAntigravity({ conversationId: "ag-1", ...payload }, { type, cwd: "/w/app" });

test("antigravity: hook type → state/activity table", () => {
  assert.deepEqual(pick(ag("PreInvocation")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(ag("PreToolUse", { toolCall: { name: "view_file" } })), { state: "working", activity: "reading" });
  assert.deepEqual(pick(ag("PreToolUse", { toolCall: { name: "grep_search" } })), { state: "working", activity: "reading" });
  assert.deepEqual(pick(ag("PreToolUse", { toolCall: { name: "run_command" } })), { state: "working", activity: "typing" });
  assert.deepEqual(pick(ag("PreToolUse", { toolCall: { name: "write_to_file" } })), { state: "working", activity: "typing" });
  assert.deepEqual(pick(ag("PreToolUse", { toolCall: { name: "invoke_subagent" } })), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(ag("PreToolUse")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(ag("PostToolUse")), { state: "working", activity: "thinking" });
  assert.equal(ag("PostToolUse", { error: "boom" }).state, "error");
  assert.equal(ag("Stop", { terminationReason: "model_stop" }).state, "idle");
  assert.equal(ag("Stop", { terminationReason: "aborted" }).state, "idle");
  assert.equal(ag("Stop", { terminationReason: "error" }).state, "error");
  assert.equal(ag("Stop", { error: "x" }).state, "error");
  assert.equal(ag("Unknown"), null);
  assert.equal(mapAntigravity({}, {}), null);
});

test("antigravity: identity keys and cwd fallback", () => {
  const m = ag("Stop");
  assert.equal(m.agent, "antigravity");
  assert.equal(m.id, "ag-1");
  assert.equal(m.label, "app");
  const f = mapAntigravity({}, { type: "Stop", cwd: "/w/other" });
  assert.equal(f.id, "cwd-/w/other");
  assert.equal(f.label, "other");
});

test("antigravity: stdout contract", () => {
  assert.deepEqual(antigravityResponse("PreToolUse"), { decision: "allow" });
  assert.deepEqual(antigravityResponse("Stop"), { decision: "allow" });
  assert.deepEqual(antigravityResponse("PreInvocation"), {});
  assert.deepEqual(antigravityResponse(undefined), {});
});

// ---------------------------------------------------------------------- Codex

const cx = (hook_event_name, extra = {}) =>
  mapCodex({ hook_event_name, session_id: "019a-thread", cwd: "/r/codex-proj", turn_id: "t1", ...extra });

test("codex hooks: event → state/activity table", () => {
  assert.equal(cx("SessionStart", { source: "startup" }).state, undefined);
  assert.deepEqual(pick(cx("UserPromptSubmit")), { state: "working", activity: "reading" });
  assert.deepEqual(pick(cx("PreToolUse", { tool_name: "Bash" })), { state: "working", activity: "typing" });
  assert.deepEqual(pick(cx("PreToolUse", { tool_name: "apply_patch" })), { state: "working", activity: "typing" });
  assert.deepEqual(pick(cx("PreToolUse", { tool_name: "shell" })), { state: "working", activity: "typing" });
  assert.deepEqual(pick(cx("PreToolUse", { tool_name: "read_file" })), { state: "working", activity: "reading" });
  assert.deepEqual(pick(cx("PreToolUse", { tool_name: "mcp__foo" })), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cx("PostToolUse")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cx("SubagentStart")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cx("PreCompact")), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(cx("PostCompact")), { state: "working", activity: "thinking" });
  assert.equal(cx("PermissionRequest").state, "waiting");
  assert.equal(cx("Stop").state, "idle");
  assert.equal(cx("Interrupt").state, "idle");
  assert.equal(cx("SessionEnd", { reason: "other" }).state, "ended");
  assert.equal(cx("SubagentStop"), null);
  const m = cx("Stop");
  assert.equal(m.agent, "codex");
  assert.equal(m.id, "019a-thread");
  assert.equal(m.label, "codex-proj");
});

test("codex notify: agent-turn-complete payload", () => {
  const m = mapCodex({
    type: "agent-turn-complete",
    "thread-id": "th-9",
    "turn-id": "tu-1",
    cwd: "/Users/me/api",
    "input-messages": ["hi"],
    "last-assistant-message": "done",
    client: "codex-tui",
  });
  assert.deepEqual(
    { agent: m.agent, id: m.id, label: m.label, state: m.state },
    { agent: "codex", id: "th-9", label: "api", state: "idle" }
  );
  assert.equal(mapCodex({ type: "approval-requested", "thread-id": "th-9" }).state, "waiting");
  assert.equal(mapCodex({ type: "something-else", "thread-id": "th-9" }), null);
  // notify without thread id: cwd from vibebot-send
  assert.equal(mapCodex({ type: "agent-turn-complete" }, { cwd: "/z/k" }).id, "cwd-/z/k");
  assert.equal(mapCodex({ type: "agent-turn-complete" }), null);
  assert.equal(mapCodex(null), null);
});

test("codex: --type can name the hook when the payload lacks it", () => {
  assert.equal(mapCodex({ session_id: "s" }, { type: "Stop" }).state, "idle");
});

// ------------------------------------------------------------------- Vibe Deck

test("vibedeck: VS Code register/end", () => {
  const reg = {
    _vibedeck_synthetic: true,
    agent: "vscode",
    surface: "vscode-window",
    sessionId: "vscode:ab12cd34",
    windowId: "ab12cd34",
    project: "my-app",
    workspacePath: "/Users/me/my-app",
    windowTitle: "my-app",
    event: "register",
  };
  const m = mapVibeDeck(reg);
  assert.deepEqual(
    { agent: m.agent, id: m.id, label: m.label, state: m.state },
    { agent: "vscode", id: "vscode:ab12cd34", label: "my-app", state: undefined }
  );
  assert.equal(mapVibeDeck({ ...reg, event: "end" }).state, "ended");
});

test("vibedeck: Chrome observer tool/stop/notify", () => {
  const base = {
    _vibedeck_synthetic: true,
    agent: "claude",
    surface: "claude-web",
    sessionId: "claude-web:6f1c0a52-0000-4000-8000-000000000000",
    threadId: "/chat/abc",
    cwd: "/Claude/Refactor plan",
    detail: "generating",
    reason: null,
  };
  const tool = mapVibeDeck({ ...base, event: "tool" });
  assert.deepEqual(pick(tool), { state: "working", activity: "typing" });
  assert.equal(tool.label, "Refactor plan");
  assert.equal(mapVibeDeck({ ...base, event: "stop", detail: "done" }).state, "idle");
  assert.equal(mapVibeDeck({ ...base, event: "notify", detail: "your turn", reason: "input" }).state, "idle");
  assert.equal(mapVibeDeck({ ...base, event: "notify", detail: "Build failed", reason: "input" }).state, "error");
  const lov = mapVibeDeck({
    _vibedeck_synthetic: true,
    agent: "lovable",
    surface: "lovable-chrome",
    sessionId: "lovable:0f0e0d0c-0b0a-4000-8000-000000000001",
    threadId: "0f0e0d0c-0b0a-4000-8000-000000000001",
    cwd: "/Lovable/Landing",
    event: "tool",
    detail: "building",
  });
  assert.equal(lov.agent, "lovable");
  assert.equal(lov.label, "Landing");
});

test("vibedeck: generic vocabulary and direct state", () => {
  const b = { agent: "script", sessionId: "x1", project: "p" };
  assert.deepEqual(pick(mapVibeDeck({ ...b, event: "working" })), { state: "working", activity: "thinking" });
  assert.deepEqual(pick(mapVibeDeck({ ...b, event: "working", activity: "reading" })), { state: "working", activity: "reading" });
  assert.equal(mapVibeDeck({ ...b, event: "waiting" }).state, "waiting");
  assert.equal(mapVibeDeck({ ...b, event: "permission" }).state, "waiting");
  assert.equal(mapVibeDeck({ ...b, event: "error" }).state, "error");
  assert.equal(mapVibeDeck({ ...b, event: "prompt" }).activity, "reading");
  assert.equal(mapVibeDeck({ ...b, event: "start" }).state, undefined);
  assert.deepEqual(pick(mapVibeDeck({ ...b, state: "working", activity: "typing" })), { state: "working", activity: "typing" });
  assert.equal(mapVibeDeck({ ...b, state: "ended" }).state, "ended");
  assert.equal(mapVibeDeck({ ...b, event: "nonsense" }), null);
  assert.equal(mapVibeDeck({ event: "tool" }), null);
  assert.equal(mapVibeDeck(null), null);
});
