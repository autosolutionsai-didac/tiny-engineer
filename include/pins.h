#pragma once

#include <cstdint>

// =====================================================
// PINOUT
// =====================================================
//
// Board-conditional pin maps. Keep docs/hardware/pinout.md in sync.
//   CONFIG_IDF_TARGET_ESP32S3 -> Seeed Studio XIAO ESP32S3 (default target)
//   otherwise                 -> Waveshare ESP32-C3-Zero (legacy target)

#if __has_include(<sdkconfig.h>)
#include <sdkconfig.h>
#endif

#if defined(CONFIG_IDF_TARGET_ESP32S3)

constexpr const char* BOARD_NAME = "XIAO ESP32S3";

// I2C -> PCA9685 (0x40) + OLED (0x3C)
constexpr int I2C_SDA = 5;   // D4
constexpr int I2C_SCL = 6;   // D5

// I2S -> MAX98357A
constexpr int I2S_BCLK = 7;  // D8
constexpr int I2S_LRC  = 8;  // D9
constexpr int I2S_DIN  = 9;  // D10

// WS2812B chain via 74AHCT1G125 level shifter: index 0 = lamp, 1..8 = session bar
constexpr int RGB_LED_PIN = 1;  // D0
constexpr int LED_CHAIN_LENGTH = 9;
constexpr int LED_BAR_FIRST_INDEX = 1;
constexpr int LED_BAR_LENGTH = 8;

// PCA9685 output enable (active LOW), wired on the XIAO board: D3 / GPIO4.
// Boot drives it HIGH (outputs off) until PWM positions are loaded, then LOW.
constexpr bool PCA9685_OE_WIRED = true;
constexpr int PCA9685_OE_PIN = 4;  // D3

// Reserved / free: D1 GPIO2 (future touch/button), D2 GPIO3 (strapping, keep
// unused), D6 GPIO43 UART TX, D7 GPIO44 UART RX.

#else  // legacy ESP32-C3-Zero

constexpr const char* BOARD_NAME = "ESP32-C3-Zero";

// I2C -> PCA9685 + OLED
constexpr int I2C_SDA = 0;   // GP0
constexpr int I2C_SCL = 1;   // GP1

// I2S -> MAX98357A
constexpr int I2S_BCLK = 2;  // GP2
constexpr int I2S_LRC  = 3;  // GP3
constexpr int I2S_DIN  = 4;  // GP4

// Built-in WS2812 RGB (the "chain" is just this one LED; no session bar)
constexpr int RGB_LED_PIN = 10;
constexpr int LED_CHAIN_LENGTH = 1;
constexpr int LED_BAR_FIRST_INDEX = 1;
constexpr int LED_BAR_LENGTH = 0;

// PCA9685 output enable (active LOW). GP5 → OE pending; schematic/PCB do not implement that net.
constexpr bool PCA9685_OE_WIRED = false;
constexpr int PCA9685_OE_PIN = 5;

#endif

// =====================================================
// AUDIO
// =====================================================

constexpr int SAMPLE_RATE = 44100;

// =====================================================
// PCA9685 / SERVOS
// =====================================================

constexpr uint8_t PCA9685_ADDRESS = 0x40;

constexpr int SERVO_STEP_MS = 10;

// Boot centering / sleep-pose rate (deg/s)
constexpr float SERVO_BOOT_SPEED_DEG_S = 35.0f;

// Servo pulse range
constexpr int SERVO_MIN_US = 800;
constexpr int SERVO_MAX_US = 2200;

// =====================================================
// OLED
// =====================================================

constexpr int OLED_WIDTH  = 128;
constexpr int OLED_HEIGHT = 32;
constexpr uint8_t OLED_ADDRESS = 0x3C;
