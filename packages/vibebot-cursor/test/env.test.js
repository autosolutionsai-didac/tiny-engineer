import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_URL, getBaseUrl, getToken, loadDotEnv } from "../src/env.js";
import { parseArgs } from "../src/cli.js";

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

function dirWithDotEnv(contents) {
  const dir = mkdtempSync(join(tmpdir(), "vibebot-cursor-env-"));
  writeFileSync(join(dir, ".env"), contents);
  return dir;
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

test(".env supplies URL and token with either name; inherited values win", () => {
  withEnv({}, () => {
    loadDotEnv(dirWithDotEnv("VIBEBOT_URL=http://10.0.0.5\nVIBEBOT_TOKEN=a\n"));
    assert.equal(getBaseUrl(), "http://10.0.0.5");
    assert.equal(getToken(), "a");
  });
  withEnv({}, () => {
    loadDotEnv(dirWithDotEnv("TINY_ENGINEER_URL=http://10.0.0.6\nTINY_ENGINEER_TOKEN=b\n"));
    assert.equal(getBaseUrl(), "http://10.0.0.6");
    assert.equal(getToken(), "b");
  });
  withEnv({ TINY_ENGINEER_URL: "http://10.0.0.9" }, () => {
    loadDotEnv(dirWithDotEnv("VIBEBOT_URL=http://10.0.0.5\n"));
    assert.equal(getBaseUrl(), "http://10.0.0.9");
  });
});

test("parseArgs leaves url unset unless --url is given", () => {
  assert.deepEqual(parseArgs([]), { help: false, url: undefined });
  assert.equal(parseArgs(["--url", "http://10.0.0.5"]).url, "http://10.0.0.5");
  assert.equal(parseArgs(["--url=http://10.0.0.5"]).url, "http://10.0.0.5");
  assert.match(parseArgs(["--url"]).error, /requires a value/);
  assert.match(parseArgs(["--nope"]).error, /Unknown argument/);
});
