# Understanding the POC — Code, Engine, CLI, and Docs

This document answers three questions step by step:
1. What each file does, what the ingest data checks are, and how a use case reaches a conclusion.
2. How the CLI produces an answer after you pick a choice — and what "the engine" is.
3. What the two Word documents contain, so you can explain them in the demo.

---

## Question 1a — Which file is doing what

The program is a pipeline: **CSV files → SQLite database → insight engine → narrative → CLI**.
Each file owns exactly one part of that pipeline.

| File | Role (one sentence) |
|---|---|
| `schema.sql` | The data model: 8 tables that mirror the CSVs, 10 indexes, and 8 SQL views that encode the "how do tables join safely" rules once, so no TypeScript file ever re-invents a join. |
| `src/db.ts` | Opens the SQLite file (`logistics.db`) and applies `schema.sql`; every other file gets its database handle from here. |
| `src/logger.ts` | Tiny timestamped logger (`info/warn/error/debug`) used everywhere instead of bare `console.log`. |
| `src/errors.ts` | `PocError` — the common exception with a `code` (`INVALID_PARAM`, `NOT_FOUND`) so the CLI can show friendly messages instead of stack traces. |
| `src/ingest.ts` | Reads the 8 CSVs with a real CSV parser, converts text to proper types, inserts everything into SQLite, then runs the 17 data-quality checks (see 1b). |
| `src/insights/types.ts` | The TypeScript shapes of every answer ("evidence JSON"): outcome counts, failure reasons, corroboration entries, association lifts — each carrying an **evidence tier** label. |
| `src/insights/common.ts` | The shared calculation toolbox used by all use cases: outcome summary, failure-reason ranking, corroboration cross-checks, association lifts vs a baseline (minimum support n ≥ 30), feedback samples, standard caveats. |
| `src/insights/useCases.ts` | Use cases 1–5: each is one function that validates its parameters, defines a *population* and a *baseline* filter, and calls the toolbox. |
| `src/insights/onboardingRisk.ts` | Use case 6: the only *projection* — scales historical failure rates to a new client's volume and adds capacity context. |
| `src/narrative/templates.ts` | Deterministic renderer: turns the evidence JSON into the readable text answer (the output you see). Works with zero external services. |
| `src/narrative/openaiRenderer.ts` | Optional LLM renderer: sends the evidence JSON to OpenAI with strict rules ("use only these numbers"); returns `null` on any problem. |
| `src/narrative/render.ts` | The dispatcher: try OpenAI first, and on `null` fall back to the template — so answers never depend on the LLM. |
| `src/cli.ts` | The menu you interact with: prompts for parameters, calls the right engine function, prints the answer, and saves it to `outputs/`. |
| `scripts/recordSamples.ts` | Regenerates the curated outputs for all six use cases (`npm run record-samples`). |
| `tests/` | 36 Jest tests: a small hand-built in-memory database (`fixtures.ts`) with known numbers, so every calculation can be checked exactly (happy paths + error paths, LLM mocked). |

---

## Question 1b — What the ingest data checks are

`npm run ingest` does five steps (`src/ingest.ts`):

1. Delete the old `logistics.db` (fresh start every time).
2. Apply `schema.sql` (create tables, indexes, views).
3. For each CSV: parse it (the parser handles multi-line addresses inside quotes), and **coerce
   types** — empty strings become `NULL`, ids become integers, `amount` becomes a float.
4. Insert all rows inside one transaction per table (fast and atomic).
5. Run the **data-quality report**: 17 checks that prove the database is a faithful, analyzable
   copy of the CSVs. If any fails, the process exits with an error.

The 17 checks and why each exists:

