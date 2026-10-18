import { createServer as createHttpServer } from "node:http";
import { HOOK_MAPPERS } from "./mappers/index.js";

export const DEFAULT_PORT = 17826;
const MAX_BODY = 1024 * 1024;

/**
 * HTTP front end for the hub. Binds 127.0.0.1 only.
 *
 * Routes:
 *   POST /hook/<claude-code|cursor|codex|antigravity>[?type=&cwd=]  raw hook JSON
 *   POST /event                 Vibe Deck event JSON (Chrome extension, scripts)
 *   POST /vscode/register       Vibe Deck VS Code extension register/end
 *   GET  /vscode/commands       long-poll stub for the VS Code extension ({} after a while)
 *   POST /lovable/hello         Vibe Deck Chrome liveness ping (ignored)
 *   GET  /sessions              session table
 *   GET  /health                hub + robot status
 *
 * @param {{ hub: ReturnType<import("./hub.js").createHub>, host?: string,
 *   port?: number, longPollMs?: number, tickMs?: number, log?: (m: string) => void }} options
 */
export function createServer(options) {
  const { hub } = options;
  const host = options.host ?? "127.0.0.1";
  const longPollMs = options.longPollMs ?? 55_000;
  const tickMs = options.tickMs ?? 250;
  const log = options.log ?? (() => {});
  const polls = new Set();
  let timer = null;

  function send(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
      "Cache-Control": "no-store",
    });
    res.end(data);
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      let size = 0;
      let tooBig = false;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) tooBig = true;
        else chunks.push(c);
      });
      req.on("end", () => resolve(tooBig ? { tooBig: true } : { text: Buffer.concat(chunks).toString("utf8") }));
      req.on("error", () => resolve({ text: "" }));
    });
  }

  function parseJson(text) {
    if (!text || !text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /**
   * Browser pages must not drive the hub (DNS rebinding / drive-by POSTs).
   * Allowed: no Origin (CLIs, VS Code), extension origins.
   */
  function allowed(req) {
    const hostHeader = String(req.headers.host ?? "").replace(/:\d+$/, "");
    if (hostHeader && !["127.0.0.1", "localhost", "[::1]"].includes(hostHeader)) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    return /^(chrome|moz|safari-web)-extension:\/\//.test(origin);
  }

  async function onRequest(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    if (!allowed(req)) return send(res, 403, { ok: false, error: "forbidden" });

    if (path === "/health" || path === "/sessions") {
      if (method !== "GET") return send(res, 405, { ok: false, error: "method not allowed" });
      if (path === "/health") return send(res, 200, hub.health());
      return send(res, 200, { ok: true, sessions: hub.snapshot(), robot: hub.pusher.status() });
    }

    if (path === "/vscode/commands") {
      if (method !== "GET") return send(res, 405, { ok: false, error: "method not allowed" });
      // The hub has no commands; hold the poll so the extension does not spin.
      const t = setTimeout(() => {
        polls.delete(entry);
        send(res, 200, {});
      }, longPollMs);
      const entry = { t, res };
      polls.add(entry);
      // res (not req) "close": fires when the client goes away.
      res.on("close", () => {
        clearTimeout(t);
        polls.delete(entry);
      });
      return;
    }

    const hookMatch = /^\/hook\/([a-z0-9-]+)$/.exec(path);
    const isEvent = path === "/event" || path === "/vscode/register";
    const isHello = path === "/lovable/hello";
    if (!hookMatch && !isEvent && !isHello) return send(res, 404, { ok: false, error: "not found" });
    if (method !== "POST") return send(res, 405, { ok: false, error: "method not allowed" });

    const body = await readBody(req);
    if (body.tooBig) return send(res, 413, { ok: false, error: "payload too large" });
    if (isHello) return send(res, 200, { ok: true });

    const payload = parseJson(body.text);
    if (payload === undefined) return send(res, 400, { ok: false, error: "invalid json" });

    if (hookMatch) {
      const agent = hookMatch[1];
      if (!HOOK_MAPPERS[agent]) return send(res, 404, { ok: false, error: "unknown agent" });
      const meta = {
        type: url.searchParams.get("type") || undefined,
        cwd: url.searchParams.get("cwd") || undefined,
      };
      return send(res, 200, hub.handle(agent, payload, meta));
    }
    return send(res, 200, hub.handle("vibedeck", payload));
  }

  const server = createHttpServer((req, res) => {
    onRequest(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { ok: false, error: "internal error" });
    });
  });

  return {
    server,
    /** @returns {Promise<number>} bound port */
    listen(port = options.port ?? DEFAULT_PORT) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          timer = setInterval(() => {
            hub.tick().catch(() => {});
          }, tickMs);
          const addr = server.address();
          log(`listening on http://${host}:${addr.port}`);
          resolve(addr.port);
        });
      });
    },
    /** Stop accepting requests and release long polls. */
    close() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const p of polls) {
        clearTimeout(p.t);
        try {
          p.res.destroy();
        } catch {
          // ignore
        }
      }
      polls.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
