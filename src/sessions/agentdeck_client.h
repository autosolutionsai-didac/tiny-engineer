#pragma once

// AgentDeck daemon client: mDNS discovery of _agentdeck._tcp + WebSocket
// subscription to `sessions_list`. Runs in its own FreeRTOS task because
// mDNS queries and TCP connects block; the main loop only drains snapshots.

#include <cstddef>
#include <cstdint>

#include "sessions/session_table.h"

struct AgentDeckEntry {
  char id[SESSION_ID_MAX_LEN + 1];
  char agent[SESSION_AGENT_MAX_LEN + 1];
  char label[SESSION_LABEL_MAX_LEN + 1];
  SessionState state;
  SessionActivity activity;
};

struct AgentDeckSnapshot {
  AgentDeckEntry entries[SESSION_MAX];
  size_t count;
};

// Starts the background task (idempotent). It idles while the `agentdeck`
// setting is off or Wi-Fi STA is down.
void agentdeckBegin();

// Main loop: returns true once per new sessions_list (or a clear request when
// the client is turned off / lost the daemon), copying it into `out`.
bool agentdeckTakeSnapshot(AgentDeckSnapshot& out);

bool agentdeckConnected();
