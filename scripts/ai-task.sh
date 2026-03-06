#!/bin/bash

echo "AI Task System"

if [ ! -f AI_TASKS.md ]; then
  echo "AI_TASKS.md not found"
  exit 1
fi

echo ""
echo "=== DONE tasks ==="
awk '/^## DONE/{found=1; next} /^## /{found=0} found && /^-/{print}' AI_TASKS.md

echo ""
echo "=== OPEN tasks ==="
awk '/^## OPEN/{found=1; next} /^## /{found=0} found && /^-/{print}' AI_TASKS.md

echo ""
echo "Select the first OPEN task and implement it."
echo "After completion, remember to update AI_STATUS.md."
