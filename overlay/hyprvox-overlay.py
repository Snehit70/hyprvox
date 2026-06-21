#!/usr/bin/env python3
"""Lightweight native GTK overlay for Hyprvox."""

from __future__ import annotations

import json
import math
import signal
import socket
import threading
from pathlib import Path
from typing import Any

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GtkLayerShell", "0.1")
try:
	from gi.repository import Gdk, GLib, Gtk, GtkLayerShell  # noqa: E402
except (ImportError, ValueError) as error:
	print(f"Hyprvox GTK overlay dependencies are unavailable: {error}", flush=True)
	raise SystemExit(78) from None


SOCKET_PATH = Path.home() / ".config" / "hypr" / "vox" / "daemon.sock"
WIDTH = 400
HEIGHT = 60
SUCCESS_HOLD_MS = 1500
ERROR_HOLD_MS = 3000
DEFAULT_NOISE_FLOOR = 0.012
MIN_NOISE_FLOOR = 0.004
MAX_NOISE_FLOOR = 0.025
CALIBRATION_FRAMES = 12
VOICE_RMS_CEILING = 0.16
VOICE_PEAK_CEILING = 0.55


def normalize_voice_level(
	rms: float, peak: float, noise_floor: float = DEFAULT_NOISE_FLOOR
) -> float:
	"""Map linear PCM levels into a perceptual 0..1 voice amplitude."""
	if not math.isfinite(rms) or not math.isfinite(peak):
		return 0.0

	noise_floor = max(MIN_NOISE_FLOOR, min(MAX_NOISE_FLOOR, noise_floor))
	# A gentle gate (was 1.35x) keeps quiet talkers and soft consonants visible
	# while still rejecting steady room noise.
	gate = noise_floor * 1.12
	if rms <= gate:
		return 0.0

	rms_range = max(0.001, VOICE_RMS_CEILING - gate)
	rms_level = max(0.0, min(1.0, (rms - gate) / rms_range))
	peak_gate = max(gate * 2.0, 0.025)
	peak_range = max(0.001, VOICE_PEAK_CEILING - peak_gate)
	peak_level = max(0.0, min(1.0, (peak - peak_gate) / peak_range))

	# Square-root compression makes normal speech expressive without allowing a
	# single transient peak to dominate the entire waveform.
	return min(1.0, math.sqrt(rms_level) * 0.82 + math.sqrt(peak_level) * 0.18)


