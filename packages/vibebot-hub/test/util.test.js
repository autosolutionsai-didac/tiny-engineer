import test from "node:test";
import assert from "node:assert/strict";
import { baseName, robotSessionId, sanitizeAgent, sanitizeLabel } from "../src/util.js";
import { parseHubArgs } from "../src/config.js";

test("robotSessionId keeps short ids readable and hashes long ones", () => {
  assert.equal(robotSessionId("vscode", "vscode:ab12cd34"), "vscode:vscode:ab12cd34");
  const long = robotSessionId("claude-code", "6f1c0a52-1111-4000-8000-000000000000");
  assert.ok(long.startsWith("claude-code:"));
  assert.equal(long.length, 40);
  assert.match(long, /^[A-Za-z0-9._:-]{1,40}$/);
  // deterministic and distinct
  assert.equal(long, robotSessionId("claude-code", "6f1c0a52-1111-4000-8000-000000000000"));
  assert.notEqual(long, robotSessionId("claude-code", "6f1c0a52-1111-4000-8000-000000000001"));
  assert.match(robotSessionId("codex", "cwd-/home/u/x y"), /^codex:[0-9a-f]+$/);
});

test("sanitizeAgent and sanitizeLabel fit the robot's rules", () => {
  assert.equal(sanitizeAgent("Claude Code"), "claude-code");
  assert.equal(sanitizeAgent("a-very-long-agent-name-here"), "a-very-long-agen");
  assert.equal(sanitizeAgent(""), "agent");
  assert.equal(sanitizeLabel("Café ☕ project with a very long name"), "Cafe project with a very");
  assert.equal(sanitizeLabel(undefined), "");
  assert.ok(sanitizeLabel("x".repeat(40)).length <= 24);
});

test("baseName handles POSIX, Windows, trailing slashes and file URIs", () => {
  assert.equal(baseName("/a/b/c"), "c");
  assert.equal(baseName("/a/b/c/"), "c");
  assert.equal(baseName("C:\\Users\\me\\proj"), "proj");
  assert.equal(baseName("file:///Users/me/my%20app"), "my app");
  assert.equal(baseName(undefined), "");
});

test("parseHubArgs: env defaults and flags", () => {
  const d = parseHubArgs([], {});
  assert.equal(d.port, 17826);
  assert.equal(d.robot, "http://tiny-engineer.local");
  assert.equal(d.token, null);
  assert.equal(d.clearOnStart, true);

  const e = parseHubArgs([], {
    VIBEBOT_HUB_PORT: "18000",
    TINY_ENGINEER_URL: "http://10.0.0.5/",
    TINY_ENGINEER_TOKEN: "old",
  });
  assert.equal(e.port, 18000);
  assert.equal(e.robot, "http://10.0.0.5");
  assert.equal(e.token, "old");

  const v = parseHubArgs([], { VIBEBOT_URL: "http://a", TINY_ENGINEER_URL: "http://b", VIBEBOT_TOKEN: "new", TINY_ENGINEER_TOKEN: "old" });
  assert.equal(v.robot, "http://a");
  assert.equal(v.token, "new");

  const f = parseHubArgs(["--port", "17825", "--robot=http://192.168.1.9", "--no-clear", "-q"], { VIBEBOT_URL: "http://a" });
  assert.equal(f.port, 17825);
  assert.equal(f.robot, "http://192.168.1.9");
  assert.equal(f.clearOnStart, false);
  assert.equal(f.quiet, true);

  assert.ok(parseHubArgs(["--port", "x"], {}).error);
  assert.ok(parseHubArgs(["--robot", "tiny.local"], {}).error);
  assert.ok(parseHubArgs(["--wat"], {}).error);
  assert.equal(parseHubArgs(["--help"], {}).help, true);
});
