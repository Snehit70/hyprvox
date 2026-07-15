import { homedir } from "node:os";
import { join } from "node:path";

// Command socket the app listens on and the CLI's socket verbs connect to.
// HYPRVOX_SOCKET_PATH lets a test instance run beside a live daemon.
export const SOCKET_PATH =
	process.env.HYPRVOX_SOCKET_PATH ||
	join(homedir(), ".config", "hypr", "vox", "daemon.sock");
