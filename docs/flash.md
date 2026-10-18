# Flash firmware

Flash **after wiring, before assembly**. Overview order: [getting-started.md](getting-started.md). Centering (Move all to 90°) happens on this desk harness; do not finish the Wi-Fi wizard until [assembly.md §20](3d/assembly.md#20-setup-wizard-and-first-boot-on-wi-fi).

Firmware is Arduino on [PlatformIO](https://platformio.org/) ([pioarduino](https://github.com/pioarduino/platform-espressif32) / Arduino-ESP32 3.x). Board and baud live in `platformio.ini`.

Default board is the **Seeed Studio XIAO ESP32S3** (env `xiao-esp32s3`, the `default_envs`). The legacy **Waveshare ESP32-C3-Zero** builds with env `esp32-c3-devkitm-1` (a PlatformIO **build target name**, not a different board) — add `-e esp32-c3-devkitm-1` to every `pio run` command below.

## Install and connect

1. Install [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation.html) (or the PlatformIO IDE extension).
2. Use a USB-C **data** cable. Charge-only cables fail upload and serial.
3. Connect the **XIAO's own USB-C** to your computer. It carries data only for the robot: plug the 5 V / 3 A supply into the robot's separate USB-C power input before moving servos (the SS14 keeps the two supplies apart). Legacy C3: use the Adafruit 5993 data lines when the harness is wired, or the onboard USB-C on a bare C3-Zero.
4. If the XIAO does not show up or upload fails: hold **BOOT**, tap **RESET**, release **BOOT**, then upload again.

## Build, upload, serial

From the project root:

```bash
pio run                 # build (default env xiao-esp32s3)
pio run -t upload       # flash firmware + LittleFS
pio device monitor      # serial (115200)
```

Legacy C3-Zero: `pio run -e esp32-c3-devkitm-1 -t upload`.

After firmware upload, a post-script also uploads **LittleFS** ([`scripts/upload_fs_after_upload.py`](../scripts/upload_fs_after_upload.py)) so WAV assets (`welcome`, `bell`, and friends) land on the board. If animations move but stay silent, run `pio run -t uploadfs` once.

Several serial ports:

```bash
pio device list
pio run -t upload --upload-port <PORT>
pio device monitor --port <PORT>
```

`<PORT>` is the name `pio device list` prints for the board, and it is
platform-specific: `COM4` on Windows, `/dev/cu.usbmodemXXXX` or
`/dev/cu.usbserial-XXXX` on macOS, `/dev/ttyACM0` or `/dev/ttyUSB0` on Linux.
Pick the entry whose hardware ID shows Espressif's `VID:PID=303A:1001` (the
ESP32-S3 / ESP32-C3 native USB) or your board's USB-serial bridge — `pio device list`
also lists Bluetooth serial ports, which are not the board.

## Done when

Firmware + LittleFS uploaded, and:

- Serial shows a normal boot (`VIBE BOT` … PCA9685 found … no hang)
- Lamp LED (LED #0 of the chain on the XIAO build; onboard RGB on the legacy C3) is **dim green** during init (not a repeating red blink)
- One servo moves: join setup AP `VibeBot-XXXX`, open `http://192.168.4.1/config`, press **Move all to 90°** (or `POST /test/servo`)

Fatal init hangs and blinks the lamp LED **red**. Count flashes before the long gap:

| Blinks | Meaning |
| --- | --- |
| 1 | PCA9685 not found on I2C `0x40` — wiring / address |
| 2 | MAX98357A / I2S init failed |

Details: [hardware/testing.md — boot-failure blink codes](hardware/testing.md#boot-failure-blink-codes).

**Stop here.** Do not complete the setup wizard (home Wi-Fi, ranges, OLED, LED, speaker) until the robot is assembled — [assembly.md §20](3d/assembly.md#20-setup-wizard-and-first-boot-on-wi-fi). Then return to [getting-started](getting-started.md) and assemble.
