#pragma once

// Multi-session runtime: owns the session table, runs the arbiter (on change +
// every second), reaps stale sessions, paints the LED bar and drains the
// AgentDeck client's snapshots. Main-loop only (not thread-safe).

#include <cstddef>
#include <cstdint>

#include "sessions/session_table.h"

void initSessions();
void updateSessions(uint32_t nowMs);

// REST (POST /session). Returns slot, or -1 for ended-unknown / failure.
int sessionsApplyRest(const SessionUpdate& update);
size_t sessionsClearRest();

// Manual POST /anim: suppress arbitration for ARBITER_MANUAL_HOLD_MS.
void sessionsNoteManualAnim();

const SessionTable& sessionsTable();
size_t sessionsCount();
// "agentdeck" | "rest" | "mixed" | "none"
const char* sessionsSourceSummary();
