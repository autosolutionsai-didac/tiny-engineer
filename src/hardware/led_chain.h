#pragma once

#include <cstdint>

// WS2812 chain on RGB_LED_PIN.
//   XIAO ESP32S3: LED_CHAIN_LENGTH (9) LEDs — index 0 = lamp, 1..8 = session bar.
//                 Driven with the Arduino 3.x RMT HAL (rmtInit / rmtWrite).
//   ESP32-C3-Zero: length 1 (onboard LED), driven with rgbLedWriteOrdered().
//
// Pixels hold *wire* bytes (already in LED byte order). Use the logical setter
// to map R,G,B through an rgb_order name ("GRB", "RGB", ...).

int ledChainLength();

// Map logical R,G,B to the three wire bytes for `order` (falls back to GRB).
void ledOrderToWire(
  const char* order,
  uint8_t r,
  uint8_t g,
  uint8_t b,
  uint8_t out[3]
);

void ledChainSetWire(int index, uint8_t b0, uint8_t b1, uint8_t b2);
void ledChainSetLogical(
  int index,
  uint8_t r,
  uint8_t g,
  uint8_t b,
  const char* order
);

// Push pixels to the LEDs when something changed. Unforced shows are
// throttled (~100 Hz); call ledChainService() from loop() to flush them.
void ledChainShow(bool force = false);
void ledChainService();
