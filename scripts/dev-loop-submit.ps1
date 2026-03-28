# Submit a task to the dev-loop orchestrator webhook (PowerShell)
#
# Usage:
#   .\scripts\dev-loop-submit.ps1 -TaskFile task.json
#   .\scripts\dev-loop-submit.ps1 -Example
#
# The task JSON must conform to the TaskContract schema.
# See docs/dev-loop-contracts.md for the full spec.

param(
    [Parameter(Position=0)]
    [string]$TaskFile,

    [switch]$Example
)

$ErrorActionPreference = "Stop"

$N8N_BASE_URL = if ($env:N8N_BASE_URL) { $env:N8N_BASE_URL } else { "http://localhost:5678" }
$WEBHOOK_PATH = "webhook/dev-loop-task"

if ($Example) {
    @'
{
  "task_id": "task-001",
  "title": "Add health check endpoint",
  "goal": "Create a /health endpoint that returns 200 OK with uptime",
  "scope_boundaries": ["Only touch the API server", "Do not modify auth"],
  "files_allowed": ["apps/api/src/routes/**", "apps/api/src/server.ts"],
  "files_forbidden": ["**/auth/**", "**/billing/**", "**/stripe/**"],
  "critical_systems_risk": false,
  "expected_output": ["New /health route file", "Route registered in server"],
  "checks_required": ["typecheck", "test"]
}
'@
    exit 0
}

if (-not $TaskFile) {
    Write-Host "Usage: .\scripts\dev-loop-submit.ps1 -TaskFile <task.json>"
    Write-Host "       .\scripts\dev-loop-submit.ps1 -Example"
    exit 1
}

if (-not (Test-Path $TaskFile)) {
    Write-Host "Error: File not found: $TaskFile" -ForegroundColor Red
    exit 1
}

# Validate JSON
try {
    $taskJson = Get-Content $TaskFile -Raw | ConvertFrom-Json
} catch {
    Write-Host "Error: Invalid JSON in $TaskFile" -ForegroundColor Red
    exit 1
}

$url = "$N8N_BASE_URL/$WEBHOOK_PATH"
Write-Host "Submitting task to dev-loop orchestrator..."
Write-Host "URL: $url"
Write-Host ""

try {
    $body = Get-Content $TaskFile -Raw
    $response = Invoke-RestMethod -Uri $url -Method POST -ContentType "application/json" -Body $body
    Write-Host "Task submitted successfully." -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:"
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error submitting task: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
