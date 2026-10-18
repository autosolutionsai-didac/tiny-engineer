// AgentDeck client for Tiny Engineer.
//
// mDNS discovery and the WebSocket event handling are adapted from AgentDeck
// (esp32/src/net/mdns_discovery.cpp, ws_client.cpp, protocol.cpp),
// Copyright (c) 2025 SerendipityBound. Used under the MIT License:
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the
//   "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit
//   persons to whom the Software is furnished to do so, subject to the
//   following conditions: The above copyright notice and this permission
//   notice shall be included in all copies or substantial portions of the
//   Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

#include "sessions/agentdeck_client.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <mdns.h>

#include <cstring>

#include "network/wifi_connect.h"
#include "serial_log.h"
#include "settings/settings.h"

namespace {

constexpr uint32_t kDiscoverIntervalMs = 10000;
constexpr uint32_t kMdnsTimeoutMs = 1500;
constexpr uint32_t kBackoffMinMs = 1000;
constexpr uint32_t kBackoffMaxMs = 30000;
// TCP connect may block up to WEBSOCKETS_TCP_TIMEOUT (5 s) + handshake.
constexpr uint32_t kConnectGraceMs = 8000;
constexpr uint32_t kLostClearMs = 60000;
constexpr uint32_t kPingIntervalMs = 15000;
constexpr uint32_t kPongTimeoutMs = 30000;
constexpr size_t kMaxFrameBytes = 64 * 1024;
constexpr size_t kTokenMaxLen = 64;
constexpr uint32_t kTaskStack = 8192;

enum class Phase : uint8_t { Off, Discover, Active, Backoff };

struct Bridge {
  char ip[16];
  uint16_t port;
  char token[kTokenMaxLen + 1];
};

WebSocketsClient g_ws;
TaskHandle_t g_task = nullptr;
SemaphoreHandle_t g_lock = nullptr;

// Shared with the main loop (guarded by g_lock).
AgentDeckSnapshot g_pending;
bool g_pendingReady = false;
volatile bool g_connected = false;

// Task-local state.
Phase g_phase = Phase::Off;
Bridge g_bridge;
uint32_t g_nextDiscoverMs = 0;
uint32_t g_activeSinceMs = 0;
uint32_t g_backoffUntilMs = 0;
uint32_t g_backoffMs = kBackoffMinMs;
uint32_t g_lostSinceMs = 0;
bool g_haveDeckSessions = false;
volatile bool g_dropRequested = false;

void publish(const AgentDeckSnapshot& snap) {
  xSemaphoreTake(g_lock, portMAX_DELAY);
  g_pending = snap;
  g_pendingReady = true;
  xSemaphoreGive(g_lock);
  g_haveDeckSessions = snap.count > 0;
}

void publishClear() {
  AgentDeckSnapshot empty;
  empty.count = 0;
  publish(empty);
}

SessionActivity activityFromTool(const char* tool) {
  static const char* const kReading[] = {
    "Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch"
  };
  static const char* const kTyping[] = {
    "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "Shell"
  };

  if (tool == nullptr || tool[0] == '\0') {
    return SessionActivity::Thinking;
  }

  for (const char* name : kReading) {
    if (strcmp(tool, name) == 0) {
      return SessionActivity::Reading;
    }
  }

  for (const char* name : kTyping) {
    if (strcmp(tool, name) == 0) {
      return SessionActivity::Typing;
    }
  }

  return SessionActivity::Thinking;
}

// AgentDeck State enum (shared/src/states.ts) -> robot state.
SessionState stateFromAgentDeck(const char* state, bool alive) {
  if (!alive) {
    return SessionState::Ended;
  }

  if (state == nullptr || state[0] == '\0' || strcmp(state, "idle") == 0) {
    return SessionState::Idle;
  }

  if (strcmp(state, "processing") == 0) {
    return SessionState::Working;
  }

  if (strcmp(state, "awaiting_permission") == 0 ||
      strcmp(state, "awaiting_option") == 0 ||
      strcmp(state, "awaiting_diff") == 0) {
    return SessionState::Waiting;
  }

  if (strcmp(state, "disconnected") == 0) {
    return SessionState::Ended;
  }

  return SessionState::Idle;
}

void handleSessionsList(JsonArrayConst sessions) {
  AgentDeckSnapshot snap;
  snap.count = 0;

  for (JsonObjectConst s : sessions) {
    if (snap.count >= SESSION_MAX) {
      break;
    }

    const bool alive = s["alive"] | true;
    const SessionState state = stateFromAgentDeck(s["state"] | "", alive);

    if (state == SessionState::Ended) {
      continue;  // absent from the snapshot == removed
    }

    AgentDeckEntry& e = snap.entries[snap.count];

    if (!sessionSanitizeId(s["id"] | "", e.id, sizeof(e.id))) {
      continue;
    }

    sessionSanitizeAgent(s["agentType"] | "", e.agent, sizeof(e.agent));
    sessionSanitizeLabel(s["projectName"] | "", e.label, sizeof(e.label));
    e.state = state;
    e.activity = activityFromTool(s["currentTool"] | "");
    snap.count++;
  }

  publish(snap);
}

void handleText(const uint8_t* payload, size_t length) {
  if (length > kMaxFrameBytes) {
    return;
  }

  JsonDocument filter;
  filter["type"] = true;
  JsonObject f = filter["sessions"].add<JsonObject>();
  f["id"] = true;
  f["projectName"] = true;
  f["agentType"] = true;
  f["alive"] = true;
  f["state"] = true;
  f["currentTool"] = true;

  JsonDocument doc;
  const DeserializationError err = deserializeJson(
    doc,
    payload,
    length,
    DeserializationOption::Filter(filter)
  );

  if (err) {
    return;
  }

  const char* type = doc["type"] | "";

  if (strcmp(type, "sessions_list") == 0) {
    handleSessionsList(doc["sessions"].as<JsonArrayConst>());
  }
}

void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      g_connected = true;
      g_backoffMs = kBackoffMinMs;
      g_lostSinceMs = 0;
      serialLogPrint("[agentdeck] connected ");
      serialLogPrint(g_bridge.ip);
      serialLogPrint(":");
      serialLogPrintln(g_bridge.port);
      break;
    case WStype_DISCONNECTED:
      if (g_connected) {
        serialLogPrintln("[agentdeck] disconnected");
      }
      g_connected = false;
      g_dropRequested = true;
      break;
    case WStype_TEXT:
      handleText(payload, length);
      break;
    default:
      break;
  }
}

