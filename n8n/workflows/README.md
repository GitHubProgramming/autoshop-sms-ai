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

The live n8n instance has **one project** ("AutoShop Production") with **folders inside it**:
- `n8n/workflows/TEST/` → folder **TEST** inside AutoShop Production
- `n8n/workflows/LT_Proteros/` → folder **LT_Proteros** inside AutoShop Production
- `n8n/workflows/US_AutoShop/` → folder **US_AutoShop** inside AutoShop Production

**How it works (two-step):**
1. **Project transfer** (public API): `PUT /api/v1/workflows/:id/transfer` moves the workflow into the "AutoShop Production" project
2. **Folder placement** (internal API): `PATCH /rest/workflows/:id` with `{ "parentFolderId": "..." }` places the workflow into the correct folder

The internal API (`/rest/`) is required because the public API (`/api/v1/`) does not support folder operations.

**Requirements:**
- The n8n project "AutoShop Production" must exist
- Folders (TEST, LT_Proteros, US_AutoShop) must exist inside that project
- GitHub Secrets needed:
  - `N8N_URL` — n8n instance URL
  - `N8N_API_KEY` — API key (for public API + may work for internal API)
  - `N8N_EMAIL` — n8n login email (fallback auth for internal API)
  - `N8N_PASSWORD` — n8n login password (fallback auth for internal API)

## Active Workflows (US_AutoShop)

| File | ID | Purpose |
|------|-----|---------|
| `wf001-twilio-sms-ingest.json` | `dhRnL4XBERa1Fmnm` | SMS ingest → tenant lookup → call WF-002 |
| `wf002-ai-worker.json` | `OfR92OEfwYdxxOb3` | OpenAI → booking detect → appointment → calendar |
| `wf003-close-conversation.json` | `wf003CloseConversation` | Close conversation status |
| `wf004-calendar-sync.json` | `wf004CalendarSync` | Google Calendar sync + SMS confirmation |
