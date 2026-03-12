Get-Content ".env.local" | ForEach-Object {
    if ($_ -match '^\s*$') { return }
    if ($_ -match '^\s*#') { return }

    $parts = $_ -split '=', 2
    if ($parts.Length -eq 2) {
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        Set-Item -Path "Env:$name" -Value $value
    }
}

Write-Host "Environment variables loaded from .env.local"
