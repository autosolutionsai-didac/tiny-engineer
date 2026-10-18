# Pinout

Source of truth: [`include/pins.h`](../../include/pins.h). This file must match that header. `pins.h` selects the map at compile time: `CONFIG_IDF_TARGET_ESP32S3` → XIAO ESP32S3 (default env `xiao-esp32s3`), otherwise the legacy ESP32-C3-Zero map (env `esp32-c3-devkitm-1`).

## Seeed Studio XIAO ESP32S3 (default)

ESP32-S3R8: 8 MB flash, 8 MB octal PSRAM, native USB-C (flashing / serial only — the robot is powered from its own 5 V / 3 A USB-C input). No RGB LED on the module. Partition table: [`partitions_8mb.csv`](../../partitions_8mb.csv) (2 × 3 MB app, ~1.9 MB LittleFS, coredump).

| XIAO pad | GPIO | Function | Constant | Goes to |
| --- | --- | --- | --- | --- |
| D0 | **GPIO1** | WS2812 data out | `RGB_LED_PIN` | 74AHCT1G125 level shifter → 330 Ω → LED chain (index 0 = lamp, 1–8 = session bar) |
| D1 | GPIO2 | Reserved | — | future touch pad / button; unused by firmware |
| D2 | GPIO3 | Reserved | — | S3 strapping pin; leave unused |
| D3 | **GPIO4** | PCA9685 OE (active low) | `PCA9685_OE_PIN` | PCA9685 **OE**; `PCA9685_OE_WIRED = true` |
| D4 | **GPIO5** | I2C SDA | `I2C_SDA` | PCA9685 SDA (0x40), OLED SDA (0x3C) |
| D5 | **GPIO6** | I2C SCL | `I2C_SCL` | PCA9685 SCL, OLED SCL |
| D6 | GPIO43 | UART TX | — | free (debug) |
| D7 | GPIO44 | UART RX | — | free |
| D8 | **GPIO7** | I2S BCLK | `I2S_BCLK` | MAX98357A BCLK |
| D9 | **GPIO8** | I2S LRCLK / WS | `I2S_LRC` | MAX98357A **LRC** |
| D10 | **GPIO9** | I2S DATA OUT | `I2S_DIN` | MAX98357A DIN |
| 5V | — | power in | — | +5 V rail through an SS14 Schottky so the rail never back-feeds the XIAO's USB host |
| 3V3 | — | XIAO regulator out | — | PCA9685 VCC, OLED (the 74AHCT1G125 runs from +5 V) |

Logic level: **3.3 V**. The WS2812B chain is 5 V powered; the 74AHCT1G125 lifts the 3.3 V data line.

### OE behaviour

`initServoOutputPin()` drives OE **HIGH** (outputs off) first thing in `setup()`, the PCA9685 is configured and every channel loaded with its mid pulse, then OE goes **LOW** (outputs enabled) and stays low. This avoids a boot glitch on the servos.

### LED chain

| Constant | Value | Meaning |
| --- | --- | --- |
| `LED_CHAIN_LENGTH` | 9 | LEDs on the chain |
| `LED_BAR_FIRST_INDEX` | 1 | first session-bar LED |
| `LED_BAR_LENGTH` | 8 | session-bar LEDs (= max sessions) |

