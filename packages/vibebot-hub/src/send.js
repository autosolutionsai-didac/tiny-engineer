import { request } from "node:http";
import { antigravityResponse } from "./mappers/antigravity.js";
import { hubPortFromEnv } from "./config.js";

/**
 * vibebot-send <agent> [--type X] [--port N] [json]
 *
 * Hook shim: reads hook JSON from stdin (or a JSON argument, as Codex
 * `notify` passes it), trims it, and POSTs it to the local hub at
 * http://127.0.0.1:<port>/hook/<agent>. 1 s timeout, every error ignored,
 * nothing on stdout (Claude Code / Codex add hook stdout to the model
 * context), always exit 0, and an explicit process.exit so no socket keeps
 * Node alive. Exception: for antigravity it prints the hook decision JSON
 * Antigravity expects ({"decision":"allow"} for PreToolUse / Stop).
 */

export const TIMEOUT_MS = 1000;
const HARD_DEADLINE_MS = 2500;
const STR_MAX = 256;

/** Keys with prompt text, file contents or tool output: never forwarded. */
const DROP = new Set([
  "tool_input",
  "tool_response",
  "tool_output",
  "prompt",
  "last_assistant_message",
  "last-assistant-message",
  "input-messages",
  "input_messages",
  "content",
  "diff",
  "edits",
  "output",
  "result",
  "attachments",
]);

function trimString(s) {
  return s.length > STR_MAX ? s.slice(0, STR_MAX) : s;
}

function primitive(v) {
  if (typeof v === "string") return trimString(v);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  return undefined;
}

/**
 * Keep only what mappers need: top-level primitives, short string arrays
 * and one level of primitives inside objects (e.g. toolCall.name).
 * @param {unknown} payload
 */
export function slim(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (DROP.has(k)) continue;
    const p = primitive(v);
    if (p !== undefined) {
      out[k] = p;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 8).map(primitive).filter((x) => x !== undefined);
    } else if (v && typeof v === "object") {
      /** @type {Record<string, unknown>} */
      const inner = {};
      for (const [ik, iv] of Object.entries(v)) {
        if (DROP.has(ik)) continue;
        const ip = primitive(iv);
        if (ip !== undefined) inner[ik] = ip;
      }
      out[k] = inner;
    }
  }
  return out;
}

/**
 * @param {string[]} argv
 * @returns {{ agent?: string, type?: string, port?: number, json?: string }}
 */
export function parseSendArgs(argv) {
  /** @type {{ agent?: string, type?: string, port?: number, json?: string }} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--type") out.type = argv[++i];
    else if (a.startsWith("--type=")) out.type = a.slice(7);
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a.startsWith("--port=")) out.port = Number(a.slice(7));
    else if (a.trimStart().startsWith("{")) out.json = a;
    else if (a.startsWith("-")) continue; // unknown flag: ignore, never fail
    else if (!out.agent) out.agent = a;
    else if (!out.type) out.type = a; // `vibebot-send antigravity PreToolUse`
  }
  if (!Number.isInteger(out.port) || out.port <= 0 || out.port > 65535) delete out.port;
  return out;
}

/**
 * Read all of stdin, giving up after `ms`. Resolves "" for a TTY.
 * @param {NodeJS.ReadableStream & { isTTY?: boolean }} stdin
 * @param {number} ms
 */
export function readStdin(stdin, ms = TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!stdin || stdin.isTTY) return resolve("");
    const chunks = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(chunks.join(""));
    };
    const t = setTimeout(finish, ms);
    try {
      stdin.setEncoding?.("utf8");
      stdin.on("data", (c) => chunks.push(String(c)));
      stdin.on("end", finish);
      stdin.on("error", finish);
    } catch {
      finish();
    }
  });
}

/**
 * POST JSON to the hub. Always resolves (status code, or 0 on any error).
 * @param {{ port: number, path: string, body: unknown, timeoutMs?: number }} o
 */
export function postToHub({ port, path, body, timeoutMs = TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      try {
        req.destroy();
      } catch {
        // ignore
      }
      done(0);
    }, timeoutMs);
    let req;
    try {
      const data = JSON.stringify(body);
      req = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        },
        (res) => {
          res.resume();
          res.on("end", () => done(res.statusCode ?? 0));
          res.on("error", () => done(0));
        }
      );
      req.on("error", () => done(0));
      req.end(data);
    } catch {
      done(0);
    }
  });
}

/**
 * @param {string[]} argv
 * @param {{ stdin?: any, stdout?: { write: (s: string) => any },
 *   env?: Record<string, string | undefined>, cwd?: string,
 *   exit?: (code: number) => void }} [io]
 */
export async function main(argv, io = {}) {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const env = io.env ?? process.env;
  const exit = io.exit ?? ((code) => process.exit(code));
  // Absolute backstop: never outlive the hook, whatever happens below.
  const hard = setTimeout(() => exit(0), HARD_DEADLINE_MS);
  hard.unref?.();

  let opts = {};
  try {
    opts = parseSendArgs(argv);
    const raw = opts.json ?? (await readStdin(stdin));
    let payload = {};
    try {
      payload = raw && raw.trim() ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }

    if (opts.agent && /^[a-z0-9-]{1,32}$/.test(opts.agent)) {
      const q = new URLSearchParams();
      if (opts.type) q.set("type", opts.type);
      q.set("cwd", io.cwd ?? process.cwd());
      await postToHub({
        port: opts.port ?? hubPortFromEnv(env),
        path: `/hook/${opts.agent}?${q}`,
        body: slim(payload),
      });
    }
  } catch {
    // never fail the agent
  }

  try {
    if (opts.agent === "antigravity") {
      // Wait for the write to flush (pipes are async on macOS) before exit.
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 500);
        stdout.write(JSON.stringify(antigravityResponse(opts.type)) + "\n", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  } catch {
    // ignore
  }
  clearTimeout(hard);
  exit(0);
}
