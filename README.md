# CareGuard

A multi-agent AI system for workplace psychosocial case management. CareGuard orchestrates six specialised AI agents to triage, risk-assess, and compile advisory memos for HR teams handling sensitive employee wellbeing incidents.

## Architecture

```
CareGuard Frontend (React + Vite)
        │
        ▼
CareGuard Backend (Express / Node.js)
        │
        ├── Local LLM pipeline (AI/ML API → Qwen, DeepSeek, Llama, GPT-4o-mini)
        │
        └── Band SDK mode ──► Band.ai room (per case)
                                    │
                         ┌──────────┴──────────┐
                   Python agents (band-agents/agents.py)
                   6 agents running concurrently via WebSocket
```

**BAND_SDK_MODE=true** — when enabled, triggering a case review creates a dedicated Band.ai chat room, adds all six agents as participants, and posts the intake. The Python agents pick up the room and deliberate via @mentions in real time.

**BAND_SDK_MODE=false (default fallback)** — the local LLM pipeline runs the full multi-agent debate inline and returns results directly.

## Agents

| Agent | Role |
|---|---|
| 🎯 Triage Sentinel | Case intake, classification, urgency rating, handoff |
| ⚠️ Risk Analytics Engine | Psychosocial, legal, and retaliation risk vectors |
| 📜 Policy Guard | Duty of Care legislation, confidentiality, EAP obligations |
| 🌱 Core Navigator | Care pathways, EAP referrals, supervisor decoupling |
| ⚖️ Compliance Review Director | Challenges peers, compiles final human-review memo |
| 👔 HR Advisory | Converts memo into step-by-step RACI action plan |

## Stack

- **Frontend:** React 19, Tailwind CSS v4, Vite
- **Backend:** Express, TypeScript, MongoDB (Mongoose)
- **AI:** Anthropic Claude (Band SDK), OpenAI-compatible APIs (AI/ML API), Google Gemini
- **Band.ai SDK:** Python — `band-sdk[anthropic]`, runs all 6 agents concurrently via `asyncio.gather`
- **Deployment:** Vercel (serverless)

## Prerequisites

- Node.js 18+
- Python 3.11+ with `uv`
- MongoDB Atlas connection string
- API keys: Anthropic, AI/ML API, Band.ai Remote Agent keys

## Setup

### 1. Clone and install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in the required values:

```env
ANTHROPIC_API_KEY=sk-ant-...
AIML_API_KEY=...
MONGODB_URI=mongodb+srv://...

# Band.ai — Remote Agent credentials (one per agent)
BAND_AGENT_ID=...
BAND_API_KEY=band_a_...
BAND_RISK_AGENT_ID=...
BAND_RISK_API_KEY=band_a_...
# ... (see .env.example for full list)

BAND_SDK_MODE=true
BAND_REST_URL=https://app.band.ai
BAND_WS_URL=wss://app.band.ai/api/v1/socket/websocket
```

### 3. Start the Band SDK agents (Python)

```bash
cd band-agents
uv sync
uv run python agents.py
```

Keep this running. All 6 agents connect to Band.ai via WebSocket and listen for @mentions.

### 4. Start the web server

```bash
npm run dev
```

App runs at `http://localhost:3000`.

## Band.ai Agent Setup

Each agent must be created as a **Remote Agent** on [app.band.ai](https://app.band.ai/agents):

1. Create agent → set type to **Remote**
2. Copy the `agent_id` (UUID) and `api_key` (`band_a_...`) into `.env`
3. Also copy credentials into `band-agents/agent_config.yaml` (gitignored)

```yaml
# band-agents/agent_config.yaml
triage_sentinel:
  agent_id: "uuid"
  api_key: "band_a_..."
risk_analytics_engine:
  agent_id: "uuid"
  api_key: "band_a_..."
# ... (one entry per agent)
```

## How a Case Review Works

1. Submit a case through the CareGuard UI
2. Click **Trigger Review**
3. In BAND_SDK_MODE the backend:
   - Creates a new Band.ai room for the case
   - Adds all 6 agents as participants
   - Posts the redacted case as Triage Sentinel with @mentions
4. The Python SDK agents pick up the room and respond in sequence via @mentions
5. The Band.ai room URL opens automatically in the browser

## Development

```bash
npm run dev      # dev server with hot reload
npm run build    # production build
npm run lint     # TypeScript type check
```

## Deployment

Configured for Vercel via `vercel.json`. Set all `.env` variables as Vercel environment variables before deploying.

```bash
vercel --prod
```
