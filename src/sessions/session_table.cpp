#include "sessions/session_table.h"

#include <cstring>

namespace {

bool isIdChar(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
         (c >= '0' && c <= '9') || c == '.' || c == '_' || c == ':' ||
         c == '-';
}

bool isAgentChar(char c) {
  return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
}

bool isPrintable(char c) {
  const unsigned char u = static_cast<unsigned char>(c);
  return u >= 0x20 && u <= 0x7E;
}

void copyBounded(char* dest, size_t destSize, const char* src) {
  if (destSize == 0) {
    return;
  }

  size_t i = 0;

  if (src != nullptr) {
    for (; i + 1 < destSize && src[i] != '\0'; i++) {
      dest[i] = src[i];
    }
  }

  dest[i] = '\0';
}

void clearSlot(Session& s) {
  memset(&s, 0, sizeof(s));
}

int freeSlot(const SessionTable& table) {
  for (size_t i = 0; i < SESSION_MAX; i++) {
    if (!table.slots[i].used) {
      return static_cast<int>(i);
    }
  }

  return -1;
}

int evictionVictim(const SessionTable& table, uint32_t nowMs) {
  int oldestIdle = -1;
  uint32_t oldestIdleAge = 0;
  int oldestAny = -1;
  uint32_t oldestAnyAge = 0;

  for (size_t i = 0; i < SESSION_MAX; i++) {
    const Session& s = table.slots[i];

    if (!s.used) {
      continue;
    }

    const uint32_t age = nowMs - s.seenMs;

    if (s.state == SessionState::Idle &&
        (oldestIdle < 0 || age > oldestIdleAge)) {
      oldestIdle = static_cast<int>(i);
      oldestIdleAge = age;
    }

    if (oldestAny < 0 || age > oldestAnyAge) {
      oldestAny = static_cast<int>(i);
      oldestAnyAge = age;
    }
  }

  return oldestIdle >= 0 ? oldestIdle : oldestAny;
}

}  // namespace

bool sessionValidateId(const char* id) {
  if (id == nullptr) {
    return false;
  }

  const size_t len = strlen(id);

  if (len < 1 || len > SESSION_ID_MAX_LEN) {
    return false;
  }

  for (size_t i = 0; i < len; i++) {
    if (!isIdChar(id[i])) {
      return false;
    }
  }

  return true;
}

bool sessionValidateAgent(const char* agent) {
  if (agent == nullptr) {
    return false;
  }

  const size_t len = strlen(agent);

  if (len > SESSION_AGENT_MAX_LEN) {
    return false;
  }

  for (size_t i = 0; i < len; i++) {
    if (!isAgentChar(agent[i])) {
      return false;
    }
  }

  return true;
}

bool sessionValidateLabel(const char* label) {
  if (label == nullptr) {
    return false;
  }

  const size_t len = strlen(label);

  if (len > SESSION_LABEL_MAX_LEN) {
    return false;
  }

  for (size_t i = 0; i < len; i++) {
    if (!isPrintable(label[i])) {
      return false;
    }
  }

  return true;
}

bool sessionParseState(const char* text, SessionState& out) {
  if (text == nullptr) {
    return false;
  }

  if (strcmp(text, "idle") == 0) {
    out = SessionState::Idle;
  } else if (strcmp(text, "working") == 0) {
    out = SessionState::Working;
  } else if (strcmp(text, "waiting") == 0) {
    out = SessionState::Waiting;
  } else if (strcmp(text, "error") == 0) {
    out = SessionState::Error;
  } else if (strcmp(text, "ended") == 0) {
    out = SessionState::Ended;
  } else {
    return false;
  }

  return true;
}

bool sessionParseActivity(const char* text, SessionActivity& out) {
  if (text == nullptr) {
    return false;
  }

  if (strcmp(text, "typing") == 0) {
    out = SessionActivity::Typing;
  } else if (strcmp(text, "reading") == 0) {
    out = SessionActivity::Reading;
  } else if (strcmp(text, "thinking") == 0) {
    out = SessionActivity::Thinking;
  } else {
    return false;
  }

  return true;
}

