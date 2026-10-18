import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_URL, getBaseUrl, getToken, loadDotEnv } from "../src/env.js";

const KEYS = ["VIBEBOT_TOKEN", "VIBEBOT_URL", "TINY_ENGINEER_TOKEN", "TINY_ENGINEER_URL"];

function withEnv(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    fn();
  } finally {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "vibebot-antigravity-env-"));
}

test("default URL is http://vibebot.local", () => {
  withEnv({}, () => {
    assert.equal(DEFAULT_URL, "http://vibebot.local");
    assert.equal(getBaseUrl(), DEFAULT_URL);
    assert.equal(getToken(), null);
  });
});

test("VIBEBOT_URL and VIBEBOT_TOKEN are read from the environment", () => {
  withEnv({ VIBEBOT_URL: "http://10.0.0.7/", VIBEBOT_TOKEN: " tok " }, () => {
    assert.equal(getBaseUrl(), "http://10.0.0.7");
    assert.equal(getToken(), "tok");
  });
});

test("deprecated TINY_ENGINEER_URL / TINY_ENGINEER_TOKEN are still honoured", () => {
  withEnv({ TINY_ENGINEER_URL: "http://10.0.0.8/", TINY_ENGINEER_TOKEN: "old" }, () => {
    assert.equal(getBaseUrl(), "http://10.0.0.8");
    assert.equal(getToken(), "old");
  });
});

test("VIBEBOT_* wins over deprecated TINY_ENGINEER_*", () => {
  withEnv(
    {
      VIBEBOT_URL: "http://new",
      VIBEBOT_TOKEN: "new",
      TINY_ENGINEER_URL: "http://old",
      TINY_ENGINEER_TOKEN: "old",
    },
    () => {
      assert.equal(getBaseUrl(), "http://new");
      assert.equal(getToken(), "new");
    }
  );
});

test("cwd .env wins over ~/.gemini/config/.env, across old and new names", () => {
  const cwd = tempDir();
  const home = tempDir();
  mkdirSync(join(home, ".gemini", "config"), { recursive: true });
  writeFileSync(join(cwd, ".env"), "TINY_ENGINEER_URL=http://cwd\n");
  writeFileSync(
    join(home, ".gemini", "config", ".env"),
    "VIBEBOT_URL=http://home\nVIBEBOT_TOKEN=hometok\n"
  );
  withEnv({}, () => {
    loadDotEnv(cwd, home);
    assert.equal(getBaseUrl(), "http://cwd");
    assert.equal(getToken(), "hometok");
  });
});
