# Shopping list

Buy this before you print or wire. Electrical spec (voltages, limits, pin notes): [hardware/components.md](hardware/components.md). Screw lengths in assembly steps: [3d_models/README.md → Screws](../3d_models/README.md#screws). Build order: [getting-started.md](getting-started.md).

## Servo size (pick first)

> **First build:** buy **five Tower Pro SG90** (or equivalent 9 g analog micros). Print [`3d_models/parts/sg90/`](../3d_models/parts/sg90/3mf/). Do **not** open Fusion.

Servo size sets the size of the **whole robot**. Buy five of **one** model, then print (or order) the matching `parts/{servo_id}/` folder.

| Choice | When | Print folder |
| --- | --- | --- |
| **Tower Pro SG90** (recommended) | Default. Bigger desk — electronics are easier to fit | [`parts/sg90/`](../3d_models/parts/sg90/3mf/) |
| **Feetech FS0307** | Compact robot | [`parts/fs0307/`](../3d_models/parts/fs0307/3mf/) |
| **PowerHD HD-1370A** | Backward compatibility only — skip for a new build | [`parts/hd1370a/`](../3d_models/parts/hd1370a/3mf/) |

Non-preset servo: measure it, add a preset, export parts — [parametric design](3d/parametric-design.md).

## Buy this

### Electronics

| Part | Qty | Link |
| --- | --- | --- |
| Seeed Studio XIAO ESP32S3 | 1 | https://www.seeedstudio.com/XIAO-ESP32S3-p-5627.html |
| Adafruit PCA9685 16-channel PWM servo driver | 1 | https://www.adafruit.com/product/815 |
| Tower Pro SG90 (or equivalent 9 g analog micro) | 5 | Widely available hobby servo — no single canonical SKU |
| MAX98357A I2S class-D mono amplifier | 1 | https://www.aliexpress.us/item/3256805196806369.html |
| 8 Ω / 1 W mono speaker | 1 | https://www.aliexpress.us/item/3256807341987395.html |
| [Waveshare 0.91inch OLED Module](https://www.waveshare.com/0.91inch-oled-module.htm) (SSD1306, 128×32, I2C) | 1 | https://www.waveshare.com/0.91inch-oled-module.htm |
| WS2812B addressable LEDs, 5 V (strip or modules) | 9 | 1 desk lamp + 8-LED session bar — no single canonical SKU |
| 74AHCT1G125 single buffer (e.g. TI SN74AHCT1G125, SOT-23-5 + adapter) | 1 | 3.3 V → 5 V LED data level shifter |
| 330 Ω resistor | 1 | LED data series resistor |
| SS14 Schottky diode (1 A / 40 V) | 1 | +5V rail → XIAO 5V pin |
| 470 µF electrolytic capacitor, ≥ 10 V | 1 | Bulk cap on the +5V servo rail |
| Adafruit 5993 USB-C breakout (or any USB-C power-only breakout with 5.1 kΩ CC pull-downs) | 1 | https://www.adafruit.com/product/5993 — robot **power input** |

Legacy build (existing robots): swap the XIAO ESP32S3 for a [Waveshare ESP32-C3-Zero](https://docs.waveshare.com/ESP32-C3-Zero), skip the LEDs / level shifter / SS14, and wire the 5993 data lines — see [hardware/wiring.md](hardware/wiring.md#legacy-esp32-c3-zero).

Compact build: swap the five SG90 for **Feetech FS0307** (same qty). Do not mix models.

### Fasteners

M2 thread-forming (self-tapping) screws for plastic, **pan-head or button-head**. Qty below is the shopping list; per-step placement stays in [3d_models/README.md → Screws](../3d_models/README.md#screws).

| Item | Qty |
| --- | --- |
| M2×4 mm | 8 |
| M2×8 mm | 21 |
| M2×16 mm | 15 |
| M2 nuts | 6 |
| Servo bag screws | 5 (come with the servos) |

An M2 assortment covering **M2×4–M2×16** is the easy path. Nearby lengths often work; test-fit if you substitute.

### Power and cables

| Item | Qty | Notes |
| --- | --- | --- |
| **5 V / 3 A** USB-C supply (must advertise 3 A) | 1 | Plugs into the robot power input. Five stalled servos plus the LED chain, Wi-Fi and audio need the headroom. A 1 A phone charger will brown out. |
| USB-C cable for the supply | 1 | Rated for 3 A. |
| USB-C **data** cable | 1 | For the XIAO's own USB-C (flash / serial). Charge-only cables fail flash and serial. |

### Printed parts

Home printer: **PLA** or **PETG**, testers first — [3d_models/README.md](../3d_models/README.md). No printer: [order printed parts](3d/order-parts.md).

## Next

Return to the [getting-started](getting-started.md) checklist ([§1 Shop](getting-started.md#1-shop) done). Then print or order.
