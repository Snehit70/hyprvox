import { Command } from "commander";
import { DaemonService } from "../daemon/service";
import { AudioDeviceService } from "../audio/device-service";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../config/loader";
import { boostCommand } from "./boost";

const program = new Command();
const pidFile = join(homedir(), ".config", "voice-cli", "daemon.pid");

program
  .name("voice-cli")
  .description("Voice-to-text CLI daemon")
  .version("1.0.0");

program
  .command("start")
  .description("Start the daemon")
  .action(() => {
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

    console.log("Starting daemon...");
    const service = new DaemonService();
    service.start();

    process.on("SIGINT", () => {
      console.log("Stopping daemon...");
      service.stop();
      process.exit(0);
    });
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
      process.kill(pid, "SIGINT");
      console.log(`Stopped daemon (PID: ${pid})`);
    } catch (error) {
      console.error("Failed to stop daemon:", error);
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
