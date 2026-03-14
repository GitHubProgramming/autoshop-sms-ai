param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$token = $null
$chatId = $null

# Always load from .env file first (prefer file over stale session env vars)
$envFile = Join-Path $PSScriptRoot "..\.env"
if (Test-Path $envFile) {
    Write-Host "[telegram] Loading from: $envFile"
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.+?)\s*$') {
            $key = $matches[1].Trim()
            $val = $matches[2].Trim()
            # Strip surrounding quotes (single or double)
            $val = $val -replace '^["'']|["'']$', ''
            if ($key -eq 'TELEGRAM_BOT_TOKEN') { $token = $val }
            if ($key -eq 'TELEGRAM_CHAT_ID') { $chatId = $val }
        }
    }
} else {
    Write-Host "[telegram] No .env file found at $envFile"
}

# Fall back to environment variables only if .env didn't provide values
if (-not $token) { $token = $env:TELEGRAM_BOT_TOKEN }
if (-not $chatId) { $chatId = $env:TELEGRAM_CHAT_ID }

# Diagnostics (never print full token)
if ($token) {
    $maskedToken = $token.Substring(0, [Math]::Min(10, $token.Length)) + "..."
    Write-Host "[telegram] Token found: $maskedToken"
} else {
    Write-Host "[telegram] Token: NOT FOUND"
}
Write-Host "[telegram] Chat ID found: $([bool]$chatId)"

if (-not $token -or -not $chatId) {
    Write-Host "[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping notification"
    exit 0
}

$uri = "https://api.telegram.org/bot$token/sendMessage"

try {
    Invoke-RestMethod -Uri $uri -Method Post -Body @{
        chat_id = $chatId
        text    = $Message
    } | Out-Null
    Write-Host "[telegram] Notification sent"
} catch {
    Write-Host "[telegram] Failed to send notification: $_"
    exit 0
}
