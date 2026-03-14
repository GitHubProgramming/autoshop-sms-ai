# Agent Bridge

Express server that proxies reasoning requests to OpenAI, authenticated with a shared token.

## Setup

```bash
cd tools/agent-bridge
npm install
```

## Required Environment Variables

Create a `.env` file in `tools/agent-bridge/` (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Your OpenAI API key |
| `BRIDGE_TOKEN` | Shared secret for `x-bridge-token` auth header |
| `BRIDGE_PORT` | Port to listen on (default: `3030`) |

## Start the Bridge

```bash
cd tools/agent-bridge
npm start
```

Expected output:

```
Agent bridge running on port 3030
```

## Test Health

```bash
curl http://localhost:3030/health
```

Expected response:

```json
{"ok":true,"service":"agent-bridge"}
```

## Example: Ask OpenAI

```powershell
powershell -ExecutionPolicy Bypass -File scripts/ask-openai.ps1 -Prompt "Explain this Fastify webhook bug"
```

Or with bash:

```bash
BRIDGE_TOKEN=your_secret ./scripts/ask-openai.sh "Explain this Fastify webhook bug"
```
