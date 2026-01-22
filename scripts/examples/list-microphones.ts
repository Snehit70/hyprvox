import { AudioDeviceService } from "../../src/audio/device-service";

/**
 * List Microphones Example
 * 
 * Demonstrates how to discover available ALSA audio input devices.
 * 
 * Usage:
 * Run: bun run scripts/examples/list-microphones.ts
 */

async function main() {
  const deviceService = new AudioDeviceService();
  
  console.log("Scanning for audio input devices...");
  
  try {
    const devices = await deviceService.listDevices();
    
    if (devices.length === 0) {
      console.log("No audio input devices found.");
      return;
    }

    console.log("\nAvailable Devices:");
    console.log("ID".padEnd(15) + " | " + "Description");
    console.log("-".repeat(50));
    
    devices.forEach(device => {
      console.log(device.id.padEnd(15) + " | " + device.description);
    });

  } catch (error: any) {
    console.error("Failed to list devices:", error.message);
    process.exit(1);
  }
}

main();