const char* sessionStateName(SessionState state) {
  switch (state) {
    case SessionState::Idle:
      return "idle";
    case SessionState::Working:
      return "working";
    case SessionState::Waiting:
      return "waiting";
    case SessionState::Error:
      return "error";
    case SessionState::Ended:
    default:
      return "ended";
  }
}

const char* sessionActivityName(SessionActivity activity) {
  switch (activity) {
    case SessionActivity::Typing:
      return "typing";
    case SessionActivity::Reading:
      return "reading";
    case SessionActivity::Thinking:
    default:
      return "thinking";
  }
}

const char* sessionSourceName(SessionSource source) {
  return source == SessionSource::AgentDeck ? "agentdeck" : "rest";
}

void sessionSanitizeAgent(const char* in, char* out, size_t outSize) {
  if (outSize == 0) {
    return;
  }

  size_t o = 0;
  const size_t limit =
    outSize - 1 < SESSION_AGENT_MAX_LEN ? outSize - 1 : SESSION_AGENT_MAX_LEN;

  for (size_t i = 0; in != nullptr && in[i] != '\0' && o < limit; i++) {
    char c = in[i];

    if (c >= 'A' && c <= 'Z') {
      c = static_cast<char>(c - 'A' + 'a');
    } else if (c == '_' || c == ' ') {
      c = '-';
    }

    if (isAgentChar(c)) {
      out[o++] = c;
    }
  }

  out[o] = '\0';
}

void sessionSanitizeLabel(const char* in, char* out, size_t outSize) {
  if (outSize == 0) {
    return;
  }

  size_t o = 0;
  const size_t limit =
    outSize - 1 < SESSION_LABEL_MAX_LEN ? outSize - 1 : SESSION_LABEL_MAX_LEN;

  for (size_t i = 0; in != nullptr && in[i] != '\0' && o < limit; i++) {
    const unsigned char u = static_cast<unsigned char>(in[i]);

    if (u >= 0x80) {
      // Collapse a UTF-8 sequence into one '?'.
      if ((u & 0xC0) == 0xC0) {
        out[o++] = '?';
      }
      continue;
    }

    out[o++] = isPrintable(in[i]) ? in[i] : ' ';
  }

  out[o] = '\0';
}

bool sessionSanitizeId(const char* in, char* out, size_t outSize) {
  if (outSize == 0) {
    return false;
  }

  size_t o = 0;
  const size_t limit =
    outSize - 1 < SESSION_ID_MAX_LEN ? outSize - 1 : SESSION_ID_MAX_LEN;

  for (size_t i = 0; in != nullptr && in[i] != '\0' && o < limit; i++) {
    out[o++] = isIdChar(in[i]) ? in[i] : '_';
  }

  out[o] = '\0';
  return o > 0;
}

void sessionTableInit(SessionTable& table) {
  for (size_t i = 0; i < SESSION_MAX; i++) {
    clearSlot(table.slots[i]);
  }
}

size_t sessionTableCount(const SessionTable& table) {
  size_t n = 0;

  for (size_t i = 0; i < SESSION_MAX; i++) {
    if (table.slots[i].used) {
      n++;
    }
  }

  return n;
}

size_t sessionTableCountSource(const SessionTable& table, SessionSource source) {
  size_t n = 0;

  for (size_t i = 0; i < SESSION_MAX; i++) {
    if (table.slots[i].used && table.slots[i].source == source) {
      n++;
    }
  }

  return n;
}

int sessionTableFind(const SessionTable& table, const char* id) {
  if (id == nullptr) {
    return -1;
  }

  for (size_t i = 0; i < SESSION_MAX; i++) {
    if (table.slots[i].used && strcmp(table.slots[i].id, id) == 0) {
      return static_cast<int>(i);
    }
  }

  return -1;
}

