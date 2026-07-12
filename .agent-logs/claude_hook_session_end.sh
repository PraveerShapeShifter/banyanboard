#!/usr/bin/env bash
#
# Shell wrapper for Claude Code SessionEnd hook.
# Ensures correct Python interpreter and repo context when invoking the converter.
#

set -euo pipefail

# Get the directory where this script is located (co-located with the converter)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find Python 3 interpreter
if command -v python3 &> /dev/null; then
    PYTHON=python3
elif command -v python &> /dev/null; then
    # Check if it's Python 3
    if python --version 2>&1 | grep -q "Python 3"; then
        PYTHON=python
    else
        echo "ERROR: Python 3 not found" >&2
        exit 1
    fi
else
    echo "ERROR: Python not found" >&2
    exit 1
fi

# Execute converter script (reads hook JSON from stdin)
exec "$PYTHON" "$SCRIPT_DIR/claude_transcript_to_md.py"
