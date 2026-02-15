#!/usr/bin/env bash
exec node "$(dirname "$0")/../server/dist/hook-session-start.js"
