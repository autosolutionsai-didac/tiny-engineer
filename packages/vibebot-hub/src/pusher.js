/**
 * Robot pusher: turns session changes into `POST /session?...` requests.
 *
 * - Coalesces per session: only the latest pending update per id is sent.
 * - At most `maxPerSecond` requests start in any 1 s window (default 4) and
 *   at most `maxInflight` run at once.
 * - Each request times out after `timeoutMs` (1.5 s).
 * - A failed request (network error, timeout, 429, 5xx, 503 before Wi-Fi)
 *   is retried on a later tick unless a newer update for that session has
 *   been queued. After consecutive failures the pusher backs off (250 ms
 *   doubling to 10 s) so an offline robot is not hammered.
 * - 400/401/403/404 are dropped (retrying cannot fix them) and logged once.
 * - `keepalive(sessions)` re-queues any live session whose last successful
 *   push is older than `keepaliveMs` (60 s), so the robot's 30-min reaper
 *   never drops it.
 *
 * Everything time-related is injectable (`now`, `fetch`) for tests.
 */

/** Query string with %20 for spaces (not "+"), safest for embedded HTTP servers. */
function query(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function createPusher(options = {}) {
  const opts = {
    robotUrl: "http://vibebot.local",
    token: null,
    fetch: globalThis.fetch,
    now: Date.now,
    maxPerSecond: 4,
    maxInflight: 2,
    timeoutMs: 1500,
    keepaliveMs: 60_000,
    baseRetryMs: 250,
    maxRetryMs: 10_000,
    log: () => {},
    ...options,
  };
  const base = String(opts.robotUrl).replace(/\/+$/, "");

  /** @type {Map<string, { kind: "session" | "clear", params?: Record<string,string>, ended?: boolean }>} */
  const queue = new Map();
  const inflight = new Set();
  /** id → time of last successful push */
  const lastOk = new Map();
  /** start times of recent requests (rate window) */
  let starts = [];
  let failures = 0;
  let pausedUntil = 0;
  let reachable = null;
  let lastError = null;
  let lastOkAt = null;
  const loggedDrops = new Set();

  function sessionParams(s) {
    /** @type {Record<string,string>} */
    const p = { id: s.id, state: s.state };
    if (s.state === "working" && s.activity) p.activity = s.activity;
    if (s.agent) p.agent = s.agent;
    if (s.label) p.label = s.label;
    return p;
  }

  /** Queue the current state of a session (replaces any pending one). */
  function enqueue(session) {
    queue.delete(session.id); // re-insert at the tail: newest last, oldest first
    queue.set(session.id, {
      kind: "session",
      params: sessionParams(session),
      ended: session.state === "ended",
    });
  }

  /** Queue POST /sessions/clear (drop stale REST sessions after a restart). */
  function enqueueClear() {
    queue.set("\u0000clear", { kind: "clear" });
  }

  /** Re-queue live sessions whose last successful push is stale. */
  function keepalive(sessions) {
    const now = opts.now();
    for (const s of sessions) {
      if (queue.has(s.id) || inflight.has(s.id)) continue;
      const ok = lastOk.get(s.id);
      if (ok === undefined || now - ok >= opts.keepaliveMs) enqueue(s);
    }
  }

  function setReachable(value, err) {
    if (reachable !== value) {
      opts.log(value ? `robot reachable at ${base}` : `robot unreachable at ${base}: ${err}`);
    }
    reachable = value;
    lastError = value ? null : err;
  }

  function onFailure(key, item, err) {
    failures++;
    pausedUntil = opts.now() + Math.min(opts.baseRetryMs * 2 ** (failures - 1), opts.maxRetryMs);
    setReachable(false, err);
    if (!queue.has(key)) queue.set(key, item); // a newer update wins
  }

  async function send(key, item) {
    const url =
      item.kind === "clear"
        ? `${base}/sessions/clear`
        : `${base}/session?${query(item.params)}`;
    /** @type {Record<string,string>} */
    const headers = {};
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
    inflight.add(key);
    try {
      const res = await opts.fetch(url, { method: "POST", headers, signal: ac.signal });
      // Drain the body so the socket can be reused.
      try {
        await res.arrayBuffer?.();
      } catch {
        // ignore
      }
      const status = res.status;
      if (status >= 200 && status < 300) {
        failures = 0;
        pausedUntil = 0;
        lastOkAt = opts.now();
        setReachable(true);
        if (item.kind === "session") {
          if (item.ended) lastOk.delete(key);
          else lastOk.set(key, opts.now());
        }
        return;
      }
      if (status === 429 || status >= 500) {
        onFailure(key, item, `HTTP ${status}`);
        return;
      }
      // 4xx: retrying will not help.
      setReachable(true);
      const tag = status === 401 || status === 403 ? "auth" : `http-${status}`;
      if (!loggedDrops.has(tag)) {
        loggedDrops.add(tag);
        opts.log(
          tag === "auth"
            ? `robot rejected the request (HTTP ${status}); check VIBEBOT_TOKEN`
            : `robot rejected an update (HTTP ${status}); dropped`
        );
      }
      if (item.kind === "session" && !item.ended) lastOk.set(key, opts.now()); // don't spin on it
    } catch (err) {
      onFailure(key, item, err?.name === "AbortError" ? "timeout" : err?.cause?.code || err?.message || "error");
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  }

  /**
   * Start as many queued requests as the limits allow.
   * @returns {Promise<void>} settles when the requests started by this tick finish
   */
  function tick() {
    const now = opts.now();
    starts = starts.filter((t) => now - t < 1000);
    if (now < pausedUntil) return Promise.resolve();
    const started = [];
    for (const [key, item] of queue) {
      if (starts.length >= opts.maxPerSecond || inflight.size >= opts.maxInflight) break;
      if (inflight.has(key)) continue; // keep order per session
      queue.delete(key);
      starts.push(now);
      started.push(send(key, item));
      // Back off after a failure: one probe at a time.
      if (failures > 0) break;
    }
    return Promise.all(started).then(() => {});
  }

  return {
    enqueue,
    enqueueClear,
    keepalive,
    tick,
    forget: (id) => lastOk.delete(id),
    get pending() {
      return queue.size + inflight.size;
    },
    status: () => ({
      url: base,
      reachable,
      last_error: lastError,
      last_ok_ms_ago: lastOkAt === null ? null : opts.now() - lastOkAt,
      queued: queue.size,
      inflight: inflight.size,
    }),
    options: opts,
  };
}
