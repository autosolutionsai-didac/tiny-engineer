import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createHub } from "../src/hub.js";
import { createServer } from "../src/server.js";
import { parseSendArgs, slim } from "../src/send.js";

const BIN = fileURLToPath(new URL("../bin/vibebot-send.js", import.meta.url));

/** A port with nothing listening on it. */
function freePort() {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Run vibebot-send. `stdin` undefined = leave the pipe open (never EOF).
 */
function runSend(args, { stdin, port, env = {} } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, VIBEBOT_HUB_PORT: String(port), ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("exit", (code) => resolve({ code, out, err, ms: Date.now() - t0 }));
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

async function startHub(t) {
  const fetch = async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
  const hub = createHub({ pusherOptions: { fetch } });
  const srv = createServer({ hub, longPollMs: 50 });
  const port = await srv.listen(0);
  t.after(() => srv.close());
  return { hub, port };
}

test("parseSendArgs: agent, --type, positional type, argv JSON, --port", () => {
  assert.deepEqual(parseSendArgs(["claude-code"]), { agent: "claude-code" });
  assert.deepEqual(parseSendArgs(["antigravity", "--type", "Stop"]), { agent: "antigravity", type: "Stop" });
  assert.deepEqual(parseSendArgs(["antigravity", "PreToolUse"]), { agent: "antigravity", type: "PreToolUse" });
  assert.deepEqual(parseSendArgs(["codex", '{"type":"agent-turn-complete"}']), { agent: "codex", json: '{"type":"agent-turn-complete"}' });
  assert.deepEqual(parseSendArgs(["cursor", "--port=18001", "--weird"]), { agent: "cursor", port: 18001 });
  assert.deepEqual(parseSendArgs(["cursor", "--port", "nope"]), { agent: "cursor" });
  assert.deepEqual(parseSendArgs([]), {});
});

test("slim drops prompts, file contents and tool output; keeps ids and names", () => {
  const s = slim({
    hook_event_name: "PreToolUse",
    session_id: "s",
    cwd: "/a",
    tool_name: "Write",
    tool_input: { file_path: "/a/b", content: "x".repeat(100000) },
    prompt: "secret prompt",
    workspace_roots: ["/w", { no: 1 }],
    toolCall: { name: "view_file", args: { path: "/x" } },
    "last-assistant-message": "long answer",
    huge: "y".repeat(5000),
  });
  assert.deepEqual(Object.keys(s).sort(), ["cwd", "hook_event_name", "huge", "session_id", "tool_name", "toolCall", "workspace_roots"].sort());
  assert.deepEqual(s.toolCall, { name: "view_file" });
  assert.deepEqual(s.workspace_roots, ["/w"]);
  assert.equal(s.huge.length, 256);
  assert.deepEqual(slim(null), {});
  assert.deepEqual(slim([1, 2]), {});
});

test("hub down: exits 0 silently and fast", async () => {
  const port = await freePort();
  const r = await runSend(["claude-code"], { stdin: '{"hook_event_name":"Stop","session_id":"s"}', port });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
  assert.equal(r.err, "");
  assert.ok(r.ms < 2000, `took ${r.ms} ms`);
});

test("hub down: garbage input, no agent, unknown agent all exit 0 silently", async () => {
  const port = await freePort();
  for (const args of [["claude-code"], [], ["Not An Agent!"], ["cursor", "--port", "0"]]) {
    const r = await runSend(args, { stdin: "not json{{", port });
    assert.equal(r.code, 0, args.join(" "));
    assert.equal(r.out, "");
  }
});

test("hub down: antigravity still prints its hook decision", async () => {
  const port = await freePort();
  let r = await runSend(["antigravity", "PreToolUse"], { stdin: "{}", port });
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out), { decision: "allow" });
  r = await runSend(["antigravity", "--type", "PreInvocation"], { stdin: "", port });
  assert.deepEqual(JSON.parse(r.out), {});
});

test("hub that accepts but never answers: gives up after ~1 s, exit 0", async (t) => {
  const s = createNetServer(() => {}); // accept, never respond
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  t.after(() => s.close());
  const r = await runSend(["claude-code"], { stdin: '{"hook_event_name":"Stop","session_id":"s"}', port: s.address().port });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
  assert.ok(r.ms >= 900 && r.ms < 2500, `took ${r.ms} ms`);
});

test("stdin never closed (Codex notify) with argv JSON: does not wait on stdin", async () => {
  const port = await freePort();
  const r = await runSend(["codex", '{"type":"agent-turn-complete","thread-id":"t"}'], { port });
  assert.equal(r.code, 0);
  assert.ok(r.ms < 1500, `took ${r.ms} ms`);
});

test("hub up: event reaches the hub (stdin, argv JSON, antigravity type, cwd)", async (t) => {
  const { hub, port } = await startHub(t);
  let r = await runSend(["claude-code"], {
    stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", session_id: "s1", cwd: "/x/proj", tool_input: { content: "big" } }),
    port,
  });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
  r = await runSend(["codex", JSON.stringify({ type: "agent-turn-complete", "thread-id": "th", cwd: "/x/api" })], { port });
  assert.equal(r.code, 0);
  r = await runSend(["antigravity", "Stop"], { stdin: JSON.stringify({ terminationReason: "error" }), port });
  assert.deepEqual(JSON.parse(r.out), { decision: "allow" });

  const byAgent = Object.fromEntries(hub.snapshot().map((s) => [s.agent, s]));
  assert.equal(byAgent["claude-code"].state, "working");
  assert.equal(byAgent["claude-code"].activity, "typing");
  assert.equal(byAgent["claude-code"].label, "proj");
  assert.equal(byAgent.codex.state, "idle");
  assert.equal(byAgent.codex.label, "api");
  assert.equal(byAgent.antigravity.state, "error");
  // antigravity has no session id in the payload → falls back to vibebot-send's cwd
  assert.ok(byAgent.antigravity.label.length > 0);
});
