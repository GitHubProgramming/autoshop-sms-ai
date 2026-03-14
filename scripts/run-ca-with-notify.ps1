# Launch Claude with permission bypass and send Telegram notification on exit.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/run-ca-with-notify.ps1
# Alias: ca  (set up in your PowerShell profile)

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoRoot

# Run Claude — pass through any extra arguments
claude --dangerously-skip-permissions @args
$exitCode = $LASTEXITCODE

# Build notification message
if ($exitCode -eq 0) {
    $task = "Claude session finished"
} else {
    $task = "Claude session exited with code $exitCode"
}

# Always notify on exit
& "$RepoRoot\scripts\notify-task-done.ps1" -Task $task

exit $exitCode
