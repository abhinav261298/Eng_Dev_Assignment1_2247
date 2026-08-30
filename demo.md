# Demo Script — Delivery Root-Cause Analysis POC (8–10 minutes)

Live demo running use cases **1** and **6**, with architecture and engine explanation.

---

## Pre-demo checklist (do this BEFORE recording)

```bash
cd /home/abhinavkumar/Documents/todo/new-ai
npm install            # once
npm run ingest         # rebuild logistics.db — must end with "all data quality checks passed"
npm test               # optional sanity: 36 passed
```

- Increase terminal font size; use a clean full-screen terminal.
- Have these open in tabs (to show briefly): `schema.sql`, `outputs/curated/UC1.json`,
  `docs/Delivery-Root-Cause-Analysis-POC.docx`.
- No `.env` needed — the demo intentionally shows the deterministic template path.
  When the CLI logs `OPENAI_API_KEY not set — using template narrative`, that is **expected**:
  say it demonstrates the guaranteed fallback.

---

## 0:00–1:00 — The problem (talk over the assignment or title slide)

> "Logistics systems can tell you HOW MANY deliveries failed, but not WHY. The answer is
> scattered across five silos — order logs, fleet GPS notes, warehouse records, external
> conditions like weather and traffic, and customer complaints. Ops managers reconcile these
> manually. This POC aggregates all of them and answers 'why' questions automatically, with
> evidence-grounded, human-readable explanations."

---

## 1:00–2:30 — Architecture (show the diagram in README.md or the docx)

Walk the pipeline left to right:

> "Eight provided CSVs are ingested into a local SQLite database. The schema encodes the data
> model once — including a view called **order_360**: one row per order joined to flags that
> summarize its fleet, warehouse, external and feedback records. A deterministic TypeScript
> engine answers each of the six business questions by filtering and aggregating this view into
> an **evidence JSON** — every number is computed here, in SQL. A narrative layer turns that into
> readable text: optionally through OpenAI under strict 'use only these numbers' rules, and
> always with a deterministic template fallback. A small CLI exposes the six use cases."

Three design points to say explicitly:
1. **Honesty tiers** — "Recorded failure reasons get causal language; log evidence is
   'corroboration'; statistical patterns are only 'associated with', and only when at least 30
   orders support them. The system cannot overclaim."
2. **Pair-level attribution** — "2,598 orders were handled by more than one warehouse, so
   warehouse analysis counts an order toward every warehouse that touched it."
3. **LLM is optional** — "If the OpenAI key is missing or the API fails, the same evidence renders
   through templates. The six use cases never depend on the LLM."

---

## 2:30–3:30 — Show trustworthy ingestion

```bash
npm run ingest
```

Point at the output:

> "Ingestion re-validates itself with 17 data-quality checks — row counts, zero orphan foreign
> keys, exactly 2,004 failed orders all having a recorded failure reason, 1,271 late deliveries
> computed from promised vs actual dates, and the multi-warehouse count that forces pair-level
> attribution. These expected values were measured independently by profiling the raw CSVs."

---

## 3:30–5:30 — Live Use Case 1: "Why were deliveries delayed in New Delhi on 2025-04-27?"

```bash
npm run cli
```

Type exactly:
```
Choice: 1
City: New Delhi
Date (YYYY-MM-DD) [2025-08-14]: 2025-04-27
```

Expected on screen (walk through it top to bottom):

| Output section | What to say |
|---|---|
| `Population: … 16 orders` | "16 orders were due in New Delhi that day — that's the investigation scope." |
| `Outcomes: 2 failed (12.5%), 5 delivered late (31.3%) …` | "'Delayed' means failed OR delivered after the promised date — 7 of 16. Lateness is computed by comparing actual vs promised timestamps, not from a status flag." |
| `Recorded causes: Weather disruption 1, Warehouse delay 1` | "Tier-1 evidence: the failure reasons actually recorded on those orders. Causal language is allowed only here." |
| `Corroborating … Weather disruption … 1/1 (100.0%)` | "The engine cross-checks each reason against the logs: the weather failure has a matching rain/fog record — 100% corroborated. The warehouse-delay failure has no matching note — 0% — and the system says so instead of hiding it." |
| `Associated conditions: none met the minimum support threshold (n >= 30)` | "With only 16 orders, no statistical pattern is trustworthy — so the engine refuses to report one. This is the honesty guardrail in action." |
| Feedback samples + Caveats | "Customer voice is attached, and every answer ends with explicit caveats — coverage, association-vs-causation, timestamp reliability." |
| `saved output …json/…txt` | "Every answer is saved as evidence JSON plus narrative text." |

