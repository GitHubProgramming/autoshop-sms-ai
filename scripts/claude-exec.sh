#!/bin/bash
# claude-exec.sh — Real Claude Code execution adapter for the dev-loop
#
# Called by the n8n dev-loop-orchestrator workflow.
# Takes a prompt file, invokes Claude CLI in non-interactive mode,
# and outputs a valid ExecutionResultContract JSON to stdout.
#
# Usage:
#   ./scripts/claude-exec.sh <prompt-file> <task-id>
#
# Environment:
#   CLAUDE_EXEC_TIMEOUT  — max seconds for Claude execution (default: 300)
#   CLAUDE_EXEC_BUDGET   — max USD spend per task (default: 1.00)
#   REPO_ROOT            — repo root path (default: script's parent dir)
#
# Output: JSON conforming to ExecutionResultContract on stdout.
# All diagnostic messages go to stderr.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(dirname "$SCRIPT_DIR")}"

PROMPT_FILE="${1:-}"
TASK_ID="${2:-unknown}"
TIMEOUT="${CLAUDE_EXEC_TIMEOUT:-300}"
BUDGET="${CLAUDE_EXEC_BUDGET:-1.00}"

# ── Validate inputs ──────────────────────────────────────────────

if [ -z "$PROMPT_FILE" ]; then
  echo '{"task_id":"unknown","status":"failed","files_changed":[],"checks_run":[],"critical_files_touched":[],"summary":"No prompt file provided","open_issues":["claude-exec.sh called without prompt file argument"],"retry_recommended":false}'
  exit 0
fi

if [ ! -f "$PROMPT_FILE" ]; then
  echo "{\"task_id\":\"${TASK_ID}\",\"status\":\"failed\",\"files_changed\":[],\"checks_run\":[],\"critical_files_touched\":[],\"summary\":\"Prompt file not found: ${PROMPT_FILE}\",\"open_issues\":[\"Prompt file does not exist\"],\"retry_recommended\":false}"
  exit 0
fi

PROMPT_CONTENT=$(cat "$PROMPT_FILE")

>&2 echo "[claude-exec] Task: ${TASK_ID}"
>&2 echo "[claude-exec] Prompt file: ${PROMPT_FILE}"
>&2 echo "[claude-exec] Timeout: ${TIMEOUT}s, Budget: \$${BUDGET}"
>&2 echo "[claude-exec] Repo root: ${REPO_ROOT}"

# ── Execute Claude CLI ───────────────────────────────────────────

CLAUDE_OUTPUT=""
CLAUDE_EXIT=0

# Use --bare to skip hooks/side-effects, --print for non-interactive,
# --output-format json for structured output, scoped allowed tools.
# --permission-mode bypassPermissions allows non-interactive execution.
# The --max-budget-usd caps spend per invocation.
CLAUDE_OUTPUT=$(timeout "${TIMEOUT}" claude \
  --print \
  --output-format json \
  --bare \
  --max-budget-usd "$BUDGET" \
  --allowedTools "Read,Edit,Write,Bash,Glob,Grep" \
  --permission-mode bypassPermissions \
  --no-session-persistence \
  --model sonnet \
  -p "$PROMPT_CONTENT" \
  2>/dev/null) || CLAUDE_EXIT=$?

>&2 echo "[claude-exec] Claude exit code: ${CLAUDE_EXIT}"

# ── Parse Claude output into ExecutionResultContract ─────────────

if [ $CLAUDE_EXIT -ne 0 ] && [ -z "$CLAUDE_OUTPUT" ]; then
  # Total failure — Claude didn't produce output
  if [ $CLAUDE_EXIT -eq 124 ]; then
    FAIL_REASON="Claude execution timed out after ${TIMEOUT}s"
  else
    FAIL_REASON="Claude CLI exited with code ${CLAUDE_EXIT}"
  fi

  echo "{\"task_id\":\"${TASK_ID}\",\"status\":\"failed\",\"files_changed\":[],\"checks_run\":[],\"critical_files_touched\":[],\"summary\":\"${FAIL_REASON}\",\"open_issues\":[\"${FAIL_REASON}\"],\"retry_recommended\":true}"
  exit 0
fi

