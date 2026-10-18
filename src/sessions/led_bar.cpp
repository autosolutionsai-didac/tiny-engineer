#include "sessions/led_bar.h"

namespace {

constexpr uint8_t kIdleGreen = 20;
constexpr uint8_t kBreathMin = 12;
constexpr uint8_t kBreathMax = 160;
constexpr uint8_t kPulseMin = 30;
constexpr uint8_t kPulseMax = 255;
constexpr uint8_t kErrorRed = 200;
constexpr uint32_t kFlashToggleMs = 125;

// 0..1000 triangle over `period`, eased (quadratic) for a softer breath.
uint32_t easedTriangle(uint32_t nowMs, uint32_t period) {
  const uint32_t half = period / 2;
  const uint32_t phase = nowMs % period;
  const uint32_t tri = phase < half ? phase : period - phase;  // 0..half
  const uint32_t t = tri * 1000 / half;                        // 0..1000
  return t * t / 1000;                                         // 0..1000
}

uint8_t lerp(uint8_t lo, uint8_t hi, uint32_t t1000) {
  return static_cast<uint8_t>(lo + (static_cast<uint32_t>(hi - lo) * t1000) / 1000);
}

}  // namespace

LedRgb sessionLedColor(const Session& s, uint32_t nowMs) {
  if (!s.used) {
    return {0, 0, 0};
  }

  switch (s.state) {
    case SessionState::Working: {
      const uint8_t v =
        lerp(kBreathMin, kBreathMax, easedTriangle(nowMs, LED_BAR_BREATH_PERIOD_MS));
      return {0, v, v};
    }
    case SessionState::Waiting: {
      const uint8_t v =
        lerp(kPulseMin, kPulseMax, easedTriangle(nowMs, LED_BAR_PULSE_PERIOD_MS));
      return {v, static_cast<uint8_t>(v * 45 / 100), 0};
    }
    case SessionState::Error:
      return {kErrorRed, 0, 0};
    case SessionState::Idle:
      if (s.finishedMs != 0 &&
          (nowMs - s.finishedMs) < LED_BAR_FINISH_FLASH_MS) {
        const bool on = ((nowMs - s.finishedMs) / kFlashToggleMs) % 2 == 0;
        return on ? LedRgb{0, 255, 0} : LedRgb{0, kIdleGreen, 0};
      }
      return {0, kIdleGreen, 0};
    case SessionState::Ended:
    default:
      return {0, 0, 0};
  }
}
