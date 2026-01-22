import { spawn } from "node:child_process";
import { join } from "node:path";
import { logger } from "../utils/logger";
import { notify } from "../output/notification";

export class DaemonSupervisor {
  private restartCount = 0;
  private firstRestartTime = 0;
  private readonly MAX_RESTARTS = 3;
  private readonly WINDOW_MS = 5 * 60 * 1000;
  private isStopping = false;

  constructor(private scriptPath: string) {}

  public start() {
    this.spawnDaemon();
  }

  public stop() {
    this.isStopping = true;
  }

  private spawnDaemon() {
    if (this.isStopping) return;

    logger.info("Supervisor: Spawning daemon process...");
    
    const child = spawn("bun", ["run", this.scriptPath, "--daemon-worker"], {
      stdio: "inherit",
      env: { ...process.env, VOICE_CLI_DAEMON_WORKER: "true" }
    });

    child.on("exit", (code, signal) => {
      if (this.isStopping || code === 0) {
        logger.info(`Supervisor: Daemon exited cleanly (code: ${code}, signal: ${signal})`);
        return;
      }

      logger.error(`Supervisor: Daemon crashed (code: ${code}, signal: ${signal})`);
      this.handleCrash();
    });
  }

  private handleCrash() {
    const now = Date.now();
    
    if (now - this.firstRestartTime > this.WINDOW_MS) {
      this.restartCount = 1;
      this.firstRestartTime = now;
    } else {
      this.restartCount++;
    }

    if (this.restartCount > this.MAX_RESTARTS) {
      const msg = `Daemon crashed ${this.MAX_RESTARTS} times in 5 minutes. Stopping.`;
      logger.error(msg);
      notify("Daemon Critical Failure", msg, "error");
      process.exit(1);
    }

    logger.warn(`Supervisor: Restarting daemon (${this.restartCount}/${this.MAX_RESTARTS})...`);
    setTimeout(() => this.spawnDaemon(), 1000);
  }
}
