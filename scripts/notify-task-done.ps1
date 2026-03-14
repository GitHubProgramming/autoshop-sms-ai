# Call after completing a task. Pass task name as first argument.
param(
    [string]$Task = "Claude task completed"
)

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RepoName = Split-Path -Leaf $RepoRoot
$Branch = git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null
if (-not $Branch) { $Branch = "unknown" }
$Time = Get-Date -Format "yyyy-MM-dd HH:mm"

$Message = @"
✅ Claude finished task

Task: $Task
Repo: $RepoName
Branch: $Branch
Time: $Time
"@

& "$RepoRoot\scripts\send-telegram.ps1" -Message $Message
