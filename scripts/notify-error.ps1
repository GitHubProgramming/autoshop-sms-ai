# Call when an error occurs. Pass error description as first argument.
param(
    [string]$ErrorMsg = "unknown error"
)

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Branch = git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null
if (-not $Branch) { $Branch = "unknown" }
$Time = Get-Date -Format "yyyy-MM-dd HH:mm"

$Message = @"
❌ Claude error

Error: $ErrorMsg
Branch: $Branch
Time: $Time
"@

& "$RepoRoot\scripts\send-telegram.ps1" -Message $Message
