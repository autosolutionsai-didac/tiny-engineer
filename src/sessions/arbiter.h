#pragma once

// Session -> animation arbitration (pure; host-tested in test/test_sessions).
//
// Priority: any waiting -> attention; any error -> error; any working ->
// activity of the most recently changed working session; a working -> idle
// transition since the last evaluation -> ring (one-shot); otherwise none.
// Empty table = manual mode (no posts), except one `none` when the last
// session disappears while the arbiter was driving an animation.
// A manual POST /anim suppresses arbitration for ARBITER_MANUAL_HOLD_MS.

#include <cstdint>

#include "sessions/session_table.h"

constexpr uint32_t ARBITER_MANUAL_HOLD_MS = 15000;
constexpr uint32_t ARBITER_REFRESH_MS = 60000;
constexpr uint32_t ARBITER_TICK_MS = 1000;

enum class ArbiterTarget : uint8_t {
  None,
  Attention,
  Error,
  Typing,
  Reading,
  Thinking,
  Ring,
  Other  // current animation not one the arbiter drives (welcome, sleep, ...)
};

struct ArbiterState {
  ArbiterTarget lastTarget;  // last posted (Ring is recorded as None: one-shot)
  uint32_t lastPostMs;
  bool manualActive;
  uint32_t manualStartMs;
  bool resync;  // after manual hold: post target if it differs from current
};

struct ArbiterDecision {
  bool post;
  ArbiterTarget target;
};

void arbiterInit(ArbiterState& state);
void arbiterNoteManual(ArbiterState& state, uint32_t nowMs);
bool arbiterManualActive(const ArbiterState& state, uint32_t nowMs);

// Pure priority pick (does not consume `finished` flags).
ArbiterTarget arbiterPickTarget(const SessionTable& table);

// Full evaluation. Consumes `finished` flags in `table`. `current` is the
// controller's current animation mapped to ArbiterTarget.
ArbiterDecision arbiterEvaluate(
  ArbiterState& state,
  SessionTable& table,
  ArbiterTarget current,
  uint32_t nowMs
);

bool arbiterTargetIsWorking(ArbiterTarget target);
const char* arbiterTargetName(ArbiterTarget target);
