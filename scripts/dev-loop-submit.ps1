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
$API_BASE_URL = if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "http://localhost:3000" }
$INTERNAL_API_KEY = $env:INTERNAL_API_KEY
$WEBHOOK_PATH = "webhook/dev-loop-task"

# Build headers for internal API calls
$internalHeaders = @{ "Content-Type" = "application/json" }
if ($INTERNAL_API_KEY) { $internalHeaders["x-internal-key"] = $INTERNAL_API_KEY }

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

    # Register task in API for operator visibility
    try {
        Invoke-RestMethod -Uri "$API_BASE_URL/internal/dev-loop/task-submit" -Method POST -Headers $internalHeaders -Body $body | Out-Null
    } catch {
        Write-Host "Warning: Could not register task in API (non-fatal)" -ForegroundColor Yellow
    }

    $response = Invoke-RestMethod -Uri $url -Method POST -ContentType "application/json" -Body $body
    Write-Host "Task submitted successfully." -ForegroundColor Green
    Write-Host ""

    # Save execution result to API for operator dashboard
    try {
        $rp = if ($response.review_packet) { $response.review_packet } else { @{} }
        $resultPayload = @{
            task_id = if ($rp.task_id) { $rp.task_id } elseif ($response.task_id) { $response.task_id } else { "unknown" }
            status = if ($response.action -eq "ESCALATE") { "blocked" } elseif ($response.action -eq "RETRY") { "failed" } else { "done" }
            goal_match = $rp.goal_match
            risk_level = $rp.risk_level
            review_decision = if ($rp.recommended_decision) { $rp.recommended_decision } else { $response.action }
            operator_notes = if ($rp.operator_notes) { $rp.operator_notes } else { $response.message }
            branch = $rp.branch
            git_diff_summary = $rp.git_diff_summary
            retry_count = if ($rp.retry_count) { $rp.retry_count } else { 0 }
            execution_summary = if ($rp.operator_notes) { $rp.operator_notes } else { $response.message }
        } | ConvertTo-Json
        Invoke-RestMethod -Uri "$API_BASE_URL/internal/dev-loop/task-result" -Method POST -Headers $internalHeaders -Body $resultPayload | Out-Null
        Write-Host "Result saved to operator dashboard." -ForegroundColor Green
    } catch {
        Write-Host "Warning: Could not save result to API (non-fatal)" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Response:"
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error submitting task: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
