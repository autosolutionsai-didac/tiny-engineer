import test from "node:test";
import assert from "node:assert/strict";
import { createPusher } from "../src/pusher.js";
import { createHub } from "../src/hub.js";

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/** Fake fetch: records calls; `respond` decides the outcome per call. */
function fakeFetch(respond = () => ({ status: 200 })) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    const call = { url, path: u.pathname, params: Object.fromEntries(u.searchParams), init };
    calls.push(call);
    const r = respond(call, calls.length);
    if (r instanceof Error) throw r;
    return { status: r.status, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  fn.calls = calls;
  return fn;
}

const S = (id, state = "working", extra = {}) => ({ id, agent: "claude-code", label: "proj", state, activity: state === "working" ? "typing" : null, ...extra });

test("builds POST /session with params and Bearer token", async () => {
  const clock = fakeClock();
  const fetch = fakeFetch();
  const p = createPusher({ fetch, now: clock.now, robotUrl: "http://robot.local/", token: "sekret" });
  p.enqueue(S("claude-code:abc"));
  await p.tick();
  assert.equal(fetch.calls.length, 1);
  const c = fetch.calls[0];
  assert.equal(c.init.method, "POST");
  assert.equal(c.path, "/session");
  assert.deepEqual(c.params, { id: "claude-code:abc", state: "working", activity: "typing", agent: "claude-code", label: "proj" });
  assert.equal(c.init.headers.Authorization, "Bearer sekret");
  assert.ok(c.url.startsWith("http://robot.local/session?"));
  p.enqueue(S("x", "idle", { label: "My Project" }));
  await p.tick();
  assert.ok(fetch.calls[1].url.includes("label=My%20Project"));
});

