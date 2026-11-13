#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

zip -j aipot.pbar aipot.json aipot.ps1 ../../public/icon.png
