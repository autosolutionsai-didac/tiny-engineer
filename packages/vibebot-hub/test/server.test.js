import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createHub } from "../src/hub.js";
import { createServer } from "../src/server.js";

function okFetch() {
  const calls = [];
  const fn = async (url) => {
    calls.push(new URL(url));
    return { status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  fn.calls = calls;
  return fn;
}

/** Minimal HTTP client that lets tests set Host / Origin headers. */
function http(port, method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...headers },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

async function start(t, opts = {}) {
  const fetch = okFetch();
  const hub = createHub({ pusherOptions: { fetch, maxPerSecond: 100, maxInflight: 100 } });
  const srv = createServer({ hub, longPollMs: 50, tickMs: 10, ...opts });
  const port = await srv.listen(0);
  t.after(() => srv.close());
  return { port, hub, fetch, srv };
}

test("binds 127.0.0.1 only", async (t) => {
  const { srv } = await start(t);
  assert.equal(srv.server.address().address, "127.0.0.1");
});

test("GET /health and GET /sessions", async (t) => {
  const { port } = await start(t);
  const h = await http(port, "GET", "/health");
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, true);
  assert.equal(h.json.name, "vibebot-hub");
  assert.equal(h.json.sessions, 0);
  assert.ok("robot" in h.json);
  const s = await http(port, "GET", "/sessions");
  assert.deepEqual(s.json.sessions, []);
  assert.equal((await http(port, "POST", "/health")).status, 405);
});

test("POST /hook/claude-code updates the table and pushes to the robot", async (t) => {
  const { port, fetch } = await start(t);
  const r = await http(port, "POST", "/hook/claude-code", {
    body: { hook_event_name: "PermissionRequest", session_id: "abc", cwd: "/home/me/widget" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.state, "waiting");
  const s = await http(port, "GET", "/sessions");
  assert.equal(s.json.sessions.length, 1);
  assert.equal(s.json.sessions[0].label, "widget");
  assert.equal(s.json.sessions[0].agent, "claude-code");
  // the 10 ms tick pushes it
  for (let i = 0; i < 50 && fetch.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(fetch.calls[0].pathname, "/session");
  assert.equal(fetch.calls[0].searchParams.get("state"), "waiting");
});

test("hook routes for every agent; antigravity type and cwd come from the query", async (t) => {
  const { port } = await start(t);
  let r = await http(port, "POST", "/hook/cursor", { body: { hook_event_name: "beforeSubmitPrompt", conversation_id: "c1", workspace_roots: ["/w/site"] } });
  assert.equal(r.json.state, "working");
  r = await http(port, "POST", "/hook/codex", { body: { type: "agent-turn-complete", "thread-id": "t1", cwd: "/w/api" } });
  assert.equal(r.json.state, "idle");
  r = await http(port, "POST", "/hook/antigravity?type=PreToolUse&cwd=%2Fw%2Fag", { body: { toolCall: { name: "view_file" } } });
  assert.equal(r.json.state, "working");
  assert.equal(r.json.activity, "reading");
  const s = await http(port, "GET", "/sessions");
  assert.deepEqual(s.json.sessions.map((x) => x.label).sort(), ["ag", "api", "site"]);
  r = await http(port, "POST", "/hook/claude-code", { body: { hook_event_name: "Whatever", session_id: "x" } });
  assert.deepEqual(r.json, { ok: true, ignored: true });
  assert.equal((await http(port, "POST", "/hook/unknown", { body: {} })).status, 404);
  assert.equal((await http(port, "GET", "/hook/cursor")).status, 405);
  assert.equal((await http(port, "POST", "/hook/cursor", { body: "{nope" })).status, 400);
  assert.equal((await http(port, "POST", "/hook/cursor", { body: "" })).json.ignored, true);
});

test("Vibe Deck routes: /event, /vscode/register, /lovable/hello", async (t) => {
  const { port } = await start(t);
  let r = await http(port, "POST", "/event", {
    body: { _vibedeck_synthetic: true, agent: "lovable", surface: "lovable-chrome", sessionId: "lovable:0f0e0d0c-0b0a-4000-8000-000000000001", cwd: "/Lovable/Landing", event: "tool", detail: "building" },
    headers: { Origin: "chrome-extension://abcdefghijklmnop" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.state, "working");
  r = await http(port, "POST", "/vscode/register", {
    body: { _vibedeck_synthetic: true, agent: "vscode", surface: "vscode-window", sessionId: "vscode:ab12cd34", windowId: "ab12cd34", project: "my-app", event: "register" },
  });
  assert.equal(r.json.state, "idle");
  assert.equal((await http(port, "GET", "/sessions")).json.sessions.length, 2);
  r = await http(port, "POST", "/vscode/register", { body: { agent: "vscode", sessionId: "vscode:ab12cd34", event: "end" } });
  assert.equal(r.json.state, "ended");
  assert.equal((await http(port, "GET", "/sessions")).json.sessions.length, 1);
  r = await http(port, "POST", "/lovable/hello", { body: { project: "extension installed" } });
  assert.deepEqual(r.json, { ok: true });
});

test("GET /vscode/commands long-polls and answers {}", async (t) => {
  const { port } = await start(t, { longPollMs: 80 });
  const t0 = Date.now();
  const r = await http(port, "GET", "/vscode/commands?windowId=ab12cd34");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, {});
  assert.ok(Date.now() - t0 >= 70);
});

test("close() releases pending long polls", async () => {
  const hub = createHub({ pusherOptions: { fetch: okFetch() } });
  const srv = createServer({ hub, longPollMs: 60_000 });
  const port = await srv.listen(0);
  const pending = http(port, "GET", "/vscode/commands?windowId=x").catch(() => "closed");
  await new Promise((r) => setTimeout(r, 30));
  const t0 = Date.now();
  await srv.close();
  assert.equal(await pending, "closed");
  assert.ok(Date.now() - t0 < 1000);
});

test("browser pages and foreign Host headers are rejected", async (t) => {
  const { port } = await start(t);
  const evil = await http(port, "POST", "/event", { body: { sessionId: "x", event: "working" }, headers: { Origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  const rebind = await http(port, "GET", "/sessions", { headers: { Host: "attacker.example:17826" } });
  assert.equal(rebind.status, 403);
  const local = await http(port, "GET", "/sessions", { headers: { Host: `localhost:${port}` } });
  assert.equal(local.status, 200);
});

test("unknown paths 404, oversized bodies 413", async (t) => {
  const { port } = await start(t);
  assert.equal((await http(port, "GET", "/nope")).status, 404);
  const big = JSON.stringify({ hook_event_name: "Stop", pad: "x".repeat(1024 * 1024 + 10) });
  assert.equal((await http(port, "POST", "/hook/claude-code", { body: big })).status, 413);
});