class Waveform(Gtk.DrawingArea):
	def __init__(self) -> None:
		super().__init__()
		self.target_level = 0.0
		self.target_bars = [0.0] * 24
		self.display_bars = [0.0] * 24
		self.noise_floor = DEFAULT_NOISE_FLOOR
		self.calibration_samples: list[float] = []
		self.active = False
		self.connect("draw", self._draw)
		# 60 fps render loop. The daemon now feeds ~16 ms frames, so the overlay
		# can track speech per-syllable instead of the old ~8 fps chunk cadence.
		GLib.timeout_add(16, self._tick)

	def set_level(
		self, level: float, peak: float = 0.0, waveform: list[float] | None = None
	) -> None:
		if not math.isfinite(level) or not math.isfinite(peak):
			self.target_level = 0.0
			self.target_bars = [0.0] * len(self.target_bars)
			return

		level = max(0.0, min(1.0, level))
		peak = max(0.0, min(1.0, peak))

		# Learn the room's noise floor in the background without ever blanking the
		# display: the overlay reacts from the very first frame and simply refines
		# its gate over the opening frames.
		if len(self.calibration_samples) < CALIBRATION_FRAMES:
			self.calibration_samples.append(level)
			if len(self.calibration_samples) == CALIBRATION_FRAMES:
				sorted_samples = sorted(self.calibration_samples)
				baseline = sorted_samples[int((CALIBRATION_FRAMES - 1) * 0.75)]
				self.noise_floor = max(
					MIN_NOISE_FLOOR,
					min(MAX_NOISE_FLOOR, baseline * 1.15),
				)

		self.target_level = normalize_voice_level(level, peak, self.noise_floor)
		if self.target_level == 0.0:
			self.target_bars = [0.0] * len(self.target_bars)
			# Follow gradual changes in fan/room noise only while the gate says the
			# input is silent. Speech therefore cannot raise the learned floor.
			self.noise_floor = max(
				MIN_NOISE_FLOOR,
				min(MAX_NOISE_FLOOR, self.noise_floor * 0.96 + level * 0.04),
			)
		elif waveform:
			clean_waveform = [
				max(0.0, min(1.0, value)) if math.isfinite(value) else 0.0
				for value in waveform[: len(self.target_bars)]
			]
			clean_waveform.extend(
				[0.0] * (len(self.target_bars) - len(clean_waveform))
			)
			# Each bar tracks its OWN frequency bin (no single-peak normalization),
			# so the spectrum dances independently like the old Web Audio analyser.
			# A gentle overall-loudness envelope keeps faint bins from flattening
			# while letting louder speech push the whole spectrum taller.
			envelope = 0.45 + 0.55 * self.target_level
			self.target_bars = [
				min(1.0, (0.10 + 0.90 * value) * envelope)
				for value in clean_waveform
			]
		else:
			self.target_bars = [self.target_level] * len(self.target_bars)

	def reset(self) -> None:
		self.target_level = 0.0
		self.target_bars = [0.0] * 24
		self.display_bars = [0.0] * 24
		self.noise_floor = DEFAULT_NOISE_FLOOR
		self.calibration_samples = []
		self.queue_draw()

	def _tick(self) -> bool:
		if self.active:
			# Track every frequency bar independently. Tuned for the 60 fps loop:
			# a fast attack (~20 ms) snaps onto consonants while a gentler release
			# (~90 ms) lets bars fall smoothly without flickering.
			for index, target in enumerate(self.target_bars):
				current = self.display_bars[index]
				smoothing = 0.50 if target > current else 0.16
				current += (target - current) * smoothing
				self.display_bars[index] = 0.0 if current < 0.008 else current
			self.queue_draw()
		return True

	def _draw(self, _widget: Gtk.Widget, context: Any) -> bool:
		width = self.get_allocated_width()
		height = self.get_allocated_height()
		bar_pairs = len(self.display_bars)
		bar_width = 3.0
		gap = 2.0
		center_x = width / 2

		context.set_source_rgba(1.0, 1.0, 1.0, 0.88)
		for pair_index, sample_level in enumerate(self.display_bars):
			if sample_level < 0.01:
				continue
			# Low-to-high speech frequencies run from the center outwards and are
			# mirrored, matching the former Electron static spectrum.
			edge_weight = 1.0 - 0.25 * (pair_index / max(1, bar_pairs - 1))
			bar_height = 2.0 + (height - 12) * sample_level * edge_weight
			distance = gap / 2 + pair_index * (bar_width + gap)
			y = (height - bar_height) / 2
			context.rectangle(center_x - distance - bar_width, y, bar_width, bar_height)
			context.rectangle(center_x + distance, y, bar_width, bar_height)
		context.fill()
		return False