Optional 15 seconds: open `outputs/curated/UC1.json` — "this is the evidence JSON; the narrative
is just a rendering of it — numbers first, prose second."

---

## 5:30–7:30 — Live Use Case 6: "What if we onboard a client with ~20,000 extra monthly orders?"

Still in the CLI:
```
Choice: 6
Extra monthly orders [20000]:          ← press Enter (accepts default)
Target cities (comma-separated, empty = all) []: Mumbai, Pune
```

Expected on screen:

| Output section | What to say |
|---|---|
| `PROJECTED RISKS … ~20000 EXTRA MONTHLY ORDERS` | "This is the one forward-looking use case — clearly labeled a projection, because the new client has no history." |
| `…failure rate of 20.0% and late rate of 12.7% → ~4008 failed and ~2542 late per month` | "The math is transparent: historical system rates × new volume. 20% of 20,000 is ~4,008 expected failures a month — that's the revenue-leakage conversation." |
| Projected breakdown (Stockout ~850, Warehouse delay ~844, …) | "Broken down by historical failure reason, so you know WHERE the risk concentrates." |
| Capacity context (Mumbai ~75 orders/month today, 58 active drivers…) | "It grounds the risk: Mumbai currently handles ~75 orders a month — 20,000 would be a completely different scale, so driver and warehouse capacity become the binding constraints." |
| Largest current clients comparison | "Today's biggest client does 35 orders total — evidence that this onboarding has no precedent in the data." |
| Mitigations + PROJECTION caveat | "Recommendations map to the top projected reasons — inventory commitments, staged ramp-up, address validation — and the caveat repeats that this is a projection, not a measurement." |

Then quit:
```
Choice: q
```

---

## 7:30–9:00 — Reliability story (talk, optionally run `npm test`)

> "Three things make this trustworthy rather than a demo trick:
> 1. **Determinism** — run it twice, get identical numbers; the curated outputs in the repo
>    regenerate with one command (`npm run record-samples`).
> 2. **Tests** — 36 Jest tests validate every calculation against a hand-built fixture database
>    with known answers, including error paths, with an 85% coverage gate.
> 3. **Guardrails** — the n ≥ 30 support threshold, the three evidence tiers, and caveats on
>    every answer. Even the optional LLM layer receives only the computed evidence JSON and is
>    forbidden from adding numbers — and any LLM failure falls back to the template you just saw,
>    which is why the missing API key never blocked the demo."

---

## 9:00–10:00 — Limitations & close

> "Deliberate scope limits: natural-language question parsing is a future enhancement — today the
> six business questions are a validated menu, which keeps the demo deterministic. Association
> analysis reports co-occurrence, not proven causation — with production data (coherent
> timestamps, richer factors) this could grow into real causal modeling. And the same engine
> could feed a dashboard or a chat interface, because the evidence JSON is already
> machine-readable.
>
> Summary: fragmented data in, one SQLite model, a deterministic evidence engine, honest
> narratives out — answering 'why did deliveries fail' in seconds instead of a manual
> investigation."

---

## Quick recovery notes (if something goes wrong live)

| Problem | Fix |
|---|---|
| `logistics.db not found` | Run `npm run ingest` first. |
| Typo in city name | The CLI prints `[NOT_FOUND] Unknown city …` with the valid list and returns to the menu — you can even show this on purpose as input validation. |
| Wrong menu choice | It prints "Unknown choice" and re-shows the menu. |
| Need fresh outputs folder | Old runs are just files in `outputs/` — safe to ignore or delete. |
