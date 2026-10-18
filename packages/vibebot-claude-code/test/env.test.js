import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
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

function projectWithDotEnv(contents) {
  const dir = mkdtempSync(join(tmpdir(), "vibebot-claude-code-env-"));
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
  withEnv({ VIBEBOT_URL: " http://10.0.0.7// ", VIBEBOT_TOKEN: " tok " }, () => {
    assert.equal(getBaseUrl(), "http://10.0.0.7");
    assert.equal(getToken(), "tok");
  });
});

test("deprecated TINY_ENGINEER_* names are still honoured", () => {
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

test("empty VIBEBOT_* falls back to deprecated names", () => {
  withEnv({ VIBEBOT_URL: " ", VIBEBOT_TOKEN: "", TINY_ENGINEER_URL: "http://old", TINY_ENGINEER_TOKEN: "old" }, () => {
    assert.equal(getBaseUrl(), "http://old");
    assert.equal(getToken(), "old");
  });
});

test("a project .env can set both the token and the URL", () => {
  const dir = projectWithDotEnv("VIBEBOT_TOKEN=projtok\nVIBEBOT_URL=http://10.0.0.5/\n");
  withEnv({}, () => {
    loadDotEnv(dir);
    assert.equal(getToken(), "projtok");
    assert.equal(getBaseUrl(), "http://10.0.0.5");
  });
});

test("a project .env with deprecated names still works", () => {
  const dir = projectWithDotEnv(
    "TINY_ENGINEER_TOKEN=projtok\nTINY_ENGINEER_URL=http://10.0.0.5/\n"
  );
  withEnv({}, () => {
    loadDotEnv(dir);
    assert.equal(getToken(), "projtok");
    assert.equal(getBaseUrl(), "http://10.0.0.5");
  });
});

test("a project .env cannot redirect a token inherited from the environment", () => {
  const dir = projectWithDotEnv("VIBEBOT_URL=http://10.0.0.5\nTINY_ENGINEER_URL=http://10.0.0.6\n");
  for (const tokenKey of ["VIBEBOT_TOKEN", "TINY_ENGINEER_TOKEN"]) {
    withEnv({ [tokenKey]: "envtok" }, () => {
      loadDotEnv(dir);
      assert.equal(getToken(), "envtok");
      assert.equal(getBaseUrl(), DEFAULT_URL);
    });
  }
});

test("a project .env token does not replace an inherited deprecated token", () => {
  const dir = projectWithDotEnv("VIBEBOT_TOKEN=projtok\n");
  withEnv({ TINY_ENGINEER_TOKEN: "envtok" }, () => {
    loadDotEnv(dir);
    assert.equal(getToken(), "envtok");
  });
});

test("an inherited URL still wins over the project .env", () => {
  const dir = projectWithDotEnv("VIBEBOT_URL=http://10.0.0.5\n");
  withEnv({ VIBEBOT_TOKEN: "envtok", VIBEBOT_URL: "http://10.0.0.9" }, () => {
    loadDotEnv(dir);
    assert.equal(getBaseUrl(), "http://10.0.0.9");
  });
  withEnv({ TINY_ENGINEER_URL: "http://10.0.0.9" }, () => {
    loadDotEnv(dir);
    assert.equal(getBaseUrl(), "http://10.0.0.9");
  });
});
