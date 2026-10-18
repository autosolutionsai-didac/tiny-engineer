#pragma once

// Multi-session table (pure C++, no Arduino; host-tested in test/test_sessions).
// Slot index == LED bar position; a session keeps its slot until removed.

#include <cstddef>
#include <cstdint>

constexpr size_t SESSION_MAX = 8;
constexpr size_t SESSION_ID_MAX_LEN = 40;
constexpr size_t SESSION_AGENT_MAX_LEN = 16;
constexpr size_t SESSION_LABEL_MAX_LEN = 24;
constexpr uint32_t SESSION_REAP_MS = 30UL * 60UL * 1000UL;

enum class SessionState : uint8_t { Idle, Working, Waiting, Error, Ended };
enum class SessionActivity : uint8_t { Thinking, Typing, Reading };
enum class SessionSource : uint8_t { Rest, AgentDeck };

struct Session {
  bool used;
  char id[SESSION_ID_MAX_LEN + 1];
  char agent[SESSION_AGENT_MAX_LEN + 1];
  char label[SESSION_LABEL_MAX_LEN + 1];
  SessionState state;
  SessionActivity activity;
  SessionSource source;
  uint32_t createdMs;
  uint32_t seenMs;      // last update of any kind (reaper)
  uint32_t changedMs;   // last state/activity change (arbiter recency)
  uint32_t finishedMs;  // last working -> idle transition (LED flash)
  bool finished;        // working -> idle seen, not yet consumed by arbiter
  bool mark;            // scratch flag for replaceSource()
};

struct SessionTable {
  Session slots[SESSION_MAX];
};

// One incoming update (REST or AgentDeck). Strings must already be valid.
struct SessionUpdate {
  const char* id;
  SessionState state;
  bool hasActivity;
  SessionActivity activity;
  const char* agent;  // nullptr = keep existing
  const char* label;  // nullptr = keep existing
};

// ---- validation / parsing (exact contract rules) ----
// id: 1-40 chars [A-Za-z0-9._:-]
bool sessionValidateId(const char* id);
// agent: 0-16 chars [a-z0-9-]
bool sessionValidateAgent(const char* agent);
// label: 0-24 printable ASCII (0x20-0x7E)
bool sessionValidateLabel(const char* label);
bool sessionParseState(const char* text, SessionState& out);
bool sessionParseActivity(const char* text, SessionActivity& out);
const char* sessionStateName(SessionState state);
const char* sessionActivityName(SessionActivity activity);
const char* sessionSourceName(SessionSource source);

// Lossy copies for untrusted upstream data (AgentDeck): lower-cases and drops
// characters outside the allowed set, truncates to the max length.
void sessionSanitizeAgent(const char* in, char* out, size_t outSize);
void sessionSanitizeLabel(const char* in, char* out, size_t outSize);
// Id sanitize: replaces disallowed chars with '_'; returns false if empty.
bool sessionSanitizeId(const char* in, char* out, size_t outSize);

// ---- table ----
void sessionTableInit(SessionTable& table);
size_t sessionTableCount(const SessionTable& table);
size_t sessionTableCountSource(const SessionTable& table, SessionSource source);
int sessionTableFind(const SessionTable& table, const char* id);

// Insert / update. state Ended removes the session (returns its former slot or
// -1 if unknown). When full, evicts the oldest idle session, else the least
// recently seen one. Returns the slot used.
int sessionTableApply(
  SessionTable& table,
  const SessionUpdate& update,
  SessionSource source,
  uint32_t nowMs
);
bool sessionTableRemove(SessionTable& table, const char* id);
size_t sessionTableClearSource(SessionTable& table, SessionSource source);

// Replace every session of `source` with `updates` (AgentDeck sessions_list):
// sessions of that source missing from the list are removed.
void sessionTableReplaceSource(
  SessionTable& table,
  SessionSource source,
  const SessionUpdate* updates,
  size_t count,
  uint32_t nowMs
);

// Drop sessions not seen for maxAgeMs. Returns number removed.
size_t sessionTableReap(SessionTable& table, uint32_t nowMs, uint32_t maxAgeMs);
