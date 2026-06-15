# Hyprvox

This context defines the voice-capture workflow language for the Linux speech-to-text daemon.

## Language

**Recording**:
The held-to-talk capture window from key press to key release.
_Avoid_: session, clip

**Transcript**:
The final validated text produced from a recording.
_Avoid_: output, message

**Merge Result**:
The combined text produced after reconciling multiple speech engines.
_Avoid_: blend, fusion

**Trigger Key**:
The keyboard shortcut that starts and stops a recording.
_Avoid_: hotkey, shortcut

**Overlay**:
The on-screen status surface that reflects live daemon state.
_Avoid_: popup, HUD
