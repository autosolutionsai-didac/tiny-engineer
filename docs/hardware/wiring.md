# Wiring

Build the harness **on the desk** ([getting-started](../getting-started.md) — after print, before flash). Do not seat it in the chest until [assembly §12](../3d/assembly.md#12-electronics-inside-the-desk).

Source of truth for pins: [`include/pins.h`](../../include/pins.h) / [pinout.md](pinout.md). This page describes the default **Seeed Studio XIAO ESP32S3** build; the legacy ESP32-C3-Zero harness is in [Legacy: ESP32-C3-Zero](#legacy-esp32-c3-zero). A XIAO wiring diagram is TBD; the existing diagram [`docs/wiring/legacy-c3-zero.drawio.png`](../wiring/legacy-c3-zero.drawio.png) ([`.drawio`](../wiring/legacy-c3-zero.drawio)) shows the legacy C3 harness only.

**Why these nets exist:**

- Two voltage rails: **5 V** for servos, the amp, the LED chain and the level shifter; **3.3 V** for ESP32 GPIO, PCA9685 **VCC**, and OLED. Never jumper those together.
- PCA9685 **VCC** is logic; **V+** is servo power. Same chip, two jobs.
- OLED and PCA9685 share one I2C bus (SDA/SCL).
- Audio is I2S into the MAX98357A; the speaker is **BTL** — **SPK− is not ground**.
- The WS2812B chain runs from 5 V, so its 3.3 V data line goes through a **74AHCT1G125** level shifter.
- Robot power comes from its **own USB-C power input** (5 V / 3 A), joined to the XIAO **5V** pin through an **SS14** Schottky. The XIAO's onboard USB-C is for flashing / serial only.
- Every module shares **GND**.

**Connect in this order (power last):**

1. Common **GND** to every module.
2. Signal wires: I2C (D4/D5), I2S (D8/D9/D10), PCA9685 **OE** (D3), LED data (D0 → 74AHCT1G125 → 330 Ω → first WS2812B **DIN**).
3. Logic **3V3**: XIAO **3V3** → PCA9685 **VCC** and OLED **VCC**.
4. **5 V** last: power-input **VBUS** → +5V rail → PCA9685 **V+**, MAX98357A **Vin**, WS2812B **5V**, 74AHCT1G125 **VCC**, 470 µF bulk cap, and SS14 anode (cathode → XIAO **5V**). Leave servo leads unplugged until centering.

## Connection table (XIAO ESP32S3)

| From | Pin | To | Pin | Purpose |
| --- | --- | --- | --- | --- |
| Power-input USB-C | VBUS | +5V rail | — | Robot 5 V / 3 A in |
| Power-input USB-C | GND | GND | — | Common ground |
| +5V rail | — | SS14 | anode | XIAO feed |
| SS14 | cathode | XIAO ESP32S3 | 5V | XIAO power in (no back-feed between the two USB-C ports) |
| +5V rail | — | 470 µF capacitor | + | Bulk decoupling near PCA9685 V+ (− to GND) |
| +5V rail | — | PCA9685 | V+ (terminal block) | Servo rail |
| +5V rail | — | MAX98357A | Vin | Amp power |
| +5V rail | — | 74AHCT1G125 | VCC | Level-shifter power |
| +5V rail | — | WS2812B chain | 5V | LED power |
| XIAO ESP32S3 | 3V3 | PCA9685 | VCC | PCA9685 logic |
| XIAO ESP32S3 | 3V3 | OLED | VCC | OLED power |
| XIAO ESP32S3 | D4 / GPIO5 | PCA9685, OLED | SDA | I2C data (shared) |
| XIAO ESP32S3 | D5 / GPIO6 | PCA9685, OLED | SCL | I2C clock (shared) |
| XIAO ESP32S3 | D3 / GPIO4 | PCA9685 | OE | Output enable (active low) |
| XIAO ESP32S3 | D8 / GPIO7 | MAX98357A | BCLK | I2S bit clock |
| XIAO ESP32S3 | D9 / GPIO8 | MAX98357A | LRC | I2S word select |
| XIAO ESP32S3 | D10 / GPIO9 | MAX98357A | DIN | I2S data |
| XIAO ESP32S3 | D0 / GPIO1 | 74AHCT1G125 | A (input) | LED data, 3.3 V |
| 74AHCT1G125 | OE̅ | GND | — | Buffer always enabled |
| 74AHCT1G125 | Y (output) | 330 Ω → WS2812B #0 | DIN | LED data, 5 V |
| WS2812B #n | DOUT | WS2812B #n+1 | DIN | Chain: #0 lamp, #1–#8 session bar |
| PCA9685 | PWM 0–4 | Servos | SIG | Servo PWM |
| PCA9685 | V+ | Servos | 5V | Servo power |
| PCA9685 | GND (servo side) | Servos | GND | Servo ground |
| MAX98357A | SPK+ / SPK− | Speaker | + / − | BTL output (never to GND) |

**All modules must share a common ground**, including the XIAO, the power input, the level shifter and the LED chain.

> [!WARNING]
> Never power the servos from the XIAO 3.3 V regulator, and do not power the robot from the XIAO's own USB-C port.

## Power

```
Power-input USB-C VBUS (5 V / 3 A)
  → +5V rail
      → PCA9685 V+ → servos 5V
      → MAX98357A Vin
      → 74AHCT1G125 VCC
      → WS2812B chain 5V
      → 470 µF bulk cap (to GND)
      → SS14 (anode) → (cathode) XIAO 5V
```

```
XIAO 3V3
  → PCA9685 VCC
  → OLED VCC
```

Budget and rationale: [power.md](power.md).

## I2C

Shared bus: XIAO **D4 / GPIO5** → SDA, **D5 / GPIO6** → SCL, to both PCA9685 and OLED. Addresses: PCA9685 `0x40`, OLED `0x3C`. See [interfaces.md](interfaces.md).

## I2S

- XIAO **D8 / GPIO7** → MAX98357A **BCLK**
- XIAO **D9 / GPIO8** → MAX98357A **LRC**
- XIAO **D10 / GPIO9** → MAX98357A **DIN**
- +5V → MAX98357A **Vin**; GND → **GND**

MAX98357A **GAIN** / **SD** not wired (breakout defaults).

## LED chain

9 × WS2812B in one chain: index **0** = desk lamp, **1–8** = session bar (`LED_CHAIN_LENGTH = 9`, `LED_BAR_FIRST_INDEX = 1`, `LED_BAR_LENGTH = 8`).

- XIAO **D0 / GPIO1** → 74AHCT1G125 input. The AHCT input threshold accepts 3.3 V logic; the output swings to 5 V for the LEDs.
- 330 Ω series resistor between the level-shifter output and the first LED's **DIN**, placed near the first LED.
- Tie 74AHCT1G125 **OE̅** to GND.
- Power every LED from +5V / GND; add a 100 nF decoupling cap per LED if your strip or modules do not already have one.

## PCA9685 → servo

Firmware drives **channels 0–4** (`SERVO_SPECS` / `SERVO_HEAD`…`SERVO_BODY`). Channel → joint: [robot-movement.md](../robot-movement.md) / [`include/servos.h`](../../include/servos.h). Each servo: SIG ← PWM, 5V ← V+, GND ← GND.

PCA9685 **OE** is wired to **D3 / GPIO4** on the XIAO build (`PCA9685_OE_WIRED = true`): firmware holds outputs off until neutral pulses are loaded — [pinout.md](pinout.md#oe-behaviour).

## Not wired

| Item | Rule |
| --- | --- |
| XIAO D1 / GPIO2 | Reserved for a future touch pad / button |
| XIAO D2 / GPIO3 | Strapping pin — leave unused |
| XIAO D6 / D7 (GPIO43/44) | UART0, free |
| MAX98357A GAIN / SD | Leave breakout defaults |

> [!WARNING]
> MAX98357A output is BTL. **SPK- is not ground.** Never tie SPK- or SPK+ to GND. Never drive the speaker from ESP32 GPIO.

## USB connectors

| Connector | Role |
| --- | --- |
| Power-input USB-C (power-only breakout) | Robot **+5V** / GND, 5 V / 3 A |
| XIAO ESP32S3 onboard USB-C | Flash and serial CDC only |

Both can be plugged in at once: the SS14 keeps the XIAO's USB VBUS off the servo rail. See [interfaces.md](interfaces.md), [power.md](power.md).

## Assembly checks

1. Every **GND** is one net (power input, XIAO, PCA9685 both sides, OLED, MAX98357A, level shifter, LEDs, servos).
2. PCA9685 **VCC** ≈ 3.3 V, PCA9685 **V+** ≈ 5 V, those two nets **not** shorted.
3. XIAO **5V** pad ≈ 4.6 V (rail minus the SS14 drop) with only the power input connected.
4. I2S on D8/D9/D10 and I2C on D4/D5 — not swapped.
5. LED data goes D0 → 74AHCT1G125 → 330 Ω → first LED **DIN** (not DOUT).
6. 470 µF capacitor polarity: + to +5V.
7. Speaker (if fitted) is only SPK+/SPK-.

## Legacy: ESP32-C3-Zero

Build with `pio run -e esp32-c3-devkitm-1`. Diagram: [`docs/wiring/legacy-c3-zero.drawio.png`](../wiring/legacy-c3-zero.drawio.png). The diagram labels pads **GP0**…**GP21** (= GPIO0…GPIO21). **Red** = 5 V, **blue** = GND, thin wires = signals.

| From | Pin | To | Pin | Purpose |
| --- | --- | --- | --- | --- |
| USB (5993) | 5V / VBUS | ESP32-C3-Zero, PCA9685, MAX98357A | 5V, 5V, Vin | +5V rail |
| USB (5993) | GND | every module | GND | Common ground |
| USB (5993) | D− / D+ | ESP32-C3-Zero | GP18 / GP19 | Native USB (flash / CDC); may be omitted on the PNG |
| ESP32-C3-Zero | 3V3 | PCA9685, OLED | VCC | Logic power |
| ESP32-C3-Zero | GP0 / GP1 | PCA9685, OLED | SDA / SCL | I2C (OLED PNG may say **SCK**) |
| ESP32-C3-Zero | GP2 / GP3 / GP4 | MAX98357A | BCLK / LRC / DIN | I2S |
| PCA9685 | PWM / V+ / GND | Servo | SIG / 5V / GND | Servos |

Onboard WS2812 on **GP10** is the only LED (no session bar). PCA9685 **OE** (GP5) is pending (`PCA9685_OE_WIRED = false`). GP9 = BOOT. Leave the C3-Zero onboard USB-C unused when 5993 data is wired. On Adafruit PCA9685, the diagram's PCA9685 **5V** pad is the servo rail (same as **V+**), not **VCC**.
