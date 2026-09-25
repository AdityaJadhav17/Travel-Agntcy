#!/usr/bin/env sh
set -eu

# Run as the checkout owner BEFORE Docker creates any bind-mount directories.
# This keeps the parent writable for host-side services.log collection on Linux.
mkdir -p .runtime/ci/playwright .runtime/ci/playwright-report
