# Deploying Meridian on Railway (single service)

This guide runs the **entire local stack** in one Docker container on Railway — the cheapest practical layout for a demo / DevNet deployment.

## What runs inside the container

| Process | Internal port |
|---------|----------------|
| nginx (public edge) | `$PORT` (Railway injects this) |
| portal-api | 4000 |
| indexer × 6 | 4011–4014, 4015, 4016 |
| notifications (WebSocket) | 4020 |
| oracle-relay | 4021 |
| registry-api | 4022 |
| agent-runtime (optional) | 4025 |
| kyb-gateway | 8090 |
| party-provisioner | 8091 |

The React portal is built to static files and served by nginx. API calls go to `/api/*` (proxied to portal-api). Live ledger notifications use `wss://<your-domain>/events`.

## Cost: single vs separate services

| Approach | Railway billing | Best for |
|----------|-----------------|----------|
| **Single container (this guide)** | One service → one RAM/vCPU bill | Demo, DevNet, low traffic — **most cost-efficient** |
| **2–3 grouped services** (e.g. web+api / indexers / workers) | 2–3 bills, can right-size each | Staging when indexers need more RAM |
| **~12 separate services** | ~12 minimum footprints | Production at scale — **most expensive** for a demo |

Railway charges per service resource usage. Thirteen tiny Node processes each as its own service usually costs far more than one container running all of them, because every service has a baseline allocation.

**Recommendation:** start with the single-service Dockerfile in the repo root. Split later only if indexers or agent-runtime need isolated scaling.

## Prerequisites

1. Canton **DevNet** parties already allocated (`infra/manifests/parties.devnet.json` committed).
2. MUSD cash bootstrapped (`infra/manifests/cash.devnet.json` committed).
3. DARs uploaded to DevNet (`pnpm upload:dar:devnet`) — done once from your machine, not inside Railway.
4. Railway account + GitHub repo connected.

## Railway setup

### 1. Create project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → select `meridian`.
2. Railway detects `railway.toml` and builds from the root `Dockerfile`.

### 2. Attach a volume (important)

Indexers, KYB, and party-provisioner use SQLite under `/data`.

1. Service → **Volumes** → **Add Volume**
2. Mount path: `/data`

Without this, indexer state resets on every deploy.

### 3. Environment variables (complete list)

Copy into Railway → **Service → Variables**. Use **Raw Editor** for bulk paste.

#### Required (8 variables)

| Variable | Value |
|----------|-------|
| `DEVNET_LEDGER_API_URL` | `https://ledger-api.validator.devnet.sandbox.fivenorth.io` |
| `DEVNET_LEDGER_WS_URL` | `wss://ledger-api.validator.devnet.sandbox.fivenorth.io` |
| `DEVNET_AUTH_URL` | `https://auth.sandbox.fivenorth.io/application/o/token/` |
| `DEVNET_CLIENT_ID` | `validator-devnet-m2m` |
| `DEVNET_CLIENT_SECRET` | **Your secret** (from local `.env` / 5North) |
| `DEVNET_AUDIENCE` | `validator-devnet-m2m` |
| `DEVNET_SCOPE` | `daml_ledger_api` |
| `KYB_COMPLETE_SECRET` | **Long random string** (e.g. `openssl rand -hex 32`) |

#### Optional — AI agent (Financier desk)

| Variable | Default | Notes |
|----------|---------|-------|
| `GROQ_API_KEY` | *(unset)* | **Required** to enable agent-runtime; omit to disable |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model slug |
| `FINANCIER_PARTY_ORG_ID` | `meridian-financier-a` | Which financier persona the agent acts as |
| `AGENT_POLL_MS` | `0` | Background poll interval (0 = manual tick only) |
| `AGENT_ADVERSARIAL` | *(unset)* | Set `1` to stress-test mandate enforcement |

#### Optional — tuning (defaults work for demo)

| Variable | Default | Used by |
|----------|---------|---------|
| `MERIDIAN_INDEXER_POLL_MS` | `5000` | All indexers |
| `MERIDIAN_SOFR_REFERENCE_RATE` | `0.0366` | Indexer bid comparison |
| `MERIDIAN_ORACLE_MAX_AGE_MS` | `300000` | Indexer oracle freshness |
| `ORACLE_RELAY_POLL_MS` | `60000` | Oracle relay |
| `ORACLE_RELAY_CONFIG` | `infra/configs/oracle-relay.json` | Oracle relay |
| `ORACLE_FAULT` | *(unset)* | `stale` \| `outage` \| `deviation` (testing only) |
| `PARTIES_MANIFEST` | `infra/manifests/parties.devnet.json` | portal-api, notifications |

#### Do NOT set on Railway (single-container defaults)

