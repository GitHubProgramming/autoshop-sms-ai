param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$token = $env:TELEGRAM_BOT_TOKEN
$chatId = $env:TELEGRAM_CHAT_ID

# Load from .env if not in environment
if (-not $token -or -not $chatId) {
    $envFile = Join-Path $PSScriptRoot "..\.env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.+?)\s*$') {
                $key = $matches[1]
                $val = $matches[2]
                if ($key -eq 'TELEGRAM_BOT_TOKEN' -and -not $token) { $token = $val }
                if ($key -eq 'TELEGRAM_CHAT_ID' -and -not $chatId) { $chatId = $val }
            }
        }
    }
}

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
