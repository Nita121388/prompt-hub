#!/bin/bash
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[dev-debug] Node.js not found. Install Node.js first."
  read -r -p "Press Enter to exit..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[dev-debug] npm not found. Install Node.js first."
  read -r -p "Press Enter to exit..."
  exit 1
fi

if [ "$#" -eq 0 ]; then
  set -- --watch
fi

npm run dev:debug -- "$@"
status=$?
if [ $status -ne 0 ]; then
  echo "[dev-debug] Failed with exit code $status."
  read -r -p "Press Enter to exit..."
  exit $status
fi