test("no token → no Authorization header; activity only for working", async () => {
  const fetch = fakeFetch();
  const p = createPusher({ fetch, now: fakeClock().now });
  p.enqueue(S("a", "idle", { label: "" }));
  await p.tick();
  assert.equal(fetch.calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(fetch.calls[0].params, { id: "a", state: "idle", agent: "claude-code" });
});

test("coalesces per session: only the latest update is sent", async () => {
  const fetch = fakeFetch();
  const p = createPusher({ fetch, now: fakeClock().now });
  p.enqueue(S("a", "working"));
  p.enqueue(S("a", "waiting"));
  p.enqueue(S("a", "idle"));
  p.enqueue(S("b", "working"));
  await p.tick();
  assert.deepEqual(fetch.calls.map((c) => [c.params.id, c.params.state]), [["a", "idle"], ["b", "working"]]);
});

test("rate limit: at most 4 requests per second in total", async () => {
  const clock = fakeClock();
  const fetch = fakeFetch();
  const p = createPusher({ fetch, now: clock.now, maxInflight: 10 });
  for (let i = 0; i < 10; i++) p.enqueue(S(`s${i}`));
  await p.tick();
  assert.equal(fetch.calls.length, 4);
  clock.advance(500);
  await p.tick();
  assert.equal(fetch.calls.length, 4, "same 1 s window");
  clock.advance(500);
  await p.tick();
  assert.equal(fetch.calls.length, 8);
  clock.advance(1000);
  await p.tick();
  assert.equal(fetch.calls.length, 10);
  assert.equal(p.pending, 0);
  // oldest first
  assert.deepEqual(fetch.calls.map((c) => c.params.id), Array.from({ length: 10 }, (_, i) => `s${i}`));
});

test("in-flight cap holds requests while the robot is slow", async () => {
  const fetch = fakeFetch();
  let release;
  const gate = new Promise((r) => (release = r));
  const slow = async (url, init) => {
    await gate;
    return fetch(url, init);
  };
  const p = createPusher({ fetch: slow, now: fakeClock().now, maxInflight: 2 });
  for (let i = 0; i < 4; i++) p.enqueue(S(`s${i}`));
  const t = p.tick();
  assert.equal(p.status().inflight, 2);
  assert.equal(p.status().queued, 2);
  release();
  await t;
  assert.equal(fetch.calls.length, 2);
});

test("failure: retried on a later tick, with backoff; newer update wins", async () => {
  const clock = fakeClock();
  let down = true;
  const fetch = fakeFetch(() => (down ? new TypeError("fetch failed") : { status: 200 }));
  const logs = [];
  const p = createPusher({ fetch, now: clock.now, log: (m) => logs.push(m) });
  p.enqueue(S("a", "working"));
  await p.tick();
  assert.equal(fetch.calls.length, 1);
  assert.equal(p.status().reachable, false);
  assert.equal(p.pending, 1, "kept for retry");
  await p.tick();
  assert.equal(fetch.calls.length, 1, "backing off (250 ms)");
  clock.advance(250);
  await p.tick();
  assert.equal(fetch.calls.length, 2, "retried");
  // second failure → 500 ms backoff; queue a newer update meanwhile
  p.enqueue(S("a", "idle"));
  clock.advance(300);
  await p.tick();
  assert.equal(fetch.calls.length, 2);
  down = false;
  clock.advance(300);
  await p.tick();
  assert.equal(fetch.calls.length, 3);
  assert.equal(fetch.calls[2].params.state, "idle");
  assert.equal(p.pending, 0);
  assert.equal(p.status().reachable, true);
  assert.ok(logs.some((l) => l.includes("unreachable")));
  assert.ok(logs.some((l) => l.includes("reachable at")));
});

test("5xx/503 are retried; 4xx are dropped and logged once without the token", async () => {
  const clock = fakeClock();
  let status = 503;
  const fetch = fakeFetch(() => ({ status }));
  const logs = [];
  const p = createPusher({ fetch, now: clock.now, token: "tok-123", log: (m) => logs.push(m) });
  p.enqueue(S("a"));
  await p.tick();
  assert.equal(p.pending, 1);
  status = 401;
  clock.advance(1000);
  await p.tick();
  assert.equal(p.pending, 0);
  p.enqueue(S("b"));
  clock.advance(1000);
  await p.tick();
  assert.equal(logs.filter((l) => l.includes("VIBEBOT_TOKEN")).length, 1);
  assert.ok(logs.every((l) => !l.includes("tok-123")));
});

test("timeout aborts after timeoutMs and counts as a failure", async () => {
  const hang = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  const p = createPusher({ fetch: hang, now: fakeClock().now, timeoutMs: 20 });
  p.enqueue(S("a"));
  await p.tick();
  assert.equal(p.status().last_error, "timeout");
  assert.equal(p.pending, 1);
});

test("keepalive re-sends live sessions every 60 s", async () => {
  const clock = fakeClock();
  const fetch = fakeFetch();
  const p = createPusher({ fetch, now: clock.now });
  const sessions = [S("a"), S("b", "idle")];
  p.keepalive(sessions); // never pushed → queued
  await p.tick();
  assert.equal(fetch.calls.length, 2);
  clock.advance(59_000);
  p.keepalive(sessions);
  await p.tick();
  assert.equal(fetch.calls.length, 2);
  clock.advance(1_000);
  p.keepalive(sessions);
  await p.tick();
  assert.equal(fetch.calls.length, 4);
});

test("clear request goes to POST /sessions/clear", async () => {
  const fetch = fakeFetch();
  const p = createPusher({ fetch, now: fakeClock().now });
  p.enqueueClear();
  await p.tick();
  assert.equal(fetch.calls[0].path, "/sessions/clear");
});

test("hub: end-to-end mapping → store → pusher, eviction and reap send ended", async () => {
  const clock = fakeClock();
  const fetch = fakeFetch();
  const hub = createHub({ now: clock.now, pusherOptions: { fetch, maxPerSecond: 100, maxInflight: 100 } });
  const r = hub.handle("claude-code", { hook_event_name: "PreToolUse", tool_name: "Read", session_id: "s1", cwd: "/a/proj" });
  assert.equal(r.state, "working");
  assert.equal(r.activity, "reading");
  await hub.tick();
  assert.equal(fetch.calls.at(-1).params.state, "working");
  assert.equal(fetch.calls.at(-1).params.label, "proj");

  // unchanged state → no extra push
  hub.handle("claude-code", { hook_event_name: "PreToolUse", tool_name: "Grep", session_id: "s1", cwd: "/a/proj" });
  await hub.tick();
  assert.equal(fetch.calls.length, 1);

  assert.deepEqual(hub.handle("claude-code", { hook_event_name: "Nope", session_id: "s1" }), { ok: true, ignored: true });
  assert.equal(hub.handle("bogus", {}).ok, false);

  // fill to 9 sessions → one eviction pushes ended
  for (let i = 0; i < 8; i++) {
    clock.advance(1);
    hub.handle("cursor", { hook_event_name: "sessionStart", conversation_id: `c${i}`, workspace_roots: ["/w/x"] });
  }
  await hub.tick();
  const ended = fetch.calls.filter((c) => c.params.state === "ended");
  assert.equal(ended.length, 1);
  assert.equal(ended[0].params.id, "cursor:c0");
  assert.equal(hub.store.size, 8);

  // reap after 30 min idle
  clock.advance(31 * 60_000);
  fetch.calls.length = 0;
  await hub.tick();
  assert.equal(fetch.calls.filter((c) => c.params.state === "ended").length, 7);
  assert.equal(hub.store.size, 1, "working s1 survives (2 h busy TTL)");

  // graceful shutdown ends the rest
  fetch.calls.length = 0;
  await hub.shutdown({ deadlineMs: 500, sleep: async () => {} });
  assert.deepEqual(fetch.calls.map((c) => c.params.state), ["ended"]);
  assert.equal(hub.store.size, 0);
});

test("hub: clearOnStart queues /sessions/clear first", async () => {
  const fetch = fakeFetch();
  const hub = createHub({ now: fakeClock().now, clearOnStart: true, pusherOptions: { fetch } });
  hub.handle("codex", { type: "agent-turn-complete", "thread-id": "t1", cwd: "/p/q" });
  await hub.tick();
  assert.equal(fetch.calls[0].path, "/sessions/clear");
  assert.equal(fetch.calls[1].path, "/session");
});