class OverlayWindow(Gtk.ApplicationWindow):
	def __init__(self, application: Gtk.Application) -> None:
		super().__init__(application=application)
		self.previous_status = "idle"
		self.hide_timer: int | None = None
		self.waveform = Waveform()
		self.label = Gtk.Label()

		self.set_decorated(False)
		self.set_resizable(False)
		self.set_accept_focus(False)
		self.set_skip_taskbar_hint(True)
		self.set_skip_pager_hint(True)
		self.set_size_request(WIDTH, HEIGHT)
		self.set_name("hyprvox-overlay")

		GtkLayerShell.init_for_window(self)
		GtkLayerShell.set_layer(self, GtkLayerShell.Layer.OVERLAY)
		GtkLayerShell.set_namespace(self, "hyprvox-overlay")
		GtkLayerShell.set_keyboard_mode(self, GtkLayerShell.KeyboardMode.NONE)
		GtkLayerShell.set_anchor(self, GtkLayerShell.Edge.BOTTOM, True)
		GtkLayerShell.set_margin(self, GtkLayerShell.Edge.BOTTOM, 80)
		GtkLayerShell.set_exclusive_zone(self, -1)

		stack = Gtk.Overlay()
		stack.add(self.waveform)
		stack.add_overlay(self.label)
		self.add(stack)
		self._install_css()
		self.show_all()
		self.hide()

	def _install_css(self) -> None:
		provider = Gtk.CssProvider()
		provider.load_from_data(
			b"""
			#hyprvox-overlay {
				background-color: rgba(18, 18, 24, 0.94);
				border-radius: 10px;
				border: 1px solid rgba(255, 255, 255, 0.12);
			}
			#hyprvox-overlay label {
				color: rgba(255, 255, 255, 0.90);
				font: 600 14px Sans;
			}
			"""
		)
		screen = Gdk.Screen.get_default()
		if screen is not None:
			Gtk.StyleContext.add_provider_for_screen(
				screen, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
			)

	def apply_message(self, message: dict[str, Any]) -> bool:
		message_type = message.get("type")
		if message_type == "audio_level":
			waveform = message.get("waveform")
			self.waveform.set_level(
				float(message.get("level", 0.0)),
				float(message.get("peak", 0.0)),
				[
					float(value)
					for value in waveform
					if isinstance(value, (int, float))
				]
				if isinstance(waveform, list)
				else None,
			)
			return False
		if message_type not in ("hello", "state"):
			return False

		status = str(message.get("status", "idle"))
		was_processing = self.previous_status == "processing"
		self.previous_status = status
		self._cancel_hide_timer()

		if status == "idle":
			if was_processing and message.get("lastTranscription"):
				self._show_status("✓  Copied", "success")
				self.hide_timer = GLib.timeout_add(SUCCESS_HOLD_MS, self._hide)
			else:
				self._hide()
		elif status in ("starting", "recording"):
			if status == "starting":
				self.waveform.reset()
			self.label.hide()
			self.waveform.active = True
			self.waveform.show()
			self.show()
		elif status in ("stopping", "processing"):
			self._show_status("Transcribing…", "processing")
		elif status == "error":
			message_text = str(message.get("error") or "Transcription failed")
			self._show_status(f"⚠  {message_text[:72]}", "error")
			self.hide_timer = GLib.timeout_add(ERROR_HOLD_MS, self._hide)
		return False

	def _show_status(self, text: str, state: str) -> None:
		self.waveform.active = state == "recording"
		self.waveform.hide()
		self.label.set_text(text)
		self.label.show()
		self.show()

	def _hide(self) -> bool:
		self.waveform.active = False
		self.waveform.reset()
		self.hide()
		self.hide_timer = None
		return False

	def _cancel_hide_timer(self) -> None:
		if self.hide_timer is not None:
			GLib.source_remove(self.hide_timer)
			self.hide_timer = None


class IPCWorker(threading.Thread):
	def __init__(self, on_message: Any) -> None:
		super().__init__(name="hyprvox-ipc", daemon=True)
		self.on_message = on_message
		self.stopped = threading.Event()

	def run(self) -> None:
		delay = 0.1
		while not self.stopped.is_set():
			try:
				with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
					client.settimeout(1.0)
					client.connect(str(SOCKET_PATH))
					delay = 0.1
					buffer = b""
					while not self.stopped.is_set():
						try:
							chunk = client.recv(65536)
						except socket.timeout:
							continue
						if not chunk:
							break
						buffer += chunk
						while b"\n" in buffer:
							line, buffer = buffer.split(b"\n", 1)
							try:
								message = json.loads(line)
								GLib.idle_add(self.on_message, message)
							except (json.JSONDecodeError, UnicodeDecodeError):
								continue
			except (FileNotFoundError, ConnectionRefusedError, OSError):
				self.stopped.wait(delay)
				delay = min(delay * 2, 5.0)

	def stop(self) -> None:
		self.stopped.set()


class OverlayApplication(Gtk.Application):
	def __init__(self) -> None:
		super().__init__(application_id="com.hyprvox.GtkOverlay")
		self.window: OverlayWindow | None = None
		self.worker: IPCWorker | None = None

	def do_activate(self) -> None:
		if self.window is None:
			self.window = OverlayWindow(self)
			self.worker = IPCWorker(self.window.apply_message)
			self.worker.start()

	def do_shutdown(self) -> None:
		if self.worker is not None:
			self.worker.stop()
		Gtk.Application.do_shutdown(self)


def main() -> int:
	application = OverlayApplication()
	signal.signal(signal.SIGTERM, lambda *_args: application.quit())
	return application.run([])


if __name__ == "__main__":
	raise SystemExit(main())
