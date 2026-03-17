#!/bin/bash
# Zen AI Sidebar — Install Native Messaging Host
# Run this once after installing the extension

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/native-host/gemini_host.js"
HOST_NAME="dev.shauryasen.zen_ai_sidebar"

# Determine target directory based on OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    TARGET_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
elif [[ "$OSTYPE" == "linux"* ]]; then
    TARGET_DIR="$HOME/.mozilla/native-messaging-hosts"
else
    echo "Error: Unsupported OS. This script supports macOS and Linux."
    exit 1
fi

echo "=== Zen AI Sidebar — Native Host Installer ==="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install it first."
    exit 1
fi
NODE_PATH="$(which node)"
echo "  ✓ Node.js found: $NODE_PATH ($(node --version))"

# Check Gemini CLI
if command -v gemini &> /dev/null; then
    echo "  ✓ Gemini CLI found: $(which gemini)"
else
    echo "  ⚠ Gemini CLI not found globally."
    echo "    Install it: npm install -g @google/gemini-cli"
    echo "    Then authenticate: gemini"
    exit 1
fi

echo ""

# Create a wrapper script that ensures correct Node.js and PATH
WRAPPER_SCRIPT="$SCRIPT_DIR/native-host/gemini_host_wrapper.sh"
cat > "$WRAPPER_SCRIPT" << EOF
#!/bin/bash
# Wrapper to launch the native host with the correct environment
export PATH="$PATH"
exec "$NODE_PATH" "$HOST_SCRIPT"
EOF
chmod +x "$WRAPPER_SCRIPT"
echo "  ✓ Created wrapper script with your current PATH"

# Make host script executable too
chmod +x "$HOST_SCRIPT"

# Create target directory
mkdir -p "$TARGET_DIR"

# Generate manifest pointing to the wrapper script
cat > "$TARGET_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "Zen AI Sidebar - Gemini CLI bridge",
  "path": "$WRAPPER_SCRIPT",
  "type": "stdio",
  "allowed_extensions": ["zen-ai-sidebar@extension"]
}
EOF

echo "  ✓ Installed native messaging manifest to:"
echo "    $TARGET_DIR/$HOST_NAME.json"

echo ""
echo "=== Installation complete! ==="
echo ""
echo "Next steps:"
echo "  1. Make sure you're logged in to Gemini CLI: run 'gemini' in your terminal"
echo "  2. Load/reload the extension in your browser"
echo "  3. Open the Zen AI sidebar and start chatting!"
