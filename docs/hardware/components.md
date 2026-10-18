# Hardware inventory

Buyers: start at [shopping.md](../shopping.md) (cart, servo fork, screws, supply). This page is the electrical spec.

Selected hardware only. Do not substitute electronics from this list without updating this file, [pinout.md](pinout.md), and [wiring.md](wiring.md). Servo *model* may be any preset in [`servos.json`](../../3d_models/fusion/TinyEngineerTools/servos.json) if the printed parts match — [parametric design](../3d/parametric-design.md).

Constants cited below match [`include/pins.h`](../../include/pins.h).

## Product links

| Part | Link |
| --- | --- |
| Seeed Studio XIAO ESP32S3 (default) | https://www.seeedstudio.com/XIAO-ESP32S3-p-5627.html |
| Waveshare ESP32-C3-Zero (legacy build) | https://docs.waveshare.com/ESP32-C3-Zero |
| WS2812B addressable LEDs (9: 1 lamp + 8 session bar) | Any 5 V WS2812B strip / modules — no single canonical SKU |
| 74AHCT1G125 single buffer (level shifter) | e.g. TI SN74AHCT1G125 (SOT-23-5); a breakout or SOT-23 adapter is fine |
| SS14 Schottky diode (1 A / 40 V) | Generic SMA / DO-214AC |
| 470 µF electrolytic capacitor (≥ 10 V) | Generic |
| 330 Ω resistor | Generic |
| Adafruit PCA9685 16-channel PWM servo driver | https://www.adafruit.com/product/815 |
| Tower Pro SG90 (or equivalent) | Widely available hobby servo — no single canonical SKU |
| Feetech FS0307 | See vendor listing for FS0307 analog micro |
| PowerHD HD-1370A (backward compatibility) | https://www.chd.hk/Product_Detail.aspx?id=30 |
| MAX98357A I2S class-D mono amplifier | https://www.aliexpress.us/item/3256805196806369.html |
| 8 Ω / 1 W mono speaker | https://www.aliexpress.us/item/3256807341987395.html |
| Waveshare 0.91inch OLED Module | https://www.waveshare.com/0.91inch-oled-module.htm |
| Adafruit 5993 USB-C breakout (robot power input) | https://www.adafruit.com/product/5993 |

## Seeed Studio XIAO ESP32S3

