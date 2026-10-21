# ReceiptMatch: write-up

## The problem
Every corporate card charge needs a receipt, and receipts have stopped being trustworthy: AI-generated images went from 0% to 70.8% of the fake receipts AppZen flagged between March 2025 and May 2026 ([AppZen](https://www.appzen.com/learn/receipt-fraud-the-four-types-and-how-finance-teams-detect-them)). Jeeves already reads and matches receipts, so I asked what only a card issuer can do: **check the receipt against what the card network recorded**. An employee can copy the merchant, amount and date from their statement. They don't see the MCC, the exact authorization time or the terminal's city.

## Approach
Upload → AWS Textract `AnalyzeExpense` → match against the employee's card transactions → verify → a human decides, with every decision audited.
- **Matching:** amount as a hard gate (tips up to 25%, original currency for foreign charges), plus date and fuzzy merchant similarity. Outcomes: *suggested*, *needs review*, *no match*.
- **Verification:** 16 explained signals, rolled up into low/medium/high risk: category, time and city against the network; duplicates (file, perceptual hash, content, card *and* reimbursement); arithmetic; image metadata.
- **Stack:** a pure TypeScript domain with its boundaries enforced by ESLint; Serverless + Lambda + Middy; DynamoDB single-table design; S3 presigned uploads; React Router SPA. It runs offline with recorded real Textract responses. 170+ tests.

## Key decisions and trade-offs
- **Signals, not verdicts.** No labelled data for ML, and finance must be able to explain an alert. Approving a high-risk receipt requires a written note.
- **The card network resolves ambiguity.** `03/04/2026` and a bare `$` are ambiguous in Latin America; each reading is tried against the transactions. An inferred value never counts as evidence for itself.
- **The perceptual hash proposes; the totals confirm.** Different receipts landed 3–6 bits apart, so a near-identical image is a duplicate only if the totals agree. DynamoDB has no distance query, so the hash is split into 7 bands: ≤ 6 differing bits always leave one band identical, so exact-key lookups miss nothing.
- **Per-currency review thresholds instead of FX conversion:** explicit, auditable, no exchange-rate dependency.
- **Known limits:** anchor checks raise the bar but don't make fraud impossible; keyword classification misses creative item names; processing is synchronous and client-triggered.

## How I used AI tools
Claude Code was my pair: to research Jeeves and stress-test the idea (my first idea duplicated their product), to write the specs, and to implement in small tested commits. My rule: **tests and real data decide, not the model's confidence.** That caught wrong assumptions, mine and the AI's: Textract reported `USD` for every "$", even on peso tickets; the perceptual hash flagged different receipts as duplicates; a tip curve penalised a normal 15% tip. A final AI-assisted review found a race between simultaneous duplicate uploads, fixed with a conditional write and a test that reproduces it. Each fix went in with a test of the real case.

## What I'd do next
- **Async processing:** S3 event → SQS → worker, with retries and a dead-letter queue.
- **Hybrid line-item classifier:** an LLM only for items the keywords miss, never able to raise a strong alarm alone (receipt text is attacker-controlled).
- **Learn from reviewers:** use approve/reject decisions per signal to tune severities.
- **Richer issuer data:** Level 2/3 line items and terminal IDs would make anchor checks much stronger.
