# ReceiptMatch

**Match expense receipts to card transactions, and check whether the receipt can be trusted.**

An employee uploads a photo of a receipt. ReceiptMatch reads it with AWS Textract, finds the card transaction it belongs to, and then **checks the receipt against what the card network recorded**: the merchant category, the exact authorization time, the merchant's city and the amount. A receipt can look perfect and still not match those details. ReceiptMatch surfaces each inconsistency as an explained risk signal, and a human always makes the final call.

## Run it locally

Requirements: Node 24 (`nvm use`), Docker. No AWS account needed: DynamoDB and S3 run in a local emulator, and Textract is replaced by recorded responses.

```bash
npm install
npm run local:up        # DynamoDB + S3 emulator (Floci) on port 4567
npm run local:setup     # create table and bucket, seed 4 employees and a week of card transactions
npm run dev:api         # API on http://localhost:4000 (serverless-offline)
npm run dev:web         # web app on http://localhost:5173 (in another terminal)
```

Then upload the demo receipts from [`fixtures/receipts/`](fixtures/receipts/README.md): the table there says which employee and payment type to use for each scenario. `npm run local:setup` resets everything.

With AWS credentials, `EXTRACTOR=textract npm run dev:api` reads receipts with real Textract while DynamoDB and S3 stay local.

```bash
npm test                  # domain, API and handler tests
npm run test:integration  # repository against the local DynamoDB (needs `npm run local:up`)
npm run typecheck
npm run lint              # architecture boundaries (eslint.config.js)
```

---

## The problem

Every corporate card charge needs a receipt, for tax compliance, audits and spend control. That creates two problems.

### 1. Matching receipts to charges is manual and error-prone
Card statements and receipts rarely agree exactly:

| Card statement | Receipt | Why a naive match fails |
|---|---|---|
| `REST DON JULIO PALERMO` · ARS 93.500 | *Don Julio* · $ 85.000 | The 10% tip was added to the card charge after the receipt was printed |
| `NOTION.SO` · ARS 72.485,50 (USD 49.99) | *Notion Labs, Inc.* · $49.99 | Foreign currency, and the receipt prints only "$": pesos or dollars? |
| `UBER *TRIP` and `CARREFOUR EXPRESS 0234`, both ARS 12.000, same evening | *Carrefour Express* · $ 12.000 | Two charges with the same amount on the same day |

### 2. Receipts can no longer be trusted at face value
Image generators now produce receipts that are convincing enough to fool human reviewers. AppZen, an AI expense-audit vendor, reports that AI-generated images went from 0% to 70.8% of the fake receipts it flagged between March 2025 and May 2026 ([AppZen](https://www.appzen.com/learn/receipt-fraud-the-four-types-and-how-finance-teams-detect-them)), and in an Emburse survey 34% of US and UK employees admitted creating a fake receipt with AI ([Emburse](https://www.emburse.com/blog/ai-generated-receipts-expense-fraud)). The older tricks still work too: the same receipt submitted twice, a total edited by hand, or a receipt from one place attached to a charge from another.

## The insight: the card transaction is a trusted anchor

Dedicated receipt-fraud tools (for example [SAP Concur Verify](https://www.concur.ca/resource-center/videos/smarter-expense-compliance-with-sap-concur) and [Veryfi](https://www.veryfi.com/the-vault/curious-case-of-the-fraudulent-receipt/)) mostly analyze **the image on its own**. A card issuer has something those tools don't: **network data for the actual charge**, which the employee did not write and cannot edit.

| From the card network (trusted) | From the receipt (an employee's claim) |
|---|---|
| Merchant category code (MCC), e.g. 5921 *liquor store* | Line items: "Milanesa napolitana, Empanadas x6" |
| Authorization time: 23:40 | Printed time: 13:05 |
| Merchant city: Córdoba | Printed address: Av. Santa Fe 1860, Recoleta, CABA |
| Amount: ARS 64.000 | Total: $ 64.000 |

A fake receipt can be pixel-perfect and still disagree with the anchor. ReceiptMatch uses that disagreement as its main signal. Image-level checks (duplicate detection, arithmetic consistency, metadata) are supporting signals.

For **out-of-pocket reimbursements** there is no card transaction to anchor against, so those receipts get stricter treatment.

## How it works

1. **Upload:** a receipt for a card charge, or for a personal-card reimbursement.
2. **Extract:** [AWS Textract `AnalyzeExpense`](https://docs.aws.amazon.com/textract/latest/dg/invoices-receipts.html) reads the merchant, date and time, address, total, tax and line items, with a confidence score for each field.
3. **Match** (card receipts): a deterministic, explainable scoring engine finds the transaction. It accounts for tips, foreign currencies, settlement delays and fuzzy merchant names, and the outcome is *suggested*, *needs review* or *no match*.
4. **Verify:** the system checks the receipt against the anchor transaction and against every other receipt in the company. Each finding is a risk signal with a plain-language explanation, and the receipt gets an overall risk level of *low*, *medium* or *high*.
5. **Decide:** a human confirms. A high-risk receipt can still be approved, but the reviewer must write down why, and that note goes into the audit log.

## Design principles

- **Signals, not verdicts.** The system never declares a receipt "fake". It shows what doesn't match and lets a person decide. A false accusation against an employee is a real cost.
- **Explainable over clever.** Every score and every signal shows its reasoning. Finance teams have to be able to audit the result and explain it to an employee.
- **Honest about limits.** An employee can see their own statement and copy the merchant name and amount. Anchor checks raise the bar for fraud. They don't make it impossible.
- **Money is never a float.** Amounts are integer minor units with an ISO 4217 currency code.
- **Runs without AWS.** A fixture-based extractor replays recorded Textract responses.

## Context: what Jeeves already does

Jeeves already uses AI to read receipts and match them to transactions ([tryjeeves.com](https://tryjeeves.com/)). It also uses AI to detect and block fraudulent card transactions ([descubre.vc](https://www.descubre.vc/noticia/jeeves-impulsa-ia-para-detectar-fraudes-en-tarjetas-corporativas-2025-07-02)). This project does not try to replace either. It explores a **complementary layer**: using issuer-side transaction data to verify the receipt itself, a check that only a card issuer is in a position to run.

## Scope

**In scope:** a single company with a seeded set of employees and card transactions, receipt upload, extraction, matching, anchor and image verification, reimbursement receipts, and confirmation with an audit trail.

**Out of scope (for now):** authentication, approval workflows, ERP integrations, ML-based image forensics, and learning from reviewer decisions. See [docs/SPEC.md](docs/SPEC.md).

## Tech stack

- **TypeScript** throughout, as an npm-workspaces monorepo
- **React Router (SPA) + Vite + Tailwind CSS** for the web app
- **Serverless Framework v3 + AWS Lambda + Middy** for the API
- **DynamoDB (single-table design)** via [@ftschopp/dynatable-core](https://github.com/ftschopp/dynatable)
- **S3** for receipt images, uploaded directly from the browser with presigned URLs
- **AWS Textract `AnalyzeExpense`** for extraction
- **jimp + exifr** for image hashing and metadata, **date-fns** for dates and time zones
- **Vitest** for tests, **Floci** (DynamoDB + S3 emulator) to run everything locally without an AWS account

## Documentation

- [docs/WRITEUP.md](docs/WRITEUP.md): one-page write-up (problem, approach, decisions, AI usage, next steps)
- [docs/SPEC.md](docs/SPEC.md): functional specification
- [docs/TECH_SPEC.md](docs/TECH_SPEC.md): technical specification