# Claude --output-format json returns a JSON object with a "result" field.
# Try to extract the execution result JSON from Claude's response.
# Strategy:
#   1. If Claude returned valid JSON with a "result" field, extract the text content
#   2. Look for ```json ... ``` block in that text (our prompt asks for this)
#   3. Try to parse the extracted JSON as ExecutionResultContract
#   4. Fall back to wrapping raw output as summary

# Write Claude output to temp file for Node to read (avoids /dev/stdin on Windows)
CLAUDE_TMP="${TMPDIR:-/tmp}/claude-output-${TASK_ID}.txt"
printf '%s' "$CLAUDE_OUTPUT" > "$CLAUDE_TMP"

# Write parser script to temp file (avoids quoting issues in node -e)
PARSER_TMP="${TMPDIR:-/tmp}/claude-parse-${TASK_ID}.js"
cat > "$PARSER_TMP" << 'PARSER_EOF'
const fs = require('fs');
const outputFile = process.argv[2];
const taskId = process.argv[3];

function makeResult(status, summary, issues, retry) {
  return JSON.stringify({
    task_id: taskId,
    status: status,
    files_changed: [],
    checks_run: [],
    critical_files_touched: [],
    summary: String(summary).substring(0, 2000),
    open_issues: issues,
    retry_recommended: retry
  });
}

try {
  const raw = fs.readFileSync(outputFile, 'utf8').trim();

  // Claude --output-format json wraps in {result: string, ...}
  let text = raw;
  try {
    const envelope = JSON.parse(raw);
    if (envelope.result) {
      text = envelope.result;
    }
  } catch(e) {
    // raw might be plain text, continue
  }

  // Look for ```json ... ``` block
  const jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[1]);
    if (parsed.task_id && parsed.status) {
      const result = {
        task_id: parsed.task_id || taskId,
        status: parsed.status || 'done',
        files_changed: Array.isArray(parsed.files_changed) ? parsed.files_changed : [],
        checks_run: Array.isArray(parsed.checks_run) ? parsed.checks_run : [],
        critical_files_touched: Array.isArray(parsed.critical_files_touched) ? parsed.critical_files_touched : [],
        summary: String(parsed.summary || ''),
        open_issues: Array.isArray(parsed.open_issues) ? parsed.open_issues : [],
        retry_recommended: Boolean(parsed.retry_recommended)
      };
      console.log(JSON.stringify(result));
      process.exit(0);
    }
  }

  // Try parsing the whole text as JSON directly (Claude may return raw JSON)
  try {
    const direct = JSON.parse(text);
    if (direct.task_id && direct.status) {
      const result = {
        task_id: direct.task_id || taskId,
        status: direct.status || 'done',
        files_changed: Array.isArray(direct.files_changed) ? direct.files_changed : [],
        checks_run: Array.isArray(direct.checks_run) ? direct.checks_run : [],
        critical_files_touched: Array.isArray(direct.critical_files_touched) ? direct.critical_files_touched : [],
        summary: String(direct.summary || ''),
        open_issues: Array.isArray(direct.open_issues) ? direct.open_issues : [],
        retry_recommended: Boolean(direct.retry_recommended)
      };
      console.log(JSON.stringify(result));
      process.exit(0);
    }
  } catch(e) {
    // not direct JSON, continue
  }

  // No valid JSON block found — wrap the raw text as a done result
  console.log(makeResult('done', text, ['Output did not contain structured ExecutionResultContract — raw text wrapped'], false));
} catch(e) {
  console.log(makeResult('failed', 'Failed to parse Claude output: ' + e.message, [e.message], true));
}
PARSER_EOF

PARSED_RESULT=$(node "$PARSER_TMP" "$CLAUDE_TMP" "$TASK_ID") || {
  # Node parsing itself failed
  rm -f "$CLAUDE_TMP" "$PARSER_TMP"
  echo "{\"task_id\":\"${TASK_ID}\",\"status\":\"failed\",\"files_changed\":[],\"checks_run\":[],\"critical_files_touched\":[],\"summary\":\"Failed to parse Claude output\",\"open_issues\":[\"Output parser error\"],\"retry_recommended\":true}"
  exit 0
}

# Clean up temp files
rm -f "$CLAUDE_TMP" "$PARSER_TMP"

echo "$PARSED_RESULT"
