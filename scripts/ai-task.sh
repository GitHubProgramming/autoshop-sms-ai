#!/bin/bash

echo "AI Task System"

if [ ! -f AI_TASKS.md ]; then
  echo "AI_TASKS.md not found"
  exit 1
fi

echo "Next tasks:"
grep -n "OPEN\|DONE\|-" AI_TASKS.md || true

echo ""
echo "Select the first OPEN task and implement it."
