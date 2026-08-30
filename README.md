# Delivery Failure Root-Cause Analysis — POC

Lightweight local POC that aggregates fragmented logistics data (orders, fleet logs, warehouse
logs, external conditions, customer feedback), correlates events across them, and generates
human-readable, evidence-grounded explanations and recommendations for delivery failures and delays.

- Full write-up: `docs/Delivery-Root-Cause-Analysis-POC.docx`
- Recorded outputs for the six sample use cases: `docs/Sample-Use-Case-Outputs.docx` and `outputs/curated/`
- Implementation progress log: `plan.md`

## Architecture

```
sample-data-set/*.csv ──ingest──▶ logistics.db (SQLite: 8 tables + views incl. order_360)
                                        │
                       deterministic insight engine (UC1–UC6 → evidence JSON)
                                        │
                  OpenAI narrative (optional) ──fallback──▶ template narrative
                                        │
                                  CLI (use-case menu)
```

All numbers are computed deterministically in SQL/TypeScript. The optional LLM layer only rewrites
the evidence JSON into prose (strict no-invention prompt) and falls back to templates on any
failure — the six use cases never depend on LLM availability.

## Requirements

- Node.js 20+ (better-sqlite3 v12 prebuilds; no C toolchain needed)

## Run

```bash
npm install
npm run ingest          # builds logistics.db from sample-data-set/ + 17 data-quality checks
npm run cli             # interactive menu for the six use cases
npm run record-samples  # regenerates outputs/curated/ for all six use cases
npm test                # 36 tests, coverage gate 85%
```

Optional LLM narratives: `cp .env.example .env` and set `OPENAI_API_KEY` (never committed).
Without a key the CLI logs the fallback and uses the deterministic template renderer.

## The six use cases

1. Why were deliveries delayed in city X on a given day?
2. Why did Client X's orders fail in a date window?
3. Top failure reasons for orders involving a warehouse in a month (pair-level attribution)
4. Compare delivery failure causes between two cities in a month
5. Likely causes during the festival period & how to prepare
6. Projected risks of onboarding a client with ~20,000 extra monthly orders

Each answer reports three evidence tiers — recorded causes (`failure_reason`), corroborating log
evidence, and association lifts vs a stated baseline (support n ≥ 30) — plus explicit caveats.