| # | Check | Why it matters |
|---|---|---|
| 1–8 | Row counts: orders 10,000; clients 500; drivers 2,000; warehouses 50; fleet/warehouse/external/feedback logs 10,000 each | Proves nothing was lost or duplicated while parsing (the orders CSV has line breaks *inside* fields — a naive parser would miscount). |
| 9 | 0 orders with an unknown `client_id` | Every order must join to a client, or client analysis (UC2) would silently drop rows. |
| 10 | 0 fleet logs with unknown order/driver | Same, for fleet evidence. |
| 11 | 0 warehouse logs with unknown order/warehouse | Same, for warehouse attribution (UC3). |
| 12 | Exactly 2,004 orders have `status = 'Failed'` | The headline number every "why did X fail" answer is built on. |
| 13 | 0 failed orders missing `failure_reason` | Guarantees tier-1 "recorded cause" exists for 100% of failures. |
| 14 | Exactly 1,271 delivered orders are late (actual > promised) | Verifies the `v_order_outcome` view computes lateness correctly — "delay" is NOT visible in the status column alone. |
| 15–16 | 6,335 / 6,324 distinct orders have fleet / warehouse logs | Documents the ~63% coverage that every answer's caveat mentions. |
| 17 | Exactly 2,598 orders were handled by >1 warehouse | Proves why warehouse analysis must be *pair-level* (an order counts toward every warehouse that touched it). |

The expected numbers were measured **independently** (by profiling the raw CSVs with a separate
script before the code was written), so the checks are a genuine cross-verification, not circular.

---

## Question 1c — How a use case reaches a conclusion (UC1 traced end to end)

Everything runs on one SQL view: **`order_360`** — one row per order, joining the order to its
client and to *flags* summarizing its fleet, warehouse, external, and feedback records
(e.g. `had_congestion = 1` if ANY fleet log for that order says "Heavy congestion").
Flags are computed with `MAX(...)` per order, so an order with 6 log rows still counts once —
that is how join fan-out (double counting) is prevented.

Now trace **UC1: "Why were deliveries delayed in New Delhi on 2025-04-27?"**
(function `cityDelayAnalysis` in `src/insights/useCases.ts`):

**Step 1 — Validate parameters.** City must exist in the orders table; date must be `YYYY-MM-DD`.
Bad input throws a `PocError` that the CLI prints nicely.

**Step 2 — Define two filters.**
- *Population* = the orders under investigation:
  `city = 'New Delhi' AND date(promised_delivery_date) = '2025-04-27'` → "orders DUE that day". 
- *Baseline* = comparison group: `city = 'New Delhi'` (all dates). Every rate later is compared
  against this so "high" actually means "higher than normal for this city".

**Step 3 — Outcome summary** (one `SELECT ... SUM(...)` over `order_360`):
→ 16 orders due; 2 failed (12.5%), 5 late (31.3%), 1 on-time, 3 returned, 5 pending/in-transit.
"Delayed" therefore means the 2 + 5 = 7 failed-or-late orders.

**Step 4 — Recorded causes (tier 1).** `GROUP BY failure_reason` over the failed orders in the
population → Weather disruption: 1, Warehouse delay: 1. These come from the `failure_reason`
column — real recorded data, so causal wording ("failed due to") is allowed.

**Step 5 — Corroboration (tier 2).** For each recorded reason, count how many of those orders ALSO
have matching log evidence, using a fixed map (reason → flags):
- Weather disruption → `had_bad_weather` (rain/fog record): matched **1/1 = 100%** here.
- Warehouse delay → any warehouse delay note: matched **0/1 = 0%** here.
So the answer can say how strongly the operational logs back up the recorded reason.

**Step 6 — Association lifts (tier 3).** For each of 11 evidence flags: rate in the population vs
rate in the baseline; the difference is the *lift*. A flag is only reported if at least **30
orders** in the population have it (statistical honesty — 2 of 16 orders is noise, not a signal).
With only 16 orders due that day, nothing qualifies, and the answer honestly prints:
*"Associated conditions: none met the minimum support threshold (n >= 30)."*

**Step 7 — Feedback samples + caveats.** Up to 3 distinct customer feedback texts from
failed/late orders, then fixed caveats (63% coverage; association ≠ causation; time anchors).

**Step 8 — Evidence JSON → narrative.** Steps 3–7 produce one typed object (`CityDelayEvidence`).
`templates.ts` turns it into the text you saw. If an OpenAI key exists, the same object goes to
the LLM instead — but the LLM cannot add a single number that isn't already in the object.

Every other use case follows the same skeleton — only the population/baseline filters and a few
extra fields change (UC2 adds client/system rate context; UC3 uses pair-level warehouse
attribution + picking/dispatch timings; UC4 runs the block twice and diffs; UC5's population is
festival-flagged orders; UC6 replaces steps 3–6 with rate × volume projection + capacity queries).

