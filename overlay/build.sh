#!/bin/bash
set -e

echo "Building voice-overlay (release mode)..."
cd "$(dirname "$0")"

cargo build --release

echo ""
echo "✅ Build complete!"
echo "Binary: $(pwd)/target/release/voice-overlay"
echo "Size: $(du -h target/release/voice-overlay | cut -f1)"
