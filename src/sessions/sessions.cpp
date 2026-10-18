#include "sessions/sessions.h"

#include <Arduino.h>

#include "animation.h"
#include "hardware/led_chain.h"
#include "pins.h"
#include "serial_log.h"
#include "sessions/agentdeck_client.h"
#include "sessions/arbiter.h"
#include "sessions/led_bar.h"
#include "settings/settings.h"

namespace {

constexpr uint32_t kLedBarFrameMs = 20;

SessionTable g_table;
ArbiterState g_arbiter;
bool g_dirty = false;
uint32_t g_lastTickMs = 0;
uint32_t g_lastLedMs = 0;
AgentDeckSnapshot g_snapshot;

ArbiterTarget currentTarget() {
  switch (getAnimation()) {
    case AnimationId::None:
      return ArbiterTarget::None;
    case AnimationId::Typing:
      return ArbiterTarget::Typing;
    case AnimationId::Reading:
      return ArbiterTarget::Reading;
    case AnimationId::Thinking:
      return ArbiterTarget::Thinking;
    case AnimationId::Ring:
      return ArbiterTarget::Ring;
    case AnimationId::Attention:
      return ArbiterTarget::Attention;
    case AnimationId::Error:
      return ArbiterTarget::Error;
    default:
      return ArbiterTarget::Other;
  }
}

AnimationId toAnimation(ArbiterTarget target) {
  switch (target) {
    case ArbiterTarget::Typing:
      return AnimationId::Typing;
    case ArbiterTarget::Reading:
      return AnimationId::Reading;
    case ArbiterTarget::Thinking:
      return AnimationId::Thinking;
    case ArbiterTarget::Ring:
      return AnimationId::Ring;
    case ArbiterTarget::Attention:
      return AnimationId::Attention;
    case ArbiterTarget::Error:
      return AnimationId::Error;
    case ArbiterTarget::None:
    case ArbiterTarget::Other:
    default:
      return AnimationId::None;
  }
}

void runArbiter(uint32_t nowMs) {
  const ArbiterDecision d =
    arbiterEvaluate(g_arbiter, g_table, currentTarget(), nowMs);

  if (!d.post) {
    return;
  }

  serialLogPrint("[sessions] arbiter -> ");
  serialLogPrintln(arbiterTargetName(d.target));
  setAnimation(toAnimation(d.target));
}

void drainAgentDeck(uint32_t nowMs) {
  if (!agentdeckTakeSnapshot(g_snapshot)) {
    return;
  }

  SessionUpdate updates[SESSION_MAX];
  size_t n = 0;

  for (size_t i = 0; i < g_snapshot.count && n < SESSION_MAX; i++) {
    const AgentDeckEntry& e = g_snapshot.entries[i];
    updates[n].id = e.id;
    updates[n].state = e.state;
    updates[n].hasActivity = true;
    updates[n].activity = e.activity;
    updates[n].agent = e.agent;
    updates[n].label = e.label;
    n++;
  }

  sessionTableReplaceSource(g_table, SessionSource::AgentDeck, updates, n, nowMs);
  g_dirty = true;
}

void paintLedBar(uint32_t nowMs) {
  if (LED_BAR_LENGTH <= 0) {
    return;
  }

  if ((nowMs - g_lastLedMs) < kLedBarFrameMs) {
    return;
  }

  g_lastLedMs = nowMs;

  for (int i = 0; i < LED_BAR_LENGTH && i < static_cast<int>(SESSION_MAX); i++) {
    const LedRgb c = sessionLedColor(g_table.slots[i], nowMs);
    ledChainSetLogical(LED_BAR_FIRST_INDEX + i, c.r, c.g, c.b, settingsRgbOrder());
  }

  ledChainShow();
}

}  // namespace

void initSessions() {
  sessionTableInit(g_table);
  arbiterInit(g_arbiter);
  g_lastTickMs = millis();
  agentdeckBegin();
}

void updateSessions(uint32_t nowMs) {
  drainAgentDeck(nowMs);

  const bool tick = (nowMs - g_lastTickMs) >= ARBITER_TICK_MS;

  if (tick) {
    g_lastTickMs = nowMs;

    if (sessionTableReap(g_table, nowMs, SESSION_REAP_MS) > 0) {
      serialLogPrintln("[sessions] reaped stale session(s)");
    }
  }

  if (tick || g_dirty) {
    g_dirty = false;
    runArbiter(nowMs);
  }

  paintLedBar(nowMs);
}

int sessionsApplyRest(const SessionUpdate& update) {
  const int slot =
    sessionTableApply(g_table, update, SessionSource::Rest, millis());
  g_dirty = true;
  return slot;
}

size_t sessionsClearRest() {
  const size_t n = sessionTableClearSource(g_table, SessionSource::Rest);
  g_dirty = true;
  return n;
}

void sessionsNoteManualAnim() {
  arbiterNoteManual(g_arbiter, millis());
}

const SessionTable& sessionsTable() {
  return g_table;
}

size_t sessionsCount() {
  return sessionTableCount(g_table);
}

const char* sessionsSourceSummary() {
  const size_t rest = sessionTableCountSource(g_table, SessionSource::Rest);
  const size_t deck = sessionTableCountSource(g_table, SessionSource::AgentDeck);

  if (rest > 0 && deck > 0) {
    return "mixed";
  }

  if (deck > 0) {
    return "agentdeck";
  }

  if (rest > 0) {
    return "rest";
  }

  return "none";
}
