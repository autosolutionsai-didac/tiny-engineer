# Power

Pin and net names follow [pinout.md](pinout.md) and [`include/pins.h`](../../include/pins.h). The default build is the **Seeed Studio XIAO ESP32S3**; the legacy ESP32-C3-Zero single-USB layout is at the end of this page.

## Architecture (XIAO ESP32S3)

The robot has **two USB-C connectors with separate jobs**:

| Connector | Job | Carries |
| --- | --- | --- |
| **Robot power input** (USB-C power-only breakout, e.g. Adafruit 5993; VBUS + GND, CC pull-downs) | Robot **+5V** rail | 5 V / **3 A** supply |
| **XIAO ESP32S3 onboard USB-C** | Flashing and serial (USB CDC) only | Data; its VBUS never feeds the servo rail |

One common **nominal 5 V** rail feeds the robot:

| Net | Source | Loads |
| --- | --- | --- |
| **+5V** | Power-input USB-C **VBUS** | PCA9685 **V+** (servos), MAX98357A **Vin**, WS2812B chain **5V**, 74AHCT1G125 **VCC**, 470 µF bulk capacitor; XIAO **5V** pad through the SS14 |
| **XIAO 5V** | +5V rail → **SS14 Schottky** (anode on +5V, cathode on the XIAO 5V pad) | XIAO ESP32S3 (its regulator makes 3V3) |
| **3V3** | XIAO onboard regulator | ESP32-S3, PCA9685 **VCC**, OLED **VCC** |
| **GND** | Power-input GND, XIAO GND | Everything (one common ground) |

The SS14 means the two USB-C sources are never tied together directly: the robot supply powers the XIAO, and a computer on the XIAO's USB-C port cannot drive the servo rail. Expect ~0.3–0.4 V drop across the diode; the XIAO regulator is fine with ~4.6 V in.

**Bulk capacitor:** **470 µF** electrolytic (≥ 10 V) across +5V / GND close to the PCA9685 **V+** / servo connectors. It absorbs servo start-up surges that would otherwise brown out the ESP32 or glitch the LED chain.

> [!WARNING]
> Never power the servos from the ESP32 3.3 V regulator, and never power the robot only from the XIAO's own USB-C port. Plug the 5 V / 3 A supply into the robot power input.

## Budget (XIAO build)

| Load | Typical | Worst case |
| --- | --- | --- |
| 5× servos | a few hundred mA moving | **≈ 1.3–1.6 A** stall (HD-1370A); SG90 typically higher |
| 9× WS2812B | tens of mA (firmware breathes the bar at partial brightness) | ~60 mA per LED at full white → **≈ 0.54 A** |
| MAX98357A + speaker | ~100–300 mA | peaks on loud clips |
| XIAO ESP32S3 (Wi-Fi TX peaks), OLED, PCA9685 logic, level shifter | ~100–350 mA | Wi-Fi TX bursts |

Worst case lands around **2.5–3 A**, which is why the XIAO build specifies a **5 V / 3 A** USB-C supply. A 1.5 A phone charger will brown out when several servos start together.

## Servo current (worst case)

Datasheet stall currents for PowerHD HD-1370A:

| Voltage | Per servo stall | × 5 servos |
| --- | --- | --- |
| 4.8 V | ~260 mA | **≈ 1.3 A** |
| 6.0 V | ~320 mA | **≈ 1.6 A** |

Robot rail is nominally **5 V**, so expect something between those two if several HD-1370A servos stall or start together.

**Tower Pro SG90** (recommended) is larger and typically stalls harder. Give more margin if several SG90s move while audio plays. Do not treat the HD-1370A milliamp table as an SG90 budget.

## USB-C power input vs real supply

A USB-C power-only breakout with 5.1 kΩ CC pull-downs is a **sink**: it takes whatever current the **source** advertises (default USB, 1.5 A, or 3 A). Use a supply that advertises **5 V / 3 A** (most USB-C chargers rated 15 W or more do). The breakout is **not** a USB-PD voltage converter; it does not step 9 V/12 V/20 V down to 5 V.

A dedicated 5 V / ≥ 3 A bench or wall PSU on the +5V and GND rails also works.

## Insufficient-power symptoms

If the rail sags under servo, LED or audio load:

- ESP32 resets / brownouts
- Servo jitter or weak motion
- OLED glitches or blanking
- LED bar flicker or wrong colours
- Audio noise / dropouts
- Unstable I2C (NACKs, PCA9685 or OLED “not found” after motion starts)
- Resets **specifically when multiple servos start moving**

Bring-up test turns all five servos together — that is a power-stress moment.

## Legacy: ESP32-C3-Zero single USB (5993)

The legacy build (`pio run -e esp32-c3-devkitm-1`) uses **one** USB-C connector, the Adafruit 5993, for both power and data:

| Net | 5993 | ESP32-C3-Zero |
| --- | --- | --- |
| +5V | **VBUS** | **5V** pad (and the shared +5V rail) |
| GND | **GND** | **GND** |
| USB D− | **D−** | **GPIO18** (native USB D−) |
| USB D+ | **D+** | **GPIO19** (native USB D+) |

That one cable supplies robot power and programming / serial CDC (`ARDUINO_USB_MODE=1`, `ARDUINO_USB_CDC_ON_BOOT=1`, monitor 115200). Use **5 V / ≥ 2 A**. Leave the C3-Zero **onboard USB-C unused** when the robot is assembled so two 5 V sources cannot fight on the same rail. Waveshare documents the C3-Zero LDO as ME6217C33M5G (hundreds of mA class) — enough for logic, not a servo supply.

Related: [wiring.md](wiring.md), [components.md](components.md), [interfaces.md](interfaces.md), [pinout.md](pinout.md).
