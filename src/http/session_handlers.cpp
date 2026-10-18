#include "http/session_handlers.h"

#include <Arduino.h>
#include <cstdio>
#include <cstring>

#include "http/json.h"
#include "sessions/sessions.h"

namespace {

void sendError(WebServer& server, const char* error) {
  char body[64];
  snprintf(body, sizeof(body), "{\"ok\":false,\"error\":\"%s\"}", error);
  httpSendJson(server, 400, body);
}

// JSON string escape for printable-ASCII fields (label may hold " or \).
size_t appendEscaped(char* dest, size_t pos, size_t cap, const char* src) {
  for (size_t i = 0; src != nullptr && src[i] != '\0' && pos + 2 < cap; i++) {
    const char c = src[i];

    if (c == '"' || c == '\\') {
      dest[pos++] = '\\';
    }

    dest[pos++] = c;
  }

  dest[pos] = '\0';
  return pos;
}

size_t appendRaw(char* dest, size_t pos, size_t cap, const char* src) {
  const int n = snprintf(dest + pos, cap - pos, "%s", src);

  if (n < 0) {
    return pos;
  }

  return pos + static_cast<size_t>(n) < cap ? pos + n : cap - 1;
}

}  // namespace

void handleSessionPost(WebServer& server) {
  const String id = server.arg("id");

  if (!server.hasArg("id") || !sessionValidateId(id.c_str())) {
    sendError(server, "invalid id");
    return;
  }

  SessionState state;

  if (!server.hasArg("state") ||
      !sessionParseState(server.arg("state").c_str(), state)) {
    sendError(server, "invalid state");
    return;
  }

  SessionUpdate update = {};
  update.id = id.c_str();
  update.state = state;

  if (server.hasArg("activity")) {
    if (!sessionParseActivity(server.arg("activity").c_str(), update.activity)) {
      sendError(server, "invalid activity");
      return;
    }

    update.hasActivity = true;
  }

  String agent;

  if (server.hasArg("agent")) {
    agent = server.arg("agent");

    if (!sessionValidateAgent(agent.c_str())) {
      sendError(server, "invalid agent");
      return;
    }

    update.agent = agent.c_str();
  }

  String label;

  if (server.hasArg("label")) {
    label = server.arg("label");

    if (!sessionValidateLabel(label.c_str())) {
      sendError(server, "invalid label");
      return;
    }

    update.label = label.c_str();
  }

  const int slot = sessionsApplyRest(update);

  char body[64];
  snprintf(
    body,
    sizeof(body),
    "{\"ok\":true,\"slot\":%d,\"sessions\":%u}",
    slot,
    static_cast<unsigned>(sessionsCount())
  );
  httpSendJson(server, 200, body);
}

void handleSessionsGet(WebServer& server) {
  // 8 sessions x ~200 bytes worst case.
  char body[2048];
  size_t pos = 0;
  const size_t cap = sizeof(body);
  const SessionTable& table = sessionsTable();
  const uint32_t now = millis();

  pos += snprintf(
    body,
    cap,
    "{\"ok\":true,\"source\":\"%s\",\"sessions\":[",
    sessionsSourceSummary()
  );

  bool first = true;

  for (size_t i = 0; i < SESSION_MAX; i++) {
    const Session& s = table.slots[i];

    if (!s.used) {
      continue;
    }

    pos = appendRaw(body, pos, cap, first ? "{\"id\":\"" : ",{\"id\":\"");
    first = false;
    pos = appendEscaped(body, pos, cap, s.id);
    pos = appendRaw(body, pos, cap, "\",\"agent\":\"");
    pos = appendEscaped(body, pos, cap, s.agent);
    pos = appendRaw(body, pos, cap, "\",\"label\":\"");
    pos = appendEscaped(body, pos, cap, s.label);

    char tail[160];
    snprintf(
      tail,
      sizeof(tail),
      "\",\"state\":\"%s\",\"activity\":\"%s\",\"slot\":%u,\"age_s\":%lu,\"source\":\"%s\"}",
      sessionStateName(s.state),
      s.state == SessionState::Working ? sessionActivityName(s.activity) : "",
      static_cast<unsigned>(i),
      static_cast<unsigned long>((now - s.seenMs) / 1000UL),
      sessionSourceName(s.source)
    );
    pos = appendRaw(body, pos, cap, tail);
  }

  appendRaw(body, pos, cap, "]}");
  httpSendJson(server, 200, body);
}

void handleSessionsClear(WebServer& server) {
  sessionsClearRest();
  httpSendJson(server, 200, "{\"ok\":true}");
}

bool isSessionPath(const String& uri) {
  return uri == "/session" || uri == "/sessions" || uri == "/sessions/clear";
}
