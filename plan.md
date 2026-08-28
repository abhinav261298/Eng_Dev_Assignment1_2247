# Delivery Root-Cause Analysis POC — Implementation Plan & Progress

Deterministic TypeScript + SQLite root-cause engine over the 8 provided CSVs, with an optional
OpenAI narrative layer (template fallback). CLI exposes the six predefined use cases with
validated parameters. Natural-language question parsing is a documented future enhancement.

## Architecture (approved)

```
sample-data-set/*.csv
        │  src/ingest.ts  (csv-parse, type coercion, DQ log)
        ▼
   logistics.db  (SQLite via better-sqlite3)
        │  schema.sql: 8 base tables + indexes + views
        │  (v_order_outcome, v_order_fleet, v_order_warehouse,
        │   v_order_external, v_order_feedback, order_360,
        │   v_order_warehouse_pairs, v_order_driver_pairs)
        ▼
 src/insights/*  (UC1–UC6: filter → aggregate → evidence JSON; all numbers computed here)
        ▼
 src/narrative/* (OpenAI renderer grounded in evidence JSON → template fallback)
        ▼
 src/cli.ts      (use-case menu, validated params, saves outputs)
```

Evidence hierarchy enforced in narratives:
1. Recorded cause — `orders.failure_reason` (causal language allowed; it is data).
2. Corroborating evidence — per-order log cross-checks ("corroborated by", with rates).
3. Association — baseline lifts ("associated with", min support n ≥ 30, baseline stated).

Key definitions: failure = `status='Failed'`; delay = delivered with `actual > promised`;
time filters anchor on `orders` dates only (aux-table timestamps are unreliable — see DQ notes).
Warehouse/driver attribution is pair-level ("orders involving X") because 2,598 orders span
more than one warehouse and 2,586 span more than one driver.

## Phase status

### Phase 1 — Scaffold, schema, ingestion  [DONE 2026-08-28]
- [x] npm project: TypeScript 5.9, better-sqlite3 12 (pinned — v13 has no Node 20 prebuilds),
      csv-parse, dotenv, tsx, Jest + ts-jest; tsconfig, jest.config, .gitignore, .env.example
- [x] schema.sql — 8 tables, 10 indexes, 8 views
- [x] src/ingest.ts — CSV → SQLite with type coercion + 17-check data-quality report
- [x] Validation: ALL 17 checks PASS — row counts (10,000 orders / 500 clients / 2,000 drivers /
      50 warehouses / 10,000 each aux), 0 orphan FKs, 2,004 failed (0 missing reason), 1,271 late,
      6,335/6,324 aux coverage, 2,598 multi-warehouse orders; order_360 stays at exactly
      10,000 rows (no join fan-out); outcome split reconciles (671 On-Time + 1,271 Late = 1,942 Delivered)

### Phase 2 — Deterministic engine + CLI + tests  [DONE 2026-08-28]
- [x] src/insights/types.ts — typed, tier-labeled evidence structures (LLM may not add facts)
- [x] src/insights/common.ts — shared population/baseline aggregation, corroboration map,
      association lifts with MIN_SUPPORT = 30, standard caveats
- [x] src/insights/useCases.ts (UC1–UC5) + onboardingRisk.ts (UC6, explicit projection)
- [x] src/narrative/templates.ts — deterministic renderer; render.ts dispatcher (LLM hook for Phase 3)
- [x] src/cli.ts — menu + validated params (dimension values listed from DB); every run saves
      evidence JSON + narrative TXT into outputs/
- [x] Jest: 30 tests pass (happy + error paths per use case); coverage 97.6% stmts / 85.3%
      branches / 98.7% funcs (>= 85% gate)
- Note: readline/promises drops piped lines between prompts → replaced with a line-buffered
      prompt helper so the CLI works both interactively and scripted (needed for demo recording)

### Phase 3 — OpenAI narrative layer  [DONE 2026-08-28]
- [x] src/narrative/openaiRenderer.ts — system prompt enforces: numbers ONLY from evidence JSON,
      tier language (causal only for recorded reasons, "associated with" for lifts), caveats
      reproduced, <= ~350 words; 20s timeout, temperature 0.2, model via OPENAI_MODEL (default gpt-4o-mini)
- [x] Graceful fallback verified: missing key / API error / empty response all return the
      deterministic template; CLI labels the answer source (openai vs template)
- [x] 6 new tests with an injected mock client (happy, API error, empty response, no key,
      fallback chain) — 36 tests total, coverage gates still green
- Note: live-key smoke test pending user's OPENAI_API_KEY in .env (never committed)

### Phase 4 — Outputs & documentation  [PENDING]
- [ ] Recorded sample outputs for all six use cases → outputs/
- [ ] Word document (write-up + diagram)

## Data-quality findings (from profiling; drive ingest/view design)
- Cross-table timestamps incoherent: 97% of warehouse/external/fleet timestamps are >3 days
  from the linked order_date → never used for time filtering.
- `created_at` unreliable (50% of orders have created_at after order_date) → ignored for analysis.
- Feedback sentiment/rating contradict text (e.g., Negative with rating 5) → only feedback_text used.
- Aux tables cover ~63% of orders, with up to 6–9 rows per order → per-order flag aggregation views.
- Driver city matches order city in only ~11% of fleet logs → driver geography not used as a dimension.

## Decisions & assumptions log
- 2026-08-28: better-sqlite3 pinned to ^12.4.1 (v13 lacks Node 20.19 prebuilds; no local C toolchain).
- 2026-08-28: TypeScript pinned to ^5.9 (ts-jest peer range excludes TS 7).
- CommonJS module setting for Jest/ts-jest simplicity.
