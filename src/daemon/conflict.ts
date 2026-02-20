import { exec } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { notify } from "../output/notification";
import { logger } from "../utils/logger";

const execAsync = promisify(exec);

const PYTHON_SCRIPT = `
import ctypes
import sys
import os

try:
    x11 = ctypes.cdll.LoadLibrary("libX11.so.6")
except OSError:
    sys.exit(0) # Not X11 or lib not found

display = x11.XOpenDisplay(None)
if not display:
    sys.exit(0) # Not X11

# Constants
GrabModeAsync = 1

# Error handler
error_occurred = False

# CFUNCTYPE(restype, *argtypes)
# XSetErrorHandler takes a function pointer: int (*handler)(Display *, XErrorEvent *)
ERROR_HANDLER_FUNC = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)

def py_error_handler(display, error_event):
    global error_occurred
    error_occurred = True
    return 0

c_handler = ERROR_HANDLER_FUNC(py_error_handler)
x11.XSetErrorHandler(c_handler)

keysym_name = sys.argv[1].encode('utf-8')
keysym = x11.XStringToKeysym(keysym_name)

if keysym == 0:
    # KeySym not found
    sys.exit(0)

keycode = x11.XKeysymToKeycode(display, keysym)
if keycode == 0:
    sys.exit(0)

modifiers = int(sys.argv[2])
root = x11.XDefaultRootWindow(display)

# XGrabKey(display, keycode, modifiers, grab_window, owner_events, pointer_mode, keyboard_mode)
x11.XGrabKey(display, keycode, modifiers, root, 0, GrabModeAsync, GrabModeAsync)
x11.XSync(display, 0)

if error_occurred:
    print("CONFLICT")
else:
    x11.XUngrabKey(display, keycode, modifiers, root)
    print("OK")

x11.XCloseDisplay(display)
`;

const MODIFIERS: Record<string, number> = {
	SHIFT: 1,
	LOCK: 2,
	CTRL: 4,
	CONTROL: 4,
	ALT: 8,
	MOD1: 8,
	META: 64,
	SUPER: 64,
	WIN: 64,
	MOD4: 64,
};

const KEY_MAP: Record<string, string> = {
	"RIGHT CONTROL": "Control_R",
	"LEFT CONTROL": "Control_L",
	"RIGHT ALT": "Alt_R",
	"LEFT ALT": "Alt_L",
	"RIGHT SHIFT": "Shift_R",
	"LEFT SHIFT": "Shift_L",
	SPACE: "space",
	ENTER: "Return",
	RETURN: "Return",
	BACKSPACE: "BackSpace",
	TAB: "Tab",
	ESCAPE: "Escape",
	UP: "Up",
	DOWN: "Down",
	LEFT: "Left",
	RIGHT: "Right",
	...Object.fromEntries(
		Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]),
	),
};

function parseHotkey(
	hotkey: string,
): { keysym: string; modifiers: number } | null {
	const parts = hotkey
		.toUpperCase()
		.split("+")
		.map((p) => p.trim());
	if (parts.length === 0) return null;

	let modifiers = 0;
	let triggerKey = "";

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part) continue;

		if (i < parts.length - 1 && Object.hasOwn(MODIFIERS, part)) {
			modifiers |= MODIFIERS[part]!;
			continue;
		}

		if (Object.hasOwn(KEY_MAP, part)) {
			triggerKey = KEY_MAP[part]!;
		} else {
			triggerKey = part;
		}
	}

	if (!triggerKey) return null;

	return { keysym: triggerKey, modifiers };
}

export async function checkHotkeyConflict(hotkey: string): Promise<boolean> {
	const parsed = parseHotkey(hotkey);
	if (!parsed) {
		logger.warn(`Could not parse hotkey for conflict detection: ${hotkey}`);
		return false;
	}

	const { keysym, modifiers } = parsed;
	const scriptPath = join(tmpdir(), `hyprvox-conflict-${Date.now()}.py`);

	try {
		writeFileSync(scriptPath, PYTHON_SCRIPT);

		const { stdout } = await execAsync(
			`python3 "${scriptPath}" "${keysym}" ${modifiers}`,
		);

		const output = stdout.trim();
		if (output === "CONFLICT") {
			logger.warn(
				`Hotkey conflict detected: ${hotkey} is already in use by another application.`,
			);
			notify(
				"Hotkey Conflict",
				`The hotkey '${hotkey}' is already in use. It may not work correctly.`,
				"warning",
			);
			return true;
		}

		return false;
	} catch (error) {
		logger.debug(
			{ error },
			"Failed to run hotkey conflict detection (likely harmless)",
		);
		return false;
	} finally {
		try {
			unlinkSync(scriptPath);
		} catch {}
	}
}
