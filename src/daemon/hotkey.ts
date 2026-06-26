import { EventEmitter } from "node:events";
import {
	GlobalKeyboardListener,
	type IGlobalKeyEvent,
} from "node-global-key-listener";
import { loadConfig } from "../config/loader";
import type { Config } from "../config/schema";
import { notify } from "../output/notification";
import { logError, logger } from "../utils/logger";

export interface HotkeyBinding {
	id: "default" | "soniox";
	hotkey: string;
	event: "trigger" | "soniox-trigger";
	triggerKey: string;
	modifiers: string[];
}

export function createHotkeyBindings(
	config: Pick<Config, "behavior" | "liveDictation">,
): HotkeyBinding[] {
	const bindings: HotkeyBinding[] = [];
	const defaultBinding = parseHotkeyBinding(
		"default",
		config.behavior.hotkey,
		"trigger",
	);
	if (defaultBinding) {
		bindings.push(defaultBinding);
	}

	if (config.liveDictation.soniox.enabled) {
		const sonioxBinding = parseHotkeyBinding(
			"soniox",
			config.liveDictation.soniox.triggerKey,
			"soniox-trigger",
		);
		if (sonioxBinding) {
			bindings.push(sonioxBinding);
		}
	}

	return bindings;
}

export function matchesHotkeyBinding(
	binding: HotkeyBinding,
	keyName: string | undefined,
	down: Record<string, boolean>,
): boolean {
	const normalizedKeyName = keyName?.toUpperCase().replace("CONTROL", "CTRL");
	if (normalizedKeyName !== binding.triggerKey) {
		return false;
	}

	return binding.modifiers.every((mod) => {
		if (mod === "CTRL" || mod === "CONTROL") {
			return (
				down["LEFT CTRL"] ||
				down["RIGHT CTRL"] ||
				down["LEFT CONTROL"] ||
				down["RIGHT CONTROL"]
			);
		}
		if (mod === "ALT") return down["LEFT ALT"] || down["RIGHT ALT"];
		if (mod === "SHIFT") return down["LEFT SHIFT"] || down["RIGHT SHIFT"];
		if (mod === "META" || mod === "SUPER" || mod === "WIN") {
			return (
				down["LEFT META"] ||
				down["RIGHT META"] ||
				down["LEFT WIN"] ||
				down["RIGHT WIN"]
			);
		}

		return down[mod];
	});
}

function parseHotkeyBinding(
	id: HotkeyBinding["id"],
	hotkey: string,
	event: HotkeyBinding["event"],
): HotkeyBinding | null {
	const normalizedHotkey = hotkey.toUpperCase();
	if (normalizedHotkey === "DISABLED") {
		return null;
	}

	const parts = normalizedHotkey.split("+").map((p) => p.trim());
	const triggerKeyRaw = parts[parts.length - 1];
	if (!triggerKeyRaw) {
		return null;
	}

	return {
		id,
		hotkey: normalizedHotkey,
		event,
		triggerKey: triggerKeyRaw.replace("CONTROL", "CTRL"),
		modifiers: parts.slice(0, parts.length - 1),
	};
}

export class HotkeyListener extends EventEmitter {
	private listener: GlobalKeyboardListener | null = null;
	private registered = false;
	private pressedBindings = new Set<HotkeyBinding["id"]>();

	public start() {
		if (this.registered) return;

		try {
			const config = loadConfig();
			const bindings = createHotkeyBindings(config);

			if (bindings.length === 0) {
				logger.info("Hotkey listener is disabled in configuration");
				return;
			}

			this.listener = new GlobalKeyboardListener();

			this.listener.addListener(
				(e: IGlobalKeyEvent, down: Record<string, boolean>) => {
					const keyName = e.name?.toUpperCase();

					if (e.state === "DOWN") {
						for (const binding of bindings) {
							if (
								matchesHotkeyBinding(binding, keyName, down) &&
								!this.pressedBindings.has(binding.id)
							) {
								this.pressedBindings.add(binding.id);
								logger.info(`Hotkey triggered: ${binding.hotkey}`);
								this.emit(binding.event);
							}
						}
					} else if (e.state === "UP") {
						const normalizedKeyName = keyName?.replace("CONTROL", "CTRL");
						for (const binding of bindings) {
							if (normalizedKeyName === binding.triggerKey) {
								this.pressedBindings.delete(binding.id);
							}
						}
					}
				},
			);

			this.registered = true;
			logger.info("Global hotkey listener started");
		} catch (error) {
			const msg =
				"Failed to start hotkey listener. Ensure you have permissions (input group or root).";
			logError(msg, error);
			notify(
				"Hotkey Error",
				"Failed to bind global hotkey. Check permissions/XWayland.",
				"error",
			);
			throw error;
		}
	}

	public stop() {
		if (this.listener) {
			this.listener.kill();
			this.listener = null;
			this.registered = false;
			logger.info("Global hotkey listener stopped");
		}
	}
}
