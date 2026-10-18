import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";

const MIN = 60_000;

test("new session defaults to idle; touch keeps state", () => {
  const s = createStore();
  let r = s.apply({ id: "a", agent: "x", label: "p" }, 0);
  assert.equal(r.session.state, "idle");
  assert.equal(r.changed, true);
  s.apply({ id: "a", agent: "x", state: "working", activity: "typing" }, 1);
  r = s.apply({ id: "a", agent: "x" }, 2);
  assert.equal(r.session.state, "working");
  assert.equal(r.session.activity, "typing");
  assert.equal(r.changed, false);
  assert.equal(r.session.updatedAt, 2);
});

test("transitions: activity only while working, defaults to thinking", () => {
  const s = createStore();
  s.apply({ id: "a", agent: "x", state: "working" }, 0);
  assert.equal(s.get("a").activity, "thinking");
  let r = s.apply({ id: "a", agent: "x", state: "working", activity: "reading" }, 1);
  assert.equal(r.changed, true);
  r = s.apply({ id: "a", agent: "x", state: "working", activity: "reading" }, 2);
  assert.equal(r.changed, false);
  s.apply({ id: "a", agent: "x", state: "waiting" }, 3);
  assert.equal(s.get("a").activity, null);
  s.apply({ id: "a", agent: "x", state: "error" }, 4);
  assert.equal(s.get("a").state, "error");
  s.apply({ id: "a", agent: "x", state: "idle" }, 5);
  assert.equal(s.get("a").state, "idle");
});

test("label changes count as changes; empty label keeps the old one", () => {
  const s = createStore();
  s.apply({ id: "a", agent: "x", label: "one" }, 0);
  assert.equal(s.apply({ id: "a", agent: "x", label: "" }, 1).changed, false);
  assert.equal(s.get("a").label, "one");
  assert.equal(s.apply({ id: "a", agent: "x", label: "two" }, 2).changed, true);
});

test("ended removes the session and reports it (also for unknown ids)", () => {
  const s = createStore();
  s.apply({ id: "a", agent: "x", label: "p", state: "working" }, 0);
  const r = s.apply({ id: "a", agent: "x", state: "ended" }, 1);
  assert.equal(r.ended.state, "ended");
  assert.equal(r.ended.label, "p");
  assert.equal(s.size, 0);
  const u = s.apply({ id: "zz", agent: "x", state: "ended" }, 2);
  assert.equal(u.ended.id, "zz");
  assert.equal(s.size, 0);
});

test("max 8: evicts the oldest idle session first", () => {
  const s = createStore();
  for (let i = 0; i < 8; i++) {
    s.apply({ id: `s${i}`, agent: "x", state: i % 2 ? "working" : "idle" }, i * 10);
  }
  // s0 (idle, t=0) is the oldest idle; s1 working is older than s2 idle but busy.
  s.apply({ id: "s0", agent: "x", state: "idle" }, 100); // s0 refreshed → s2 is oldest idle
  const r = s.apply({ id: "new", agent: "x", state: "working" }, 200);
  assert.deepEqual(r.evicted.map((e) => e.id), ["s2"]);
  assert.equal(r.evicted[0].state, "ended");
  assert.equal(s.size, 8);
  assert.equal(s.get("s2"), null);
});

test("max 8 with nobody idle: evicts the least recently updated", () => {
  const s = createStore();
  for (let i = 0; i < 8; i++) s.apply({ id: `s${i}`, agent: "x", state: "working" }, i);
  s.apply({ id: "s0", agent: "x", state: "working", activity: "typing" }, 50);
  const r = s.apply({ id: "n", agent: "x" }, 60);
  assert.deepEqual(r.evicted.map((e) => e.id), ["s1"]);
});

test("reap: idle/error after 30 min, working/waiting after 2 h", () => {
  const s = createStore();
  s.apply({ id: "idle", agent: "x", state: "idle" }, 0);
  s.apply({ id: "err", agent: "x", state: "error" }, 0);
  s.apply({ id: "work", agent: "x", state: "working" }, 0);
  s.apply({ id: "wait", agent: "x", state: "waiting" }, 0);
  s.apply({ id: "fresh", agent: "x", state: "idle" }, 20 * MIN);
  assert.deepEqual(s.reap(29 * MIN), []);
  const r1 = s.reap(30 * MIN).map((x) => x.id).sort();
  assert.deepEqual(r1, ["err", "idle"]);
  assert.ok(s.reap(30 * MIN).length === 0);
  assert.deepEqual(s.reap(50 * MIN).map((x) => x.id), ["fresh"]);
  assert.deepEqual(s.reap(120 * MIN).map((x) => x.id).sort(), ["wait", "work"]);
  assert.equal(s.size, 0);
});

test("drain returns everything as ended and empties the table", () => {
  const s = createStore();
  s.apply({ id: "a", agent: "x", state: "working" }, 0);
  s.apply({ id: "b", agent: "x" }, 0);
  const d = s.drain();
  assert.deepEqual(d.map((x) => [x.id, x.state]), [["a", "ended"], ["b", "ended"]]);
  assert.equal(s.size, 0);
});
