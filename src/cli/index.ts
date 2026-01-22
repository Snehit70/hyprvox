import { Command } from "commander";
import { DaemonService, type DaemonState } from "../daemon/service";
import { DaemonSupervisor } from "../daemon/supervisor";
import { AudioDeviceService } from "../audio/device-service";
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { loadConfig } from "../config/loader";
import { boostCommand } from "./boost";

const program = new Command();
const configDir = join(homedir(), ".config", "voice-cli");
const pidFile = join(configDir, "daemon.pid");
const stateFile = join(configDir, "daemon.state");

program
  .name("voice-cli")
  .description("Voice-to-text CLI daemon")
  .version("1.0.0");

program
  .command("start")
  .description("Start the daemon")
  .option("--no-supervisor", "Run directly without supervisor")
  .action((options) => {
    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
        try {
          process.kill(pid, 0); 
          console.error(`Daemon is already running (PID: ${pid})`);
          process.exit(1);
        } catch (e) {
        }
      } catch (e) {
      }
    }

    if (options.supervisor && !process.env.VOICE_CLI_DAEMON_WORKER) {
      console.log("Starting daemon with supervisor...");
      const supervisor = new DaemonSupervisor(join(process.cwd(), "index.ts"));
      supervisor.start();
    } else {
      console.log("Starting daemon worker...");
      const service = new DaemonService();
      service.start().catch(() => process.exit(1));

      process.on("SIGINT", () => {
        service.stop();
        process.exit(0);
      });
      
      process.on("SIGTERM", () => {
        service.stop();
        process.exit(0);
      });
    }
  });

program
  .command("stop")
  .description("Stop the daemon")
  .action(() => {
    if (!existsSync(pidFile)) {
      console.error("Daemon is not running (no PID file found)");
      return;
    }

    try {
      const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
      process.kill(pid, "SIGTERM");
      console.log(`Stopped daemon (PID: ${pid})`);
      
      if (existsSync(stateFile)) unlinkSync(stateFile);
    } catch (error) {
      console.error("Failed to stop daemon:", error);
      if (existsSync(pidFile)) unlinkSync(pidFile);
    }
  });

program
  .command("restart")
  .description("Restart the daemon")
  .action(async () => {
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
      process.kill(pid, "SIGTERM");
      console.log("Stopping daemon...");
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log("Starting daemon...");
    const supervisor = new DaemonSupervisor(join(process.cwd(), "index.ts"));
    supervisor.start();
  });

program
  .command("status")
  .description("Show daemon status")
  .action(() => {
    if (!existsSync(pidFile)) {
      console.log("Status: Stopped");
      return;
    }

    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0);
      console.log(`Status: Running (PID: ${pid})`);
      
      if (existsSync(stateFile)) {
        const state: DaemonState = JSON.parse(readFileSync(stateFile, "utf-8"));
        console.log(`State:  ${state.status.toUpperCase()}`);
        console.log(`Uptime: ${state.uptime}s`);
        console.log(`Errors: ${state.errorCount}`);
        if (state.lastTranscription) {
          console.log(`Last:   ${new Date(state.lastTranscription).toLocaleString()}`);
        }
        if (state.lastError) {
          console.log(`Error:  ${state.lastError}`);
        }
      }
    } catch (e) {
      console.log("Status: Dead (PID file exists but process is not running)");
    }
  });

program
  .command("install")
  .description("Install systemd service")
  .action(() => {
    const installScript = join(process.cwd(), "scripts", "install.sh");
    
    if (!existsSync(installScript)) {
      console.error(`Installation script not found at: ${installScript}`);
      process.exit(1);
    }

    try {
      console.log("Running installation script...");
      execSync(`bash ${installScript}`, { stdio: "inherit" });
    } catch (error) {
      console.error("Installation failed:", (error as Error).message);
      process.exit(1);
    }
  });

program
  .command("uninstall")
  .description("Remove systemd service")
  .action(() => {
    const servicePath = join(homedir(), ".config", "systemd", "user", "voice-cli.service");
    if (existsSync(servicePath)) {
      console.log("Stopping and disabling service...");
      try {
        execSync("systemctl --user stop voice-cli", { stdio: "ignore" });
        execSync("systemctl --user disable voice-cli", { stdio: "ignore" });
        unlinkSync(servicePath);
        execSync("systemctl --user daemon-reload", { stdio: "ignore" });
        console.log("Service removed successfully.");
      } catch (error) {
        console.error("Failed to remove service:", (error as Error).message);
      }
    } else {
      console.log("Service file not found.");
    }
  });

program
  .command("list-mics")
  .description("List available microphone devices")
  .action(async () => {
    const deviceService = new AudioDeviceService();
    try {
      console.log("Scanning for audio devices...");
      const devices = await deviceService.listDevices();
      
      if (devices.length === 0) {
        console.log("No audio devices found.");
        return;
      }

      console.log("\nAvailable Audio Devices:");
      console.log("------------------------");
      devices.forEach(device => {
        console.log(`ID:   ${device.id}`);
        console.log(`Desc: ${device.description}`);
        console.log("------------------------");
      });
      
      console.log("\nTo use a device, add its ID to your config file (~/.config/voice-cli/config.json):");
      console.log('"behavior": { "audioDevice": "YOUR_DEVICE_ID" }');
      
    } catch (error) {
      console.error("Failed to list microphones:", error);
    }
  });

program
  .command("config")
  .description("Configure settings (interactive)")
  .action(() => {
    console.log("Configuration wizard not implemented yet. Please edit ~/.config/voice-cli/config.json directly.");
  });

program.addCommand(boostCommand);

program
  .command("health")
  .description("Check system health")
  .action(() => {
    console.log("Checking system health...");
    try {
      loadConfig();
      console.log("✅ Config loaded");
    } catch (e) {
      console.log("❌ Config Error:", (e as Error).message);
    }
  });

export { program };