| Variable | Why |
|----------|-----|
| `PORT` | Railway injects automatically — nginx listens on this |
| `PORTAL_API_PORT`, `NOTIFICATIONS_PORT`, etc. | Set in Dockerfile (`4000`, `4020`, …) |
| `SUPPLIER_INDEXER_URL`, `BUYER_INDEXER_URL`, … | Default `http://127.0.0.1:401x` — all processes share one container |
| `VITE_API_URL`, `VITE_NOTIFICATIONS_WS` | Baked at Docker build (`/api` + same-origin `/events`) |
| `DEVNET_VALIDATOR_URL`, `DEVNET_TAP_AMOUNT` | Only for `pnpm fund:devnet` on your laptop |

Railway sets `PORT` automatically — **never override it**.

### 4. Railway UI options (click-by-click)

When creating / configuring the service:

| Step | Setting | Choose |
|------|---------|--------|
| New project | Template | **Deploy from GitHub repo** |
| Service source | Repository | `meridian` (your fork/org) |
| Service source | Branch | `main` (or your deploy branch) |
| Build | Builder | **Dockerfile** (auto from `railway.toml`) |
| Build | Dockerfile path | `Dockerfile` (repo root) |
| Build | Root directory | `/` (repo root) |
| Deploy | Health check path | `/api/health` (from `railway.toml`) |
| Deploy | Health check timeout | `120` seconds (indexers need warm-up) |
| Resources | Memory | **1–2 GB** recommended (12 Node processes + SQLite) |
| Resources | CPU | Shared is fine for demo |
| Storage | Volume | **Add volume** → mount path `/data` |
| Networking | Public | **Generate Domain** (HTTPS automatic) |
| Networking | Port | Leave default — Railway maps to container `$PORT` |
| Variables | Sync | Paste required vars above; mark secrets as **secret** |

**Do not** choose: Nixpacks, separate services per process, or multiple public ports.

### 5. Deploy

Push to the connected branch or click **Deploy**. First boot may take 2–3 minutes (indexers replay from ledger offset).

Health check: `GET /api/health`

Public URL: Railway **Settings → Networking → Generate Domain**

## Local Docker test

```bash
# Build
docker build -t meridian .

# Run (copy secrets from .env)
docker run --rm -p 8080:8080 \
  -e DEVNET_CLIENT_SECRET="$DEVNET_CLIENT_SECRET" \
  -e DEVNET_LEDGER_API_URL="https://ledger-api.validator.devnet.sandbox.fivenorth.io" \
  -e DEVNET_LEDGER_WS_URL="wss://ledger-api.validator.devnet.sandbox.fivenorth.io" \
  -e DEVNET_AUTH_URL="https://auth.sandbox.fivenorth.io/application/o/token/" \
  -e DEVNET_CLIENT_ID="validator-devnet-m2m" \
  -e DEVNET_AUDIENCE="validator-devnet-m2m" \
  -e DEVNET_SCOPE="daml_ledger_api" \
  -e KYB_COMPLETE_SECRET="dev-kyb-secret" \
  -v meridian-data:/data \
  meridian
```

Open http://localhost:8080

## What Railway does *not* deploy

- **Daml packages** — upload DARs to DevNet from your laptop (`pnpm upload:dar:devnet`).
- **Party allocation** — already in `parties.devnet.json`; re-run `pnpm allocate:devnet` only for a fresh environment.
- **Canton Coin faucet** — fund parties with `pnpm fund:devnet` if needed.

## Pre-deploy checklist (run once on your laptop)

- [ ] `infra/manifests/parties.devnet.json` committed (8 personas with party IDs)
- [ ] `infra/manifests/cash.devnet.json` committed (`pnpm bootstrap:cash:devnet` if missing)
- [ ] DARs uploaded: `pnpm upload:dar:devnet`
- [ ] `DEVNET_CLIENT_SECRET` works locally (`pnpm smoke:devnet` or portal works locally)
- [ ] Git push includes `Dockerfile`, `docker/`, `railway.toml`

## Post-deploy verification

1. `curl https://<your-railway-domain>/api/health` → `{"ok":true}`
2. Open portal → each role page loads data (may take ~60s first time while indexers catch up)
3. Ops → Monitors shows oracle + settlement cards
4. Ops → Regulator Admin loads (needs platform + regulator indexers)
5. Optional: Financier → Agent tick works if `GROQ_API_KEY` set

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Ops → Regulator Admin `fetch failed` | Platform/regulator indexers still catching up — wait ~60s or check logs |
| Empty tables after deploy | Volume not mounted at `/data`; indexers rebuilding |
| Agent tick disabled | Set `GROQ_API_KEY` |
| 502 on first load | Health check may pass before all indexers are warm — retry |

## Splitting later (optional)

If you outgrow single-container:

1. **web** — nginx + static portal + portal-api (public)
2. **indexers** — six indexer processes + volume
3. **workers** — notifications, oracle-relay, registry-api, kyb, provisioner, agent

Use Railway private networking and set `SUPPLIER_INDEXER_URL`, `BUYER_INDEXER_URL`, etc. on portal-api to internal URLs.
