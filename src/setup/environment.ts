import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export type LinuxDistro = "fedora" | "arch" | "debian" | "ubuntu" | "unknown";
export type SessionType = "wayland" | "x11" | "headless";

export interface CommandProbe {
	name: string;
	path: string | null;
}

export interface EnvironmentInfo {
	platform: NodeJS.Platform;
	isLinux: boolean;
	isContainer: boolean;
	distro: LinuxDistro;
	sessionType: SessionType;
	isHyprland: boolean;
	commands: Record<string, CommandProbe>;
}

export interface EnvironmentProbeOptions {
	env?: NodeJS.ProcessEnv;
	exists?: (path: string) => boolean;
	readFile?: (path: string) => string;
	which?: (command: string) => string | null;
	platform?: NodeJS.Platform;
}

const REQUIRED_COMMANDS = [
	"bun",
	"ffmpeg",
	"arecord",
	"wl-copy",
	"xclip",
	"xsel",
	"notify-send",
	"systemctl",
	"hyprctl",
] as const;

const defaultWhich = (command: string): string | null => {
	try {
		return execFileSync("which", [command], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
};

const defaultReadFile = (path: string): string => readFileSync(path, "utf-8");

function detectDistro(
	readFile: (path: string) => string,
	exists: (path: string) => boolean,
): LinuxDistro {
	if (!exists("/etc/os-release")) return "unknown";

	const content = readFile("/etc/os-release").toLowerCase();
	if (content.includes("id=fedora")) return "fedora";
	if (content.includes("id=arch")) return "arch";
	if (content.includes("id=ubuntu")) return "ubuntu";
	if (content.includes("id=debian") || content.includes("id_like=debian")) {
		return "debian";
	}
	return "unknown";
}

function detectContainer(
	env: NodeJS.ProcessEnv,
	exists: (path: string) => boolean,
	readFile: (path: string) => string,
): boolean {
	if (env.container || env.DOCKER_CONTAINER) return true;
	if (exists("/.dockerenv") || exists("/run/.containerenv")) return true;

	if (exists("/proc/1/cgroup")) {
		try {
			const cgroup = readFile("/proc/1/cgroup").toLowerCase();
			return cgroup.includes("docker") || cgroup.includes("kubepods");
		} catch {
			return false;
		}
	}

	return false;
}

function detectSession(env: NodeJS.ProcessEnv): SessionType {
	if (env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === "wayland") {
		return "wayland";
	}
	if (env.DISPLAY || env.XDG_SESSION_TYPE === "x11") return "x11";
	return "headless";
}

export function getInstallCommand(
	distro: LinuxDistro,
	sessionType: SessionType,
): string | null {
	const clipboard = sessionType === "x11" ? "xclip" : "wl-clipboard";

	if (distro === "fedora") {
		const notify = "libnotify";
		return `sudo dnf install -y unzip ffmpeg alsa-utils ${clipboard} ${notify}`;
	}

	if (distro === "arch") {
		const notify = "libnotify";
		return `sudo pacman -S ffmpeg alsa-utils ${clipboard} ${notify}`;
	}

	if (distro === "ubuntu" || distro === "debian") {
		const notify = "libnotify-bin";
		return `sudo apt install ffmpeg alsa-utils unzip ${clipboard} ${notify}`;
	}

	return null;
}

export function detectEnvironment(
	options: EnvironmentProbeOptions = {},
): EnvironmentInfo {
	const env = options.env ?? process.env;
	const exists = options.exists ?? existsSync;
	const readFile = options.readFile ?? defaultReadFile;
	const which = options.which ?? defaultWhich;
	const platform = options.platform ?? process.platform;
	const commands = Object.fromEntries(
		REQUIRED_COMMANDS.map((name) => [name, { name, path: which(name) }]),
	) as Record<string, CommandProbe>;
	const sessionType = detectSession(env);

	return {
		platform,
		isLinux: platform === "linux",
		isContainer: detectContainer(env, exists, readFile),
		distro: detectDistro(readFile, exists),
		sessionType,
		isHyprland: Boolean(
			env.HYPRLAND_INSTANCE_SIGNATURE || commands.hyprctl.path,
		),
		commands,
	};
}
