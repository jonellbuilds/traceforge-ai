# TraceForge AI

![CI](https://github.com/jonellbuilds/traceforge-ai/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933)

An industry-style **LLM observability and reliability platform** built as a portfolio project. TraceForge turns model-call telemetry into trace exploration, latency/cost analytics, provider/model comparisons, and deterministic anomaly signals.

## Architecture

```text
SDK / service
   │  Bearer tf_live_…
   ▼
POST /api/v1/traces  ── validation ──► Supabase RPC ingest_trace
                                         │
                                         ├─ SHA-256 API-key lookup
                                         ├─ per-key rate guard
                                         ├─ traces + spans
                                         ▼
                                  PostgreSQL + RLS
                                         │
                   ┌─────────────────────┴──────────────────────┐
                   ▼                                            ▼
          analytics / percentiles                    anomaly detector
                                                rolling median + MAD
```

## Features

- Premium dark developer-tool UI
- Synthetic demo dashboard with truthful labeling
- Trace Explorer with search/filter and trace detail
- Span timeline, raw JSON and metadata inspection
- p95 latency, request, token and cost analytics
- Provider/model comparison table
- Robust anomaly detection for latency, error rate, token growth and cost spikes
- Project-scoped API-key UX and ingestion example
- Supabase schema with RLS-first design
- Health endpoint: `GET /health`
- Ingestion endpoint: `POST /api/v1/traces`
- Zero runtime npm dependencies in this portable build

## Anomaly algorithm

The detector uses a rolling baseline and **median absolute deviation (MAD)**:

`robust_z = (observed - median(history)) / max(1.4826 * MAD(history), metric_floor)`

MAD is intentionally used instead of ordinary standard deviation because a few latency/cost outliers should not drag the baseline toward the exact incidents we want to detect. Practical-significance guards are layered on top of the z-score to avoid noisy alerts.

## Data model

The Supabase/Postgres migration includes:

- `profiles`
- `workspaces`
- `workspace_members`
- `projects`
- `api_keys`
- `traces`
- `spans`
- `anomalies`
- `daily_metrics`

Row-level security and workspace/project membership policies isolate tenant data.

## Run locally

Requirements: Node 22+

```bash
git clone https://github.com/jonellbuilds/traceforge-ai.git
cd traceforge-ai
cp .env.example .env
npm install
npm run dev
# open http://localhost:3000
```

The synthetic demo works without Supabase. Real ingestion requires:

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

Apply `supabase/migrations/001_traceforge.sql` to a Supabase project before using real ingestion.

## Trace ingestion

```bash
curl -X POST http://localhost:3000/api/v1/traces \
  -H "Authorization: Bearer $TRACEFORGE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider":"OpenAI",
    "model":"gpt-5-mini",
    "status":"success",
    "latency_ms":842,
    "input_tokens":921,
    "output_tokens":301,
    "cost_usd":0.0042
  }'
```

The production-style schema stores only a SHA-256 API-key hash and returns plaintext only at creation time.

## Security design

- RLS enabled on exposed user-facing tables
- Workspace/project membership controls row access
- API key plaintext is never persisted
- Privileged helper functions have explicit execution grants
- Ingestion validates hashed, non-revoked project keys
- No service-role secret is exposed to the browser
- Synthetic demo is isolated from production claims
- Secrets are excluded from git

## Tests and CI

```bash
npm test
node --check server.mjs
node --check public/app.js
```

GitHub Actions runs these checks on pushes to `main` and on pull requests.

## Repository structure

```text
.
├── .github/workflows/ci.yml
├── lib/
│   ├── anomaly.mjs
│   └── demo-data.mjs
├── public/
│   ├── modules/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── supabase/migrations/
│   └── 001_traceforge.sql
├── tests/
│   └── anomaly.test.mjs
├── server.mjs
└── package.json
```

## Roadmap

- Authenticated workspace onboarding
- OpenTelemetry-compatible ingestion adapter
- Background scheduled rollups
- Alert destinations such as email/Slack after real integrations are configured
- Configurable retention jobs
- Hosted production preview

## Demo-data policy

All numbers visible in the built-in demo are generated synthetic telemetry. The project does not claim real customers, production traffic, partnerships, or live incident data.

## License

MIT