int sessionTableApply(
  SessionTable& table,
  const SessionUpdate& update,
  SessionSource source,
  uint32_t nowMs
) {
  if (!sessionValidateId(update.id)) {
    return -1;
  }

  int slot = sessionTableFind(table, update.id);

  if (update.state == SessionState::Ended) {
    if (slot >= 0) {
      clearSlot(table.slots[slot]);
    }
    return slot;
  }

  const bool isNew = slot < 0;

  if (isNew) {
    slot = freeSlot(table);

    if (slot < 0) {
      slot = evictionVictim(table, nowMs);
    }

    if (slot < 0) {
      return -1;
    }

    Session& fresh = table.slots[slot];
    clearSlot(fresh);
    fresh.used = true;
    copyBounded(fresh.id, sizeof(fresh.id), update.id);
    fresh.createdMs = nowMs;
    fresh.changedMs = nowMs;
    fresh.state = update.state;
    fresh.activity = SessionActivity::Thinking;
  }

  Session& s = table.slots[slot];
  const SessionState prevState = s.state;
  const SessionActivity prevActivity = s.activity;

  SessionActivity nextActivity = s.activity;

  if (update.state == SessionState::Working) {
    if (update.hasActivity) {
      nextActivity = update.activity;
    } else if (isNew || prevState != SessionState::Working) {
      nextActivity = SessionActivity::Thinking;
    }
  }

  if (!isNew && prevState == SessionState::Working &&
      update.state == SessionState::Idle) {
    s.finished = true;
    s.finishedMs = nowMs != 0 ? nowMs : 1;
  }

  if (update.state != SessionState::Idle) {
    s.finished = false;
  }

  if (!isNew &&
      (prevState != update.state ||
       (update.state == SessionState::Working && prevActivity != nextActivity))) {
    s.changedMs = nowMs;
  }

  s.state = update.state;
  s.activity = nextActivity;
  s.source = source;
  s.seenMs = nowMs;

  if (update.agent != nullptr) {
    copyBounded(s.agent, sizeof(s.agent), update.agent);
  }

  if (update.label != nullptr) {
    copyBounded(s.label, sizeof(s.label), update.label);
  }

  return slot;
}

bool sessionTableRemove(SessionTable& table, const char* id) {
  const int slot = sessionTableFind(table, id);

  if (slot < 0) {
    return false;
  }

  clearSlot(table.slots[slot]);
  return true;
}

size_t sessionTableClearSource(SessionTable& table, SessionSource source) {
  size_t n = 0;

  for (size_t i = 0; i < SESSION_MAX; i++) {
    if (table.slots[i].used && table.slots[i].source == source) {
      clearSlot(table.slots[i]);
      n++;
    }
  }

  return n;
}

void sessionTableReplaceSource(
  SessionTable& table,
  SessionSource source,
  const SessionUpdate* updates,
  size_t count,
  uint32_t nowMs
) {
  for (size_t i = 0; i < SESSION_MAX; i++) {
    table.slots[i].mark = false;
  }

  for (size_t u = 0; updates != nullptr && u < count; u++) {
    if (updates[u].state == SessionState::Ended) {
      const int slot = sessionTableFind(table, updates[u].id);

      if (slot >= 0 && table.slots[slot].source == source) {
        clearSlot(table.slots[slot]);
      }
      continue;
    }

    const int slot = sessionTableApply(table, updates[u], source, nowMs);

    if (slot >= 0) {
      table.slots[slot].mark = true;
    }
  }

  for (size_t i = 0; i < SESSION_MAX; i++) {
    Session& s = table.slots[i];

    if (s.used && s.source == source && !s.mark) {
      clearSlot(s);
    }

    s.mark = false;
  }
}

size_t sessionTableReap(SessionTable& table, uint32_t nowMs, uint32_t maxAgeMs) {
  size_t n = 0;

  for (size_t i = 0; i < SESSION_MAX; i++) {
    Session& s = table.slots[i];

    if (s.used && (nowMs - s.seenMs) >= maxAgeMs) {
      clearSlot(s);
      n++;
    }
  }

  return n;
}
