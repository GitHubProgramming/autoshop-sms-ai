param(
    [string]$Reason = "Claude requires approval"
)

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RepoName = Split-Path -Leaf $RepoRoot
$Branch = git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null
if (-not $Branch) { $Branch = "unknown" }
$Time = Get-Date -Format "yyyy-MM-dd HH:mm"

$Message = @"
⚠️ Claude needs approval

Reason: $Reason
Repo: $RepoName
Branch: $Branch
Time: $Time

Action required:
Open terminal and respond YES or NO.
"@

& "$RepoRoot\scripts\send-telegram.ps1" -Message $Message
