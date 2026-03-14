param(
    [string]$Prompt
)

$headers = @{
  "x-bridge-token" = $env:BRIDGE_TOKEN
  "Content-Type" = "application/json"
}

$body = @{
  prompt = $Prompt
} | ConvertTo-Json

$res = Invoke-RestMethod `
  -Uri http://localhost:3030/ask-openai `
  -Method POST `
  -Headers $headers `
  -Body $body

$res.answer