| Field | Value |
| --- | --- |
| Exact model | Seeed Studio XIAO ESP32S3 (ESP32-S3R8) |
| Quantity | 1 |
| Purpose | Main controller: I2C, I2S, RMT LED chain, USB CDC, Wi-Fi |
| Size | 21 × 17.8 mm (castellated; needs the redesigned desk slot — see [3d_models/README.md](../../3d_models/README.md#cad-todo-vibe-bot)) |
| Operating voltage | GPIO **3.3 V**. Powered on the **5V** pad from the robot +5V rail through an **SS14** Schottky |
| Logic | **3.3 V only** — do not drive 5 V into GPIO |
| Memory | 8 MB flash, 8 MB octal PSRAM (GPIO26–37 unavailable). Partition table [`partitions_8mb.csv`](../../partitions_8mb.csv) |
| Radio | Wi-Fi 2.4 GHz (product use). BLE present on silicon but **out of scope**. Keep the antenna clear of metal |
| USB | Onboard USB-C, native USB — **flashing and serial only**; not the robot's power input |
| Onboard LEDs | Orange user LED on GPIO21 (unused). No RGB LED — the lamp is LED #0 of the external chain |
| BOOT / RESET | BOOT button on GPIO0 (strapping), RESET button |
| Important pins | D0 LED data, D3 PCA9685 OE, D4/D5 I2C, D8/D9/D10 I2S — [pinout.md](pinout.md) |
| Firmware notes | Boot: dim green lamp. Animations: white (typing/reading/thinking/welcome/ring/wakeup), pulsing red (attention/error/dead), solid red (abort), off (idle/sleep). Fatal init errors: hang and blink red (1 = PCA9685, 2 = I2S). Session bar: [sessions.md](../sessions.md) |
| Limits | Do not power servos from **3V3**. Do not power the robot from the XIAO USB-C alone |

## Waveshare ESP32-C3-Zero (legacy build)

Build with `pio run -e esp32-c3-devkitm-1`.

| Field | Value |
| --- | --- |
| Exact model | Waveshare ESP32-C3-Zero (ESP32-C3FH4) |
| Quantity | 1 |
| Purpose | Main controller: I2C, I2S, USB CDC, Wi-Fi, onboard RGB |
| Operating voltage | GPIO **3.3 V**. External power on the **5V** pad: 3.7–6 V (robot uses the +5V rail) |
| Logic | **3.3 V only** — do not drive 5 V into GPIO |
| Radio | Wi-Fi 2.4 GHz (product use). BLE present on silicon but **out of scope** |
| USB | Native USB on GPIO18/19 — reached via Adafruit 5993 D+/D− (onboard USB-C unused when assembled) |
| Flash | 4 MB stacked flash on GPIO12–GPIO17 (those GPIOs are **not exposed**) |
| Onboard RGB | WS2812 on **GPIO10** |
| Firmware notes | Boot: dim green status. Animations: white (typing/reading/thinking/welcome/ring/wakeup), pulsing red (attention/error/dead), solid red (abort), off (idle/sleep). 1 s fade between non-pulse states. Fatal init errors: hang and blink red (1 = PCA9685, 2 = I2S). See [blink codes](testing.md#boot-failure-blink-codes) and [`docs/api.md`](../api.md#rgb-led) |
| BOOT | Button / strapping on **GPIO9** |
| RESET | Separate RESET button (CHIP_EN), not a GPIO |
| UART0 silkscreen | TX = GPIO21, RX = GPIO20 |
| USB D− / D+ | GPIO18 / GPIO19 (native USB) |
| 3V3 regulator | Onboard LDO (Waveshare: ME6217C33M5G). For **logic loads only** |
| Important pins | See [pinout.md](pinout.md) |
| Limits | Do not power servos from **3V3**. Do not cover the ceramic antenna with metal, PCB, or plastic. |
| Firmware note | PlatformIO `board = esp32-c3-devkitm-1` is a **build target**, not the physical module. Physical board is C3-Zero. |

## Adafruit PCA9685 16-channel PWM servo driver

| Field | Value |
| --- | --- |
| Exact model | Adafruit 16-Channel 12-bit PWM/Servo Driver (PCA9685) |
| Quantity | 1 |
| Purpose | Independent 50 Hz servo PWM so ESP32 timing is not the PWM source |
| Operating voltage | **VCC** (logic): 3.3 V from ESP32 **3V3**. **V+** (servos): +5V rail |
| Interface | I2C |
| Address | `0x40` (`PCA9685_ADDRESS` in firmware). A0–A5 pads can change this |
| PWM | 12-bit, firmware `setPWMFreq(50)` |
| Important pins | **V+** (servo rail, +5V), **VCC** (3V3 logic), **GND**, **SDA**, **SCL**, **PWM**, **OE**. OE → XIAO **D3 / GPIO4** (active low, wired on the XIAO build); on the legacy C3 build OE (GP5) is pending, not implemented |
| Channels used | 0–4 (five servos). 5–15 unused |
| Limits | **V+** and **VCC** must stay separate. Do not jumper servo power onto logic VCC on this robot |
| Firmware note | Detection at `0x40` is a **hard fail** in the bring-up test |

## Analog micro servos (qty 5)

Five analog micro servos drive the joints (Head / Neck / L hand / R hand / Body — [robot-movement.md](../robot-movement.md)). Buy **five of one model**. Print the matching `parts/{servo_id}/3mf/` folder. Which size to pick: [parametric design](../3d/parametric-design.md).

Shared for every preset:

| Field | Value |
| --- | --- |
| Quantity | 5 (one model) |
| Operating voltage | Robot: **+5V** via PCA9685 **V+** |
| Interface | Analog PWM, ~50 Hz. Signal is 3.3 V from PCA9685 — acceptable for this servo class |
| Pulse | Neutral ~1500 µs. Firmware window **800–2200 µs** (`SERVO_MIN_US` / `SERVO_MAX_US`) |
| Important pins | SIG, +5V, GND (JR-style 3-wire) |

> [!WARNING]
> Never power the servos from the ESP32 3.3 V regulator.

Firmware uses **per-servo safe ranges** in [`include/servos.h`](../../include/servos.h) (`SERVO_SPECS`). Tune after assembly if needed. Do not command full 0–180° / 800–2200 µs on the assembled robot. See [servos.md](servos.md).

### Tower Pro SG90 (recommended)

Easiest to buy. Larger body → larger printed robot; electronics are easier to fit in the desk.

| Field | Value |
| --- | --- |
| Exact model | Tower Pro SG90 analog micro (or equivalent 9 g class) |
| `servo_id` | `sg90` |
| Size | Larger than FS0307 / HD-1370A — see [`servos.json`](../../3d_models/fusion/TinyEngineerTools/servos.json) |

Print [`3d_models/parts/sg90/3mf/`](../../3d_models/parts/sg90/3mf/).

### Feetech FS0307

More compact. Use this if you want a smaller robot that looks tighter on the desk.

| Field | Value |
| --- | --- |
| Exact model | Feetech FS0307 analog micro servo |
| `servo_id` | `fs0307` |

Print [`3d_models/parts/fs0307/3mf/`](../../3d_models/parts/fs0307/3mf/).

### PowerHD HD-1370A (backward compatibility)

Still supported. Not the pick for a new build.

Print [`3d_models/parts/hd1370a/3mf/`](../../3d_models/parts/hd1370a/3mf/).

| Field | Value |
| --- | --- |
| Exact model | PowerHD HD-1370A analog micro servo |
| `servo_id` | `hd1370a` |
| Current (datasheet stall) | ~260 mA @ 4.8 V, ~320 mA @ 6.0 V |
| No-load current | ~110 mA @ 4.8 V, ~120 mA @ 6.0 V |
| Idle current | ~4 mA @ 4.8 V, ~5 mA @ 6.0 V |
| Torque / speed | 0.4 kg·cm / 0.12 s/60° @ 4.8 V; 0.6 kg·cm / 0.10 s/60° @ 6.0 V |
| Size / mass | ~20.2 × 8.5 × 17.6 mm, ~3.7 g |
| Limits | Manufacturer sheet also lists **~130°** travel over 800–2200 µs, while many retailers say 0–180°. Treat 0–180° as **nominal**, not a mechanical guarantee. |

## MAX98357A I2S class-D mono amplifier

| Field | Value |
| --- | --- |
| Exact model | MAX98357A breakout (I2S in, speaker out) |
| Quantity | 1 |
| Purpose | Digital audio → mono speaker. ESP32 never drives the speaker as GPIO PWM |
| Operating voltage | **Vin** 2.5–5.5 V, from the **+5V** rail |
| I2S logic | 3.3 V from ESP32 (compatible) |
| Interface | I2S: **BCLK**, **WS/LRC**, **DIN**. No MCLK |
| Sample rates | Chip: 8–96 kHz. Firmware: **44100 Hz**, 16-bit, stereo slot mode |
| Output power (typical) | ~1.8 W into 8 Ω @ 5 V / 10% THD (datasheet-class figure) |
| Important pins | Drawn: **Vin**, **GND**, **BCLK**, **LRC**, **DIN**. **SPK+** / **SPK-** not drawn. **GAIN** / **SD** not wired (breakout defaults: GAIN floating ≈ 9 dB, SD pulled up ≈ left channel) |
| Limits | Output is **BTL**. Do not connect SPK- to GND. Do not feed SPK+/SPK- into another amplifier. Do not drive the speaker from ESP32 GPIO |

> [!WARNING]
> MAX98357A SPK- is not ground.

## Speaker

| Field | Value |
| --- | --- |
| Exact model | 8 Ω / 1 W mono speaker (AliExpress listing above) |
| Quantity | 1 |
| Purpose | Acoustic output |
| Operating voltage | Not a voltage-rail device — driven by MAX98357A BTL |
| Interface | Two terminals → **SPK+** and **SPK-** |
| Limits | 1 W rated. Amp can theoretically exceed 1 W into 8 Ω at 5 V; keep firmware volume moderate. Never connect either terminal to **GND** |

Speaker wiring is **not** drawn on `docs/wiring/legacy-c3-zero.drawio`. Electrical rule is still: speaker ↔ SPK+/SPK- only.

## Waveshare 0.91inch OLED Module (SSD1306, I2C)

| Field | Value |
| --- | --- |
| Exact model | [Waveshare 0.91inch OLED Module](https://www.waveshare.com/0.91inch-oled-module.htm) (SKU 14657). Driver SSD1306, 128×32, I2C |
| Quantity | 1 |
| Purpose | Status / test UI |
| Operating voltage | Module accepts **3.3 V / 5 V**. Robot **VCC** from ESP32 **3V3** |
| Interface | I2C on the shared bus. Pads **VCC**, **GND**, **SDA**, **SCL** |
| Address | **`0x3C`** (`OLED_ADDRESS` in firmware). Alternate 0x3D exists on some modules if the ADDR jumper is changed — not used here |
| Resolution | 128×32 (`OLED_WIDTH` / `OLED_HEIGHT`) |
| Important pins | **VCC**, **GND**, **SDA**, **SCL**. Clock pad on this board is **SCL**. The legacy wiring PNG may still label that net **SCK** (generic clone silkscreen) — same I2C clock (XIAO **D5 / GPIO6**; legacy C3 **GP1**) |
| Firmware notes | `SSD1306_SWITCHCAPVCC`; rotation from `oled_rotate_180` (`setRotation(0)` or `2`). Missing OLED is **non-fatal** in the bring-up test |
| Limits | Robot wiring is **3V3**. Do not hang this module on the servo +5V rail |

## WS2812B LED chain (XIAO build)

| Field | Value |
| --- | --- |
| Exact model | WS2812B (5050) addressable RGB LEDs, 5 V |
| Quantity | **9**: index 0 = desk lamp, 1–8 = session bar (`LED_CHAIN_LENGTH`, `LED_BAR_LENGTH`) |
| Purpose | Lamp status colour + one LED per agent session ([sessions.md](../sessions.md)) |
| Operating voltage | **+5V** rail |
| Interface | Single-wire data from XIAO **D0 / GPIO1** via the 74AHCT1G125, 330 Ω series resistor before LED #0 **DIN** |
| Current | up to ~60 mA per LED at full white (≈ 0.54 A for 9); firmware uses partial brightness |
| Limits | Do not feed 3.3 V data straight into a 5 V-powered chain; use the level shifter |

## 74AHCT1G125 level shifter (XIAO build)

| Field | Value |
| --- | --- |
| Exact model | 74AHCT1G125 single bus buffer (e.g. TI SN74AHCT1G125) |
| Quantity | 1 |
| Purpose | Lifts the 3.3 V LED data line to 5 V logic for the WS2812B chain |
| Operating voltage | **VCC = +5V**. AHCT inputs accept 3.3 V as logic high |
| Important pins | **A** ← XIAO D0, **Y** → 330 Ω → LED #0 DIN, **OE̅** → GND, VCC, GND |

## Robot power input (XIAO build)

| Field | Value |
| --- | --- |
| Connector | USB-C power-only breakout (e.g. Adafruit 5993), **VBUS + GND only** — D+/D− unused on the XIAO build |
| Supply | **5 V / 3 A** USB-C supply (source must advertise 3 A) |
| Electrical | 5.1 kΩ CC pull-downs make the breakout a sink; the current available is what the **source** advertises. **Not** a USB-PD voltage converter |
| SS14 | 1 A / 40 V Schottky: anode on +5V, cathode on the XIAO **5V** pad. Keeps the XIAO's own USB-C VBUS off the servo rail |
| Bulk capacitor | **470 µF** electrolytic, ≥ 10 V, across +5V / GND near PCA9685 V+ |
| Limits | See [power.md](power.md) for the budget |

## Adafruit 5993 USB-C breakout (legacy C3 build)

| Field | Value |
| --- | --- |
| Exact model | Adafruit 5993 — USB Type C Vertical Breakout, downstream connection |
| Quantity | 1 |
| Purpose | Sole robot USB-C on the legacy build: **+5V power** and **programming / CDC** |
| Operating voltage | USB **VBUS** = 5 V |
| Electrical | Two 5.1 kΩ CC pull-downs; actual current is whatever the **upstream source** advertises |
| Interface | **VBUS**, **GND**, **D+**, **D−**. Wire D−→ESP32 GPIO18, D+→ESP32 GPIO19 |
| Limits | **Not** a USB-PD voltage converter. Prefer a **5 V / ≥2 A** host — see [power.md](power.md) |

SG90 (recommended) typically stalls harder than HD-1370A — see [power.md](power.md).

## Mechanical / RF notes for firmware and CAD

- Keep metal and dense plastic **off** the ESP32 antenna area (XIAO ESP32S3 antenna, or the legacy C3-Zero ceramic antenna).
- The XIAO ESP32S3 (21 × 17.8 mm) and the 8-LED session bar do not fit the upstream desk slots yet — see the CAD TODO in [3d_models/README.md](../../3d_models/README.md#cad-todo-vibe-bot).
- Servo horns and end stops: start from `SERVO_SPECS` in [`include/servos.h`](../../include/servos.h); tune after installation if needed. Assembled motion stays inside the saved min/max.
- Legacy C3 build: GPIO18/19 are native USB via the 5993 data wires. Do not reassign them while using USB CDC for flash/serial.
