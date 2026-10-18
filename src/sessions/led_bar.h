#pragma once

// Session LED bar colours (pure; host-tested). One LED per session slot.
//   idle = dim green, working = cyan breathing (~2 s), waiting = amber fast
//   pulse, error = solid red, working -> idle = 2 s bright green flash, then
//   idle. Empty slot = off.

#include <cstdint>

#include "sessions/session_table.h"

constexpr uint32_t LED_BAR_FINISH_FLASH_MS = 2000;
constexpr uint32_t LED_BAR_BREATH_PERIOD_MS = 2000;
constexpr uint32_t LED_BAR_PULSE_PERIOD_MS = 500;

struct LedRgb {
  uint8_t r;
  uint8_t g;
  uint8_t b;
};

LedRgb sessionLedColor(const Session& session, uint32_t nowMs);
