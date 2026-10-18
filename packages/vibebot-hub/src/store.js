/**
 * Session table. Pure: no timers, no I/O; the caller passes `now` (ms).
 *
 * Rules (match the robot's own table so both sides agree):
 * - At most `maxSessions` (8 = LED bar length). Adding one more evicts the
 *   oldest idle session; if none is idle, the least recently updated one.
 * - `ended` removes the session.
 * - idle / error sessions not updated for `idleTtlMs` (30 min) are reaped.
 *   working / waiting sessions get `busyTtlMs` (2 h) so a long tool run or
 *   a permission prompt left over lunch is not dropped.
 * - `activity` is only kept while working (default "thinking").
 */

export const DEFAULTS = {
  maxSessions: 8,
  idleTtlMs: 30 * 60 * 1000,
  busyTtlMs: 2 * 60 * 60 * 1000,
};

/**
 * @typedef {{ id: string, agent: string, label: string, state: string,
 *   activity: string | null, createdAt: number, updatedAt: number,
 *   changedAt: number }} Session
 * @typedef {{ id: string, agent: string, label?: string,
 *   state?: string, activity?: string }} Update
 */

export function createStore(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  /** @type {Map<string, Session>} */
  const sessions = new Map();

  function pickEviction() {
    let oldestIdle = null;
    let oldest = null;
    for (const s of sessions.values()) {
      if (!oldest || s.updatedAt < oldest.updatedAt) oldest = s;
      if (s.state === "idle" && (!oldestIdle || s.updatedAt < oldestIdle.updatedAt)) {
        oldestIdle = s;
      }
    }
    return oldestIdle ?? oldest;
  }

  /**
   * Apply one update.
   * @param {Update} u
   * @param {number} now
   * @returns {{ session: Session | null, changed: boolean, ended: Session | null, evicted: Session[] }}
   */
  function apply(u, now) {
    const evicted = [];
    const existing = sessions.get(u.id);

    if (u.state === "ended") {
      if (existing) sessions.delete(u.id);
      const ended = existing
        ? { ...existing, state: "ended", activity: null, updatedAt: now, changedAt: now }
        : {
            id: u.id,
            agent: u.agent,
            label: u.label || "",
            state: "ended",
            activity: null,
            createdAt: now,
            updatedAt: now,
            changedAt: now,
          };
      return { session: null, changed: true, ended, evicted };
    }

    if (existing) {
      const state = u.state ?? existing.state;
      const activity =
        state === "working" ? u.activity ?? (u.state ? "thinking" : existing.activity ?? "thinking") : null;
      const label = u.label || existing.label;
      const changed =
        state !== existing.state || activity !== existing.activity || label !== existing.label;
      existing.state = state;
      existing.activity = activity;
      existing.label = label;
      existing.updatedAt = now;
      if (changed) existing.changedAt = now;
      return { session: existing, changed, ended: null, evicted };
    }

    while (sessions.size >= opts.maxSessions) {
      const victim = pickEviction();
      if (!victim) break;
      sessions.delete(victim.id);
      evicted.push({ ...victim, state: "ended", activity: null });
    }
    const state = u.state ?? "idle";
    /** @type {Session} */
    const session = {
      id: u.id,
      agent: u.agent,
      label: u.label || "",
      state,
      activity: state === "working" ? u.activity ?? "thinking" : null,
      createdAt: now,
      updatedAt: now,
      changedAt: now,
    };
    sessions.set(u.id, session);
    return { session, changed: true, ended: null, evicted };
  }

  /**
   * Drop stale sessions.
   * @param {number} now
   * @returns {Session[]} removed sessions (state set to ended)
   */
  function reap(now) {
    const removed = [];
    for (const s of sessions.values()) {
      const busy = s.state === "working" || s.state === "waiting";
      const ttl = busy ? opts.busyTtlMs : opts.idleTtlMs;
      if (now - s.updatedAt >= ttl) {
        sessions.delete(s.id);
        removed.push({ ...s, state: "ended", activity: null });
      }
    }
    return removed;
  }

  /** Remove everything (graceful shutdown). */
  function drain() {
    const all = [...sessions.values()].map((s) => ({ ...s, state: "ended", activity: null }));
    sessions.clear();
    return all;
  }

  return {
    apply,
    reap,
    drain,
    get: (id) => sessions.get(id) ?? null,
    list: () => [...sessions.values()],
    get size() {
      return sessions.size;
    },
    options: opts,
  };
}
