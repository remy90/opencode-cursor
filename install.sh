#!/bin/bash
set -e

# OpenCode-Cursor one-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/nomadcxx/opencode-cursor/main/install.sh | bash

echo "OpenCode-Cursor Installer"
echo "========================="
echo ""

# Check for Go
if ! command -v go &> /dev/null; then
    echo "Error: Go is not installed"
    echo "Please install Go 1.21 or later from https://golang.org/dl/"
    exit 1
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

echo "Downloading opencode-cursor..."
git clone --depth 1 https://github.com/nomadcxx/opencode-cursor.git
cd opencode-cursor

echo "Building installer..."
go build -o ./opencode-cursor-installer ./cmd/installer

echo ""
echo "Running installer..."
echo ""

# Run the installer in the cloned directory context
OPENCODE_CURSOR_PROJECT_DIR="$(pwd)" ./opencode-cursor-installer "$@"

EXIT_CODE=$?

# Cleanup
cd /
rm -rf "$TEMP_DIR"

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "Installation complete!"
else
    echo "Installation failed with exit code $EXIT_CODE"
fi

exit $EXIT_CODE
