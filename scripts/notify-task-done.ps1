# Call after completing a task. Pass task name as first argument.
param(
    [string]$Task = "unnamed task"
)

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Branch = git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null
if (-not $Branch) { $Branch = "unknown" }

if (-not $env:TELEGRAM_TOKEN) {
    Write-Host "[notify] TELEGRAM_TOKEN not set - skipping"
    exit 0
}

& "$RepoRoot\telegram.ps1" "Task complete: $Task - branch: $Branch"
