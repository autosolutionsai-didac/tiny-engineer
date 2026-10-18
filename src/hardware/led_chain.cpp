#include "hardware/led_chain.h"

#include <Arduino.h>
#include <cstring>

#include "esp32-hal-rgb-led.h"
#include "esp32-hal-rmt.h"
#include "pins.h"

namespace {

constexpr uint32_t kMinShowIntervalMs = 10;

uint8_t g_wire[LED_CHAIN_LENGTH][3] = {};
bool g_dirty = true;
uint32_t g_lastShowMs = 0;

// 10 MHz RMT tick: 0.1 us. Same WS2812 timing as esp32-hal-rgb-led.c.
constexpr uint32_t kRmtHz = 10000000;
constexpr uint16_t kT1H = 8;
constexpr uint16_t kT1L = 4;
constexpr uint16_t kT0H = 4;
constexpr uint16_t kT0L = 8;
// Trailing low symbol (>= 280 us) latches the frame even for back-to-back shows.
constexpr uint16_t kLatchTicks = 3000;
constexpr size_t kSymbols = LED_CHAIN_LENGTH * 24 + 1;

rmt_data_t g_symbols[kSymbols];
bool g_rmtReady = false;
bool g_rmtFailed = false;

bool ensureRmt() {
  if (g_rmtReady) {
    return true;
  }

  if (g_rmtFailed) {
    return false;
  }

  if (!rmtInit(RGB_LED_PIN, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_2, kRmtHz)) {
    g_rmtFailed = true;
    log_e("LED chain: RMT init failed on GPIO%d", RGB_LED_PIN);
    return false;
  }

  g_rmtReady = true;
  return true;
}

void writeRmtChain() {
  if (!ensureRmt()) {
    return;
  }

  size_t i = 0;

  for (int led = 0; led < LED_CHAIN_LENGTH; led++) {
    for (int byteIndex = 0; byteIndex < 3; byteIndex++) {
      const uint8_t value = g_wire[led][byteIndex];

      for (int bit = 7; bit >= 0; bit--) {
        const bool one = (value >> bit) & 1;
        g_symbols[i].level0 = 1;
        g_symbols[i].duration0 = one ? kT1H : kT0H;
        g_symbols[i].level1 = 0;
        g_symbols[i].duration1 = one ? kT1L : kT0L;
        i++;
      }
    }
  }

  g_symbols[i].level0 = 0;
  g_symbols[i].duration0 = kLatchTicks;
  g_symbols[i].level1 = 0;
  g_symbols[i].duration1 = 1;

  // ~0.6 ms for 9 LEDs incl. latch; bounded timeout so a stuck RMT never hangs loop().
  rmtWrite(RGB_LED_PIN, g_symbols, kSymbols, 5);
}

void writeChain() {
  if constexpr (LED_CHAIN_LENGTH > 1) {
    writeRmtChain();
  } else {
    // Legacy onboard LED: RGB order sends the bytes exactly as stored (wire order).
    rgbLedWriteOrdered(
      RGB_LED_PIN,
      LED_COLOR_ORDER_RGB,
      g_wire[0][0],
      g_wire[0][1],
      g_wire[0][2]
    );
  }
}

}  // namespace

int ledChainLength() {
  return LED_CHAIN_LENGTH;
}

void ledOrderToWire(
  const char* order,
  uint8_t r,
  uint8_t g,
  uint8_t b,
  uint8_t out[3]
) {
  const char* use = order;

  if (use == nullptr || strlen(use) != 3) {
    use = "GRB";
  }

  for (int i = 0; i < 3; i++) {
    switch (use[i]) {
      case 'R':
        out[i] = r;
        break;
      case 'G':
        out[i] = g;
        break;
      case 'B':
        out[i] = b;
        break;
      default:
        ledOrderToWire("GRB", r, g, b, out);
        return;
    }
  }
}

void ledChainSetWire(int index, uint8_t b0, uint8_t b1, uint8_t b2) {
  if (index < 0 || index >= LED_CHAIN_LENGTH) {
    return;
  }

  uint8_t* px = g_wire[index];

  if (px[0] == b0 && px[1] == b1 && px[2] == b2) {
    return;
  }

  px[0] = b0;
  px[1] = b1;
  px[2] = b2;
  g_dirty = true;
}

void ledChainSetLogical(
  int index,
  uint8_t r,
  uint8_t g,
  uint8_t b,
  const char* order
) {
  uint8_t wire[3];
  ledOrderToWire(order, r, g, b, wire);
  ledChainSetWire(index, wire[0], wire[1], wire[2]);
}

void ledChainShow(bool force) {
  if (!g_dirty && !force) {
    return;
  }

  const uint32_t now = millis();

  if (!force && (now - g_lastShowMs) < kMinShowIntervalMs) {
    return;
  }

  writeChain();
  g_dirty = false;
  g_lastShowMs = now;
}

void ledChainService() {
  ledChainShow(false);
}
