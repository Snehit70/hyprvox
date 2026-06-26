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

**Live Dictation**:
Entering stable transcript text into the currently focused text field while a recording is still active, then preserving the final transcript through the normal clipboard and history paths.
_Avoid_: live paste, streaming paste

**Provider Bypass**:
A recording path that uses one live transcription provider directly and skips the Groq plus Deepgram merge and quality pipeline by design.
_Avoid_: fallback, fast mode

## Observability

**Readiness**:
Whether the system is configured and *able* to run — config loaded, API keys present, microphone available. Reported as PASS/WARN/FAIL.
_Avoid_: health (for this meaning), status

**Health**:
Whether the system is *running well right now* — judged from recent latency, errors, quality failures, and daemon state over the trailing 24h. Reported as GOOD/WARN/BAD.
_Avoid_: p0, score

**Quality Failure**:
A transcript that tripped a validation guardrail (prompt artifact, CoT meta, token injection, hallucinated suffix, mixed script, garbage).
_Avoid_: error, bad transcription

**Anomaly**:
A current metric breaching its configured threshold (latency, errors, quality, or cache lag).
_Avoid_: alert, incident

**Regression**:
A metric that has worsened relative to its own recent baseline.
_Avoid_: degradation, drop

**Fallback**:
When the merge could not use both engines and used a single engine's output instead (groq or deepgram).
_Avoid_: failover, downgrade

**Merge Strategy**:
The method used to reconcile the two engine transcripts into the [[Merge Result]].
_Avoid_: algorithm, mode

## Setup

**Profile**:
A named bundle of config defaults tuned for a device class (e.g. desktop-balanced, laptop-lowpower, container-headless), recommended from detected device signals and applied as a starting point.
_Avoid_: preset, template

**Verification**:
Confirming setup actually *works* — a live API-key auth check and, optionally, a real record-to-transcript run. Distinct from [[Readiness]], which only confirms the system is *able* to run (binaries present, config parses).
_Avoid_: smoke test, validation