bool txtValue(const mdns_result_t* r, const char* key, char* out, size_t outSize) {
  for (size_t i = 0; i < r->txt_count; i++) {
    if (r->txt[i].key == nullptr || strcmp(r->txt[i].key, key) != 0) {
      continue;
    }

    const char* value = r->txt[i].value != nullptr ? r->txt[i].value : "";
    size_t len = r->txt_value_len != nullptr ? r->txt_value_len[i] : strlen(value);

    if (len >= outSize) {
      len = outSize - 1;
    }

    memcpy(out, value, len);
    out[len] = '\0';
    return true;
  }

  return false;
}

bool resultIpv4(const mdns_result_t* r, char* out, size_t outSize) {
  for (const mdns_ip_addr_t* a = r->addr; a != nullptr; a = a->next) {
    if (a->addr.type == ESP_IPADDR_TYPE_V4) {
      const uint32_t v = a->addr.u_addr.ip4.addr;
      snprintf(
        out,
        outSize,
        "%u.%u.%u.%u",
        static_cast<unsigned>(v & 0xFF),
        static_cast<unsigned>((v >> 8) & 0xFF),
        static_cast<unsigned>((v >> 16) & 0xFF),
        static_cast<unsigned>((v >> 24) & 0xFF)
      );
      return true;
    }
  }

  return false;
}

bool tokenSafe(const char* token) {
  for (size_t i = 0; token[i] != '\0'; i++) {
    const char c = token[i];
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == '-' || c == '_' ||
                    c == '.' || c == '~';
    if (!ok) {
      return false;
    }
  }

  return true;
}

// Blocking (<= kMdnsTimeoutMs) — task context only.
bool discover(Bridge& out) {
  mdns_result_t* results = nullptr;

  if (mdns_query_ptr("_agentdeck", "_tcp", kMdnsTimeoutMs, 8, &results) != ESP_OK ||
      results == nullptr) {
    return false;
  }

  const mdns_result_t* daemon = nullptr;
  const mdns_result_t* first = nullptr;
  char agent[24];

  for (const mdns_result_t* r = results; r != nullptr; r = r->next) {
    if (r->port == 0) {
      continue;
    }

    if (first == nullptr) {
      first = r;
    }

    if (txtValue(r, "agent", agent, sizeof(agent)) && strcmp(agent, "daemon") == 0) {
      daemon = r;
      break;
    }
  }

  const mdns_result_t* pick = daemon != nullptr ? daemon : first;
  bool ok = false;

  if (pick != nullptr) {
    Bridge b = {};
    b.port = pick->port;

    // Bridge advertises its LAN IP in TXT `ip` as well as A records.
    ok = resultIpv4(pick, b.ip, sizeof(b.ip)) || txtValue(pick, "ip", b.ip, sizeof(b.ip));

    if (!txtValue(pick, "token", b.token, sizeof(b.token)) || !tokenSafe(b.token)) {
      b.token[0] = '\0';
    }

    if (ok) {
      out = b;
    }
  }

  mdns_query_results_free(results);
  return ok;
}

