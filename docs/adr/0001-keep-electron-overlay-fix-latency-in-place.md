# Keep the Electron overlay; fix show latency in place rather than rewriting in GTK

The overlay felt like it took up to 4s to appear. Timing logs showed this is two
stacked, fixable delays — a ~1.1s Electron `window.show()` compositor-map cost (the
window was unmapped via `hide()` when idle) and a ~1s daemon-side `recorder.start()`
gap (a blocking `execSync("arecord --version")` on the hot path plus waiting for
arecord's first audio buffer) — **not** inherent Electron overhead.

We chose to keep the overlay window permanently mapped + click-through
(`setIgnoreMouseEvents(true, { forward: true })`) and move the arecord capability
check off the hot path, instead of rewriting the overlay in GTK/layer-shell.

GTK was considered for startup speed and resident footprint. Speed turned out to be
an Electron *bug*, leaving only footprint — which we judged insufficient on its own
to justify a second-language (Rust/Vala/PyGObject + gtk4-layer-shell) native
subproject and the dual-backend maintenance a config switch would require.

GTK remains an option **only** if resident memory or crash rate proves problematic
*after* these fixes, and if pursued it should replace Electron, not coexist behind a
config switch.
