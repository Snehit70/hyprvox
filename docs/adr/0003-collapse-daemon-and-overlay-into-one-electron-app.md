# Collapse the daemon and overlay into a single resident Electron app

Status: accepted — implementation gated on the trigger-latency measurement window (see Consequences)

Hyprvox currently runs a Bun daemon and an Electron overlay as separate processes
across a unix socket, with **four independent supervision layers, each with its own
terminal state**: systemd's `StartLimitBurst=3`, `supervisor.ts`'s `MAX_RESTARTS`,
`OverlayProcessManager`'s 5-restarts-per-60s, and `IPCClient`'s 10 reconnect
attempts. Any one of them can permanently give up while the others believe the
system is healthy, and none of them can see the others' terminal state. That is the
reliability risk this decides against, and it is a property of the topology rather
than of any bug we can point at.

We are collapsing to one resident Electron app: main owns the trigger, the state
machine, and the STT WebSockets; a `utilityProcess` owns the merge and quality
pipeline; the renderer keeps its own microphone capture and FFT waveform. Launched
via Hyprland `exec-once`. systemd, `supervisor.ts`, and `OverlayProcessManager` all
go away, and Electron becomes the single supervisor.

## Considered Options

**Relocate the transcribe pipeline into Electron main directly.** Rejected on
measurement. The pipeline is portable Node (zero `Bun.*` APIs, three `import.meta.dir`
uses), so relocating it is nearly free — but `decideMerge` is **quadratic** in
transcript length and blocks the event loop for **~38ms at 1,500 words**, which is
~10 minutes of speech and therefore exactly the configured `clipboard.maxDuration`
ceiling. At 3,000 words it blocks ~144ms. Since that stall lands precisely while the
overlay is animating its `processing` state, it would be visible rather than hidden.
Everything else measured is safe (`validateTranscript` 4.8ms at 25kb,
`buildPcm16kMonoWav` 7.6ms on a 19MB buffer), so `utilityProcess` isolation is needed
for the merge specifically, not for the pipeline as a whole.

**Keep the daemon.** Its process isolation is a real benefit, and we had been
dismissing it. `utilityProcess` preserves that isolation *inside* the single-app
model while still deleting the hand-rolled supervision — so we get the benefit
without the four-layer failure mode.

**Socket-activate the daemon instead.** Unimplementable: `listen({ fd: 3 })` throws
`EINVAL` on Bun 1.3.3, so `sd_listen_fds`-style activation is not available to us.

## Explicitly not changing

- **Audio capture stays double.** `arecord` feeds transcription; the renderer's
  `getUserMedia` feeds the waveform. This looks redundant and is not: the renderer
  path drives 128 FFT bins at 60fps, where the daemon's IPC path carries 2 smoothed
  scalars at 30fps. Collapsing them would visibly degrade the waveform.
- **The CLI stays a one-shot `SIGUSR1`.** It does not become a socket client.
- The overlay window stays permanently mapped and click-through, per ADR-0001.

## Consequences

- **This ADR does not supersede ADR-0001 and is not in tension with it.** ADR-0001
  decided *rendering technology* (Electron over GTK); this decides *process
  topology*. Electron stays either way. ADR-0001's precedent — that a felt slowness
  was a fixable bug rather than an inherent cost, so don't rewrite — still stands,
  and is why the next point matters.
- **This decision is justified by the supervision topology alone, not by latency.**
  The reported symptom (overlay slow to respond in long sessions, fixed by a restart)
  remains **undiagnosed**: measured IPC latency is flat at ~1ms across 63,021 events,
  and the daemon's own `starting` timestamp is taken *before* the Deepgram WebSocket
  opens, so existing telemetry structurally cannot see the suspected stall. A
  trigger-latency measurement window is running to find it. Implementation waits for
  that window to close, because shipping this first would destroy the only evidence
  that could tell us whether it fixes anything. If the window indicts something this
  rewrite would not have fixed, that is worth knowing before the rewrite, not after.