void connectBridge(uint32_t now) {
  char path[8 + kTokenMaxLen + 1];

  if (g_bridge.token[0] != '\0') {
    snprintf(path, sizeof(path), "/?token=%s", g_bridge.token);
  } else {
    strcpy(path, "/");
  }

  serialLogPrint("[agentdeck] connecting ");
  serialLogPrint(g_bridge.ip);
  serialLogPrint(":");
  serialLogPrintln(g_bridge.port);  // never log the token

  g_ws.begin(g_bridge.ip, g_bridge.port, path);
  g_ws.onEvent(onWsEvent);
  // We drive retries ourselves (re-discover + exponential backoff).
  g_ws.setReconnectInterval(kBackoffMaxMs * 4);
  g_ws.enableHeartbeat(kPingIntervalMs, kPongTimeoutMs, 2);
  g_activeSinceMs = now;
  g_dropRequested = false;
  g_phase = Phase::Active;
}

void enterBackoff(uint32_t now) {
  g_ws.disconnect();
  g_connected = false;

  if (g_lostSinceMs == 0) {
    g_lostSinceMs = now != 0 ? now : 1;
  }

  g_backoffUntilMs = now + g_backoffMs;
  g_backoffMs = g_backoffMs * 2 > kBackoffMaxMs ? kBackoffMaxMs : g_backoffMs * 2;
  g_phase = Phase::Backoff;
}

void stopClient() {
  if (g_phase != Phase::Off) {
    g_ws.disconnect();
    g_connected = false;
    g_phase = Phase::Off;
    g_backoffMs = kBackoffMinMs;
    g_lostSinceMs = 0;
    publishClear();
  }
}

void taskStep() {
  const uint32_t now = millis();
  const bool enabled = settingsAgentDeckEnabled() && wifiConnected();

  if (!enabled) {
    stopClient();
    return;
  }

  // Drop AgentDeck sessions once the daemon has been unreachable for a while.
  if (!g_connected && g_lostSinceMs != 0 && g_haveDeckSessions &&
      (now - g_lostSinceMs) >= kLostClearMs) {
    publishClear();
  }

  switch (g_phase) {
    case Phase::Off:
      g_phase = Phase::Discover;
      g_nextDiscoverMs = now;
      break;

    case Phase::Discover:
      if (static_cast<int32_t>(now - g_nextDiscoverMs) < 0) {
        break;
      }

      g_nextDiscoverMs = now + kDiscoverIntervalMs;

      if (discover(g_bridge)) {
        connectBridge(millis());
      }
      break;

    case Phase::Active:
      g_ws.loop();

      if (g_dropRequested ||
          (!g_connected && (millis() - g_activeSinceMs) >= kConnectGraceMs)) {
        enterBackoff(millis());
      }
      break;

    case Phase::Backoff:
      if (static_cast<int32_t>(now - g_backoffUntilMs) >= 0) {
        // Re-discover: the daemon may have restarted on another port / IP.
        g_phase = Phase::Discover;
        g_nextDiscoverMs = now;
      }
      break;
  }
}

void taskMain(void*) {
  for (;;) {
    taskStep();
    vTaskDelay(pdMS_TO_TICKS(g_phase == Phase::Active ? 5 : 100));
  }
}

}  // namespace

void agentdeckBegin() {
  if (g_task != nullptr) {
    return;
  }

  g_lock = xSemaphoreCreateMutex();

  if (g_lock == nullptr) {
    return;
  }

  g_pending.count = 0;

  // Core 0 on dual-core S3 keeps it off the Arduino loop core; C3 has one core.
#if CONFIG_FREERTOS_UNICORE
  xTaskCreate(taskMain, "agentdeck", kTaskStack, nullptr, 1, &g_task);
#else
  xTaskCreatePinnedToCore(taskMain, "agentdeck", kTaskStack, nullptr, 1, &g_task, 0);
#endif
}

bool agentdeckTakeSnapshot(AgentDeckSnapshot& out) {
  if (g_lock == nullptr) {
    return false;
  }

  bool ready = false;
  xSemaphoreTake(g_lock, portMAX_DELAY);

  if (g_pendingReady) {
    out = g_pending;
    g_pendingReady = false;
    ready = true;
  }

  xSemaphoreGive(g_lock);
  return ready;
}

bool agentdeckConnected() {
  return g_connected;
}
