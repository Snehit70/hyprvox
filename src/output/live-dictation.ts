import { spawn, spawnSync } from "node:child_process";

export interface TextTyper {
	typeText(text: string): Promise<void>;
}

type RunCommand = (command: string, args: string[]) => Promise<void>;
type IsCommandAvailable = (command: string) => boolean;

interface DesktopTextTyperOptions {
	env?: NodeJS.ProcessEnv;
	isCommandAvailable?: IsCommandAvailable;
	runCommand?: RunCommand;
}

export class DesktopTextTyper implements TextTyper {
	private readonly env: NodeJS.ProcessEnv;
	private readonly isCommandAvailable: IsCommandAvailable;
	private readonly runCommand: RunCommand;

	public constructor(options: DesktopTextTyperOptions = {}) {
		this.env = options.env ?? process.env;
		this.isCommandAvailable =
			options.isCommandAvailable ?? defaultIsCommandAvailable;
		this.runCommand = options.runCommand ?? defaultRunCommand;
	}

	public async typeText(text: string): Promise<void> {
		const command = this.resolveCommand();
		await this.runCommand(command.command, [...command.args, text]);
	}

	private resolveCommand(): { command: string; args: string[] } {
		if (this.env.WAYLAND_DISPLAY && this.isCommandAvailable("wtype")) {
			return { command: "wtype", args: [] };
		}

		if (this.isCommandAvailable("xdotool")) {
			return { command: "xdotool", args: ["type", "--clearmodifiers", "--"] };
		}

		throw new Error(
			"Live Dictation requires wtype on Wayland or xdotool on X11",
		);
	}
}

export class LiveDictationWriter {
	private committedText = "";

	public constructor(private readonly typer: TextTyper) {}

	public async acceptCommittedTranscript(
		nextTranscript: string,
	): Promise<void> {
		if (!nextTranscript.startsWith(this.committedText)) {
			this.committedText = nextTranscript;
			await this.typer.typeText(nextTranscript);
			return;
		}

		const delta = nextTranscript.slice(this.committedText.length);
		this.committedText = nextTranscript;
		if (delta.length === 0) {
			return;
		}

		await this.typer.typeText(delta);
	}

	public reset(): void {
		this.committedText = "";
	}
}

function defaultIsCommandAvailable(command: string): boolean {
	const result = spawnSync("which", [command], { stdio: "ignore" });
	return result.status === 0;
}

function defaultRunCommand(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "ignore" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} exited with code ${code}`));
		});
	});
}
