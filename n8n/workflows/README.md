# n8n Workflows

GitHub is the single source of truth for all n8n workflows.

## Project Structure

| Folder | Purpose |
|--------|---------|
| `US_AutoShop/` | Production workflows for US AutoShop SMS AI |
| `LT_Proteros/` | Workflows for LT Proteros project |
| `TEST/` | Test and demo workflows |
| `_archive/` | Legacy/superseded workflow files (not deployed) |

## Deployment

Workflows deploy automatically to n8n when pushed to `main` (via GitHub Actions).

### Manual deploy

```bash
N8N_URL=http://localhost:5678 N8N_API_KEY=your-key bash scripts/n8n-deploy.sh
```

Deploy a single project:

```bash
N8N_URL=http://localhost:5678 N8N_API_KEY=your-key bash scripts/n8n-deploy.sh US_AutoShop
```

Dry run (see what would change):

```bash
DRY_RUN=true N8N_URL=http://localhost:5678 N8N_API_KEY=your-key bash scripts/n8n-deploy.sh
```

### Setup

1. In n8n, go to **Settings > API** and generate an API key
2. Add these GitHub repository secrets:
   - `N8N_URL` — your n8n instance URL
   - `N8N_API_KEY` — the generated API key

### Project/Folder Placement

The deploy script automatically places workflows into the correct n8n project:
- `n8n/workflows/TEST/` → n8n project named **TEST**
- `n8n/workflows/LT_Proteros/` → n8n project named **LT_Proteros**
- `n8n/workflows/US_AutoShop/` → n8n project named **US_AutoShop**

**How it works:** The script calls `GET /api/v1/projects` to discover project IDs by name, then after each workflow create/update it calls `PUT /api/v1/workflows/:id/transfer` to move the workflow into the matching project.

**Requirements:**
- The n8n projects must already exist (create them in the n8n UI first)
- Project names in n8n must match the folder names exactly (case-sensitive)
- The API key must belong to a user with `workflow:move` permissions

## Active Workflows (US_AutoShop)

| File | ID | Purpose |
|------|-----|---------|
| `wf001-twilio-sms-ingest.json` | `dhRnL4XBERa1Fmnm` | SMS ingest → tenant lookup → call WF-002 |
| `wf002-ai-worker.json` | `OfR92OEfwYdxxOb3` | OpenAI → booking detect → appointment → calendar |
| `wf003-close-conversation.json` | `wf003CloseConversation` | Close conversation status |
| `wf004-calendar-sync.json` | `wf004CalendarSync` | Google Calendar sync + SMS confirmation |
