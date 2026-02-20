# Audio Device Selection Guide

By default, `hyprvox` uses the system's default ALSA recording device. However, you might want to specify a particular microphone (e.g., a USB headset or a specific built-in mic) for better transcription quality.

## 1. Listing Available Devices

The easiest way to find your microphone's ID is to use the built-in `list-mics` command:

```bash
bun run index.ts list-mics
```

This will output a list of available devices:

```text
Scanning for audio devices...

Available Audio Devices:
------------------------
ID:   default
Desc: Default Audio Device
------------------------
ID:   sysdefault:CARD=PCH
Desc: HDA Intel PCH, ALC294 Analog - Default Audio Device
------------------------
ID:   hw:CARD=PCH,DEV=0
Desc: HDA Intel PCH, ALC294 Analog - Direct hardware device without any conversions
------------------------
```

### Alternative: Using `arecord`
If `list-mics` doesn't provide enough detail, you can use the standard ALSA utility:

```bash
arecord -L
```

## 2. Testing a Device

Before configuring `hyprvox`, it's a good idea to verify that the device ID works and captures audio correctly. You can test it by recording a short sample:

```bash
arecord -D YOUR_DEVICE_ID -f S16_LE -r 16000 -c 1 -d 5 test.wav
```
- Replace `YOUR_DEVICE_ID` with an ID from the list (e.g., `hw:0,0` or `sysdefault`).
- `-f S16_LE`: 16-bit little-endian format.
- `-r 16000`: 16kHz sample rate (what the STT engines expect).
- `-c 1`: Mono channel.
- Play it back to confirm: `aplay test.wav`.

## 3. Configuring the Device

Once you have identified the correct device ID, update your `config.json` file located at `~/.config/hyprvox/config.json`.

Add or modify the `audioDevice` field under the `behavior` section:

```json
{
  "behavior": {
    "audioDevice": "sysdefault:CARD=PCH",
    "hotkey": "Right Control",
    "toggleMode": true
  }
}
```

Alternatively, you can set it via the CLI:

```bash
bun run index.ts config set behavior.audioDevice "sysdefault:CARD=PCH"
```

To revert to the system default, simply remove the field or set it to `null` (or `"default"`).

## 4. Troubleshooting

### Permission Denied
If you see a "Permission denied" error when listing or using devices:
- Ensure your user is in the `audio` group: `sudo usermod -aG audio $USER`.
- You must log out and back in for this change to take effect.

### Device or Resource Busy
If the device is "busy", another application might be holding an exclusive lock on the hardware.
- Try using a virtual device like `default` or `sysdefault` instead of a direct hardware ID like `hw:0,0`.
- Close other applications that might be using the microphone.

### No such device
- Ensure the microphone is plugged in.
- If using a USB device, try a different port.
- Run `lsusb` to see if the system detects the hardware.

## 5. PipeWire and PulseAudio
On modern Linux distributions using PipeWire or PulseAudio, selecting `default` usually works best as it follows your system's "Default Input" setting. If you change your default microphone in your desktop environment's sound settings (GNOME/KDE), `hyprvox` will automatically follow that change if set to `default`.