---

## Question 2 — How the CLI works, and what "the engine" is

**"The engine"** = the six functions in `src/insights/` (`cityDelayAnalysis`,
`clientFailureAnalysis`, `warehouseFailureAnalysis`, `cityComparisonAnalysis`, `festivalAnalysis`,
`onboardingRiskAnalysis`) plus the toolbox in `common.ts` they share. The engine's only job:
turn (parameters + SQLite data) into an evidence JSON. It never talks to the user or to OpenAI.

What happens when you run `npm run cli` and pick a choice:

```
you type "1"            src/cli.ts: runUseCase(db, '1')
   │
   ▼
prompts: City? Date?    validated against real DB values (it even lists the known cities)
   │
   ▼
cityDelayAnalysis(db, 'New Delhi', '2025-04-27')     ← THE ENGINE (steps 1–7 above)
   │  returns evidence JSON (all numbers final here)
   ▼
renderNarrative(evidence)      src/narrative/render.ts
   │  ├─ OPENAI_API_KEY set?  → try LLM (strict grounding) → use its prose
   │  └─ no key / any error   → renderTemplate(evidence)   → deterministic text
   ▼
print "ANSWER (template)"  ← the label tells you which renderer produced it
   │
   ▼
save outputs/UC1_<timestamp>.json (evidence) + .txt (narrative), back to menu
```

Two implementation details worth knowing:
- Prompts use a small line-buffered helper (not plain readline) so the CLI also works when input
  is piped/scripted — that's how the curated outputs and demos stay reproducible.
- Errors from the engine (`PocError`) are caught per run: you get
  `[NOT_FOUND] Unknown city "Atlantis"...` and return to the menu; the app never crashes.

In your own run of UC2 (Saini LLC, Aug 1–7) the engine found 3 orders, 0 failed — and the answer
said exactly that ("no failed orders in this population") with the context line
*window 0.0% vs client all-time 21.4% vs system 20.0%*. That's the honesty design: no data,
no invented story.

---

## Question 3 — What the docs contain (for your demo explanation)

### `docs/Delivery-Root-Cause-Analysis-POC.docx` — the solution write-up
| Section | What it says / your talking point |
|---|---|
| 1. Solution overview | The pipeline diagram (CSV → SQLite → engine → narrative → CLI) and the core principle: *all numbers deterministic, LLM optional and can't invent facts*. |
| 2. Data landscape | The 8 datasets, their roles, the ER diagram — plus the structural fact that orders link to warehouses/drivers ONLY through log tables, and 2,598 orders span multiple warehouses → pair-level attribution ("orders involving X"). |
| 2b. Data-quality findings | The table of real problems found (timestamps incoherent, sentiment contradicts text, ~63% coverage, driver city ≠ order city) and the design response to each. This shows the analysis was evidence-driven, not assumed. |
| 3. Evidence tiers | The three-tier honesty model: recorded cause (causal language allowed) → corroboration ("backed by logs in N/M orders") → association ("co-occurred", n ≥ 30, never causal). |
| 4. Use-case logic | One row per use case: exactly which filter + aggregation answers it. |
| 5. Architecture options | Why SQLite + typed engine won over a pure in-memory pipeline and over an LLM-centric design (hallucination risk); the LLM survives only as a thin optional layer. |
| 6. Implementation & verification | Stack, the 17 ingest checks, 36 tests with an 85% coverage gate, run commands. |
| 7. Sample output | UC2 excerpt with the population → causes → corroboration → caveats structure. |
| 8. Limitations | NL question parsing deliberately out of scope; association ≠ causation; capacity units undefined in source data. |

### `docs/Sample-Use-Case-Outputs.docx` — the recorded results
The complete, unedited answers for all six assignment use cases, generated reproducibly by
`npm run record-samples` (same content as `outputs/curated/`). In the demo you can say:
*"every answer in this document can be regenerated with one command — the engine is deterministic."*

### Supporting files
- `README.md` — how to run (for whoever opens the GitHub repo).
- `plan.md` — the phase-by-phase build log with decisions and assumptions (shows process).
- `outputs/curated/UC*.json` — the evidence JSON behind each answer; open one in the demo to show
  the "numbers first, prose second" design.
