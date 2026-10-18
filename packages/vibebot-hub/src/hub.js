import { HOOK_MAPPERS, mapVibeDeck } from "./mappers/index.js";
import { createPusher } from "./pusher.js";
import { createStore } from "./store.js";
import {
  ACTIVITIES,
  STATES,
  robotSessionId,
  sanitizeAgent,
  sanitizeLabel,
} from "./util.js";

/**
 * Glue between mappers, the session store and the robot pusher. Has no
 * timers of its own: the server calls `tick()` every 250 ms.
 */
export function createHub(options = {}) {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const store = options.store ?? createStore(options.storeOptions);
  const pusher =
    options.pusher ?? createPusher({ now, log, ...(options.pusherOptions ?? {}) });
  const startedAt = now();
  const counters = { events: 0, ignored: 0 };

  if (options.clearOnStart) pusher.enqueueClear();

  /**
   * Normalize a mapper result into a store update, or null.
   * @param {Record<string, any> | null} m
   */
  function normalize(m) {
    if (!m || !m.id) return null;
    if (m.state !== undefined && !STATES.has(m.state)) return null;
    const agent = sanitizeAgent(m.agent);
    const u = { id: robotSessionId(agent, m.id), agent, label: sanitizeLabel(m.label) };
    if (m.state !== undefined) u.state = m.state;
    if (m.state === "working") u.activity = ACTIVITIES.has(m.activity) ? m.activity : "thinking";
    return u;
  }

  /**
   * Handle one incoming payload.
   * @param {string} source "claude-code" | "cursor" | "codex" | "antigravity" | "vibedeck"
   * @param {unknown} payload parsed JSON
   * @param {{ type?: string, cwd?: string }} [meta]
   */
  function handle(source, payload, meta = {}) {
    const mapper = source === "vibedeck" ? mapVibeDeck : HOOK_MAPPERS[source];
    if (!mapper) return { ok: false, error: "unknown agent" };
    counters.events++;
    let u = null;
    try {
      u = normalize(mapper(payload, meta));
    } catch {
      u = null;
    }
    if (!u) {
      counters.ignored++;
      return { ok: true, ignored: true };
    }
    const t = now();
    const r = store.apply(u, t);
    for (const e of r.evicted) pusher.enqueue(e);
    if (r.ended) pusher.enqueue(r.ended);
    else if (r.changed && r.session) pusher.enqueue(r.session);
    const s = r.ended ?? r.session;
    return { ok: true, id: s.id, state: s.state, ...(s.activity ? { activity: s.activity } : {}) };
  }

  /** Reap, refresh, push. */
  function tick() {
    for (const s of store.reap(now())) pusher.enqueue(s);
    pusher.keepalive(store.list());
    return pusher.tick();
  }

  /**
   * Send state=ended for every session, then wait (≤ deadlineMs) for the
   * queue to drain.
   */
  async function shutdown({ deadlineMs = 3000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    for (const s of store.drain()) pusher.enqueue(s);
    const end = Date.now() + deadlineMs;
    while (pusher.pending > 0 && Date.now() < end) {
      await pusher.tick();
      if (pusher.pending > 0) await sleep(100);
    }
  }

  function snapshot() {
    const t = now();
    return store.list().map((s) => ({
      id: s.id,
      agent: s.agent,
      label: s.label,
      state: s.state,
      activity: s.activity,
      age_s: Math.round((t - s.createdAt) / 1000),
      updated_s: Math.round((t - s.updatedAt) / 1000),
    }));
  }

  function health() {
    return {
      ok: true,
      name: "vibebot-hub",
      uptime_s: Math.round((now() - startedAt) / 1000),
      sessions: store.size,
      events: counters.events,
      ignored: counters.ignored,
      robot: pusher.status(),
    };
  }

  return { handle, tick, shutdown, snapshot, health, store, pusher };
}