Driven with the Arduino-ESP32 3.x RMT HAL (`rmtInit` / `rmtWrite`) in [`src/hardware/led_chain.cpp`](../../src/hardware/led_chain.cpp); byte order follows the `rgb_order` setting. Colours: [api.md#rgb-led](../api.md#rgb-led).

### Reserved / unavailable (XIAO ESP32S3)

| GPIO | Status | Reason |
| --- | --- | --- |
| GPIO0 | **Reserved** | BOOT button / strapping |
| GPIO3 (D2) | **Reserved** | Strapping (JTAG source select) |
| GPIO19 / GPIO20 | **Reserved** | Native USB D− / D+ |
| GPIO21 | **Occupied** | Onboard orange user LED |
| GPIO26–GPIO37 | **Unavailable** | In-package flash and octal PSRAM |
| GPIO45 / GPIO46 | **Unavailable** | Strapping, not brought out |

### Free (XIAO ESP32S3)

| Pad | GPIO | Notes |
| --- | --- | --- |
| D1 | GPIO2 | Reserved for a future touch pad / button; otherwise free |
| D6 | GPIO43 | UART0 TX; free while USB CDC is the console (`ARDUINO_USB_CDC_ON_BOOT=1`) |
| D7 | GPIO44 | UART0 RX; same caveat |

## Legacy: Waveshare ESP32-C3-Zero

Build with `pio run -e esp32-c3-devkitm-1` (PlatformIO board name; physical module is the C3-Zero). 4 MB single-app [`partitions.csv`](../../partitions.csv). No session bar (`LED_CHAIN_LENGTH = 1`, `LED_BAR_LENGTH = 0`); sessions still drive animations.

| Function | GPIO | Constant | Goes to |
| --- | --- | --- | --- |
| I2C SDA | **GPIO0** (GP0) | `I2C_SDA` | PCA9685 SDA, OLED SDA |
| I2C SCL | **GPIO1** (GP1) | `I2C_SCL` | PCA9685 SCL, OLED SCL |
| I2S BCLK | **GPIO2** (GP2) | `I2S_BCLK` | MAX98357A BCLK |
| I2S LRCLK / WS | **GPIO3** (GP3) | `I2S_LRC` | MAX98357A LRC |
| I2S DATA OUT | **GPIO4** (GP4) | `I2S_DIN` | MAX98357A DIN |
| PCA9685 OE | **GPIO5** (GP5) | `PCA9685_OE_PIN` | net pending; `PCA9685_OE_WIRED = false` |
| Built-in WS2812 | **GPIO10** | `RGB_LED_PIN` | onboard LED (lamp) |

Reserved on the C3-Zero: GPIO9 (BOOT/strapping), GPIO10 (onboard WS2812), GPIO12–17 (flash, not brought out), GPIO18/19 (USB D−/D+). Free: GPIO6, GPIO7, GPIO8, GPIO20/21 (UART0, free while USB CDC is the console).

## PCA9685 channels (not ESP32 GPIO)

| PCA9685 channel | Firmware | Mechanism |
| --- | --- | --- |
| 0 | `SERVO_HEAD` | Head pitch — [robot-movement.md](../robot-movement.md) |
| 1 | `SERVO_NECK` | Neck yaw |
| 2 | `SERVO_HAND_LEFT` | Left hand |
| 3 | `SERVO_HAND_RIGHT` | Right hand |
| 4 | `SERVO_BODY` | Body / torso |
| 5–15 | unused | available |

## Other constants in `pins.h` (not pins)

| Constant | Value | Meaning |
| --- | --- | --- |
| `BOARD_NAME` | `"XIAO ESP32S3"` / `"ESP32-C3-Zero"` | Printed on serial at boot |
| `SAMPLE_RATE` | 44100 | I2S sample rate |
| `PCA9685_ADDRESS` | `0x40` | I2C |
| `OLED_ADDRESS` | `0x3C` | I2C |
| `OLED_WIDTH` / `OLED_HEIGHT` | 128 / 32 | Display |
| `SERVO_MIN_US` / `SERVO_MAX_US` | 800 / 2200 | Electrical PWM span |
| `SERVO_BOOT_SPEED_DEG_S` | 35 | Boot centering / sleep-pose rate (deg/s) |
| `PCA9685_OE_WIRED` | `true` (XIAO) / `false` (C3) | Whether firmware drives PCA9685 OE |

## Pin allocation rules

New hardware **must not** pick pins ad-hoc.

1. Choose a pad from a **Free** table above, or a documented unused PCA9685 channel.
2. Do not use **Reserved** or **Unavailable** pins.
3. Update **both**:
   - [`include/pins.h`](../../include/pins.h) (the matching board branch)
   - this `pinout.md`
4. Update [wiring.md](wiring.md) and [interfaces.md](interfaces.md) in the same change.
5. Stay in the **3.3 V** GPIO domain. Level-shift if a new device is 5 V-only.
6. I2C devices need a unique address on the shared SDA/SCL bus.
7. After the edit, grep the repo for old GPIO numbers so comments and tests stay consistent.

Related: [wiring.md](wiring.md), [interfaces.md](interfaces.md).
