# ReceiptMatch: Technical Specification

Status: **v1.0, implemented.** This document describes the code as built. The functional spec is in [SPEC.md](SPEC.md).

## 1. Guiding constraints

1. **The core logic is pure and portable.** Matching and verification are the product. They don't depend on Lambda, DynamoDB, S3 or React.
2. **Serverless on AWS**, the way a real feature would ship: API Gateway + Lambda + DynamoDB + S3 + Textract.
3. **A reviewer can run it locally without an AWS account.** One `docker compose up` (the Floci AWS emulator) plus npm scripts. Textract is replaced by recorded fixtures in that mode.
4. **Boring and well-known over novel.** Every choice should be easy to explain in the follow-up call.

## 2. Stack

| Layer | Choice | Version | Why | Alternatives considered |
|---|---|---|---|---|
| Runtime | **Node.js 24** | `.nvmrc` = 24, Lambda `nodejs24.x` | Current LTS, same major version locally and on Lambda. Works with Serverless v3 (verified, see §9.1) | Node 22 |
| Language | **TypeScript** (strict) | 6.0 | Types shared across web, API and domain. One version, at the root | TS 7 (native): faster, but has no JavaScript API yet, so typescript-eslint and other tools can't use it |
| Monorepo | **npm workspaces**: `api` and `web` | — | Zero extra tooling | Turborepo, pnpm (not needed with 2 packages) |
| Frontend | **React Router, SPA mode** (`ssr: false`) on **Vite** | 8.x | Client-side loaders and actions for data flows. Builds to static files | Next.js (SSR is not needed with a separate API) |
| Styling | **Tailwind CSS** | 4.x | Fast to iterate | — |
| API framework | **Serverless Framework v3** | 3.40.0 (latest v3) | Mature, simple YAML, `serverless-offline` for local runs | v4 (licensing model), SAM, CDK, SST |
| Bundling | **serverless-esbuild** | — | Fast TypeScript bundling for each function | Webpack |
| Lambda middleware | **Middy** | 7.x | Composable middlewares for body parsing, validation and error mapping (CORS is API Gateway's, §4.3) | Hand-rolled wrappers |
| Validation | **Zod** | 4.x | Request schemas in `api/src/http/contract.ts`; env parsing | Middy's JSON Schema validator (would duplicate the types) |
| Database | **DynamoDB, single-table design** | — | Serverless-native, pay-per-request. SQLite doesn't fit Lambda's ephemeral filesystem | Aurora Serverless (overkill) |
| DynamoDB library | **@ftschopp/dynatable-core** | 2.4.x | Typed single-table schema, GSI resolution, transactions, Zod validation | ElectroDB, dynamodb-toolbox, raw `lib-dynamodb` |
| File storage | **S3** + presigned URLs | AWS SDK v3 | Uploads go directly from the browser to S3, bypassing Lambda's ~6 MB payload limit | Base64 through API Gateway (doesn't fit 5 MB images) |
| Extraction | **AWS Textract `AnalyzeExpense`** | SDK v3 | Built for receipts. Typed fields with confidence | An LLM vision model (see SPEC §8.4) |
| Image hashing | **jimp** | 1.x | Pure JS, so no Linux native binaries to package for Lambda | sharp (faster, but native packaging is a pain on Lambda) |
| Image metadata | **exifr** | 7.x | Pure JS EXIF reader | — |
| Dates and time zones | **date-fns** + **@date-fns/tz** | 4.x | Parsing, windows, and IANA time zone conversion for `TIME_MISMATCH` | Luxon |
| String similarity | **In-house** Jaro-Winkler + token-set ratio | — | About 40 lines, explainable | `string-similarity` |
| Testing | **Vitest** | — | Fast, TypeScript and ESM native | Jest |
| Local AWS | **Floci** (Docker): DynamoDB + S3 | 2.2.0 | MIT-licensed, one container for both services, no account needed | LocalStack (newer images may need an account token), DynamoDB Local + MinIO (MinIO images are no longer on Docker Hub) |
| Lint | **ESLint 9** + **typescript-eslint** | 9.39 / 8.72 | Enforces the architecture boundaries (§3) | oxlint |

## 3. Repository layout

```
receipt-match/
├─ docs/                        SPEC.md, TECH_SPEC.md, WRITEUP.md
├─ docker-compose.yml           Floci (dynamodb, s3) on port 4567
├─ fixtures/receipts/           sample images + <sha256>.textract.json
├─ packages/
│  ├─ api/
│  │  ├─ serverless.yml
│  │  ├─ src/
│  │  │  ├─ domain/             ← PURE: no AWS, no I/O, no framework
│  │  │  │  ├─ money.ts · dates.ts · text.ts · types.ts
│  │  │  │  ├─ matching/        candidates, scoring, outcome, "$" currency resolution
│  │  │  │  ├─ verification/    checks/ (one file per check) · classify · mcc · cities · fingerprint (dHash bands) · risk
│  │  │  │  └─ receipts/        entities · errors · workflow (newReceipt, startProcessing, resolveDate, matchCardReceipt, verify, decideReceipt…)
│  │  │  ├─ functions/          entry points, grouped like the REST routes (1 folder = 1 Lambda)
│  │  │  │  ├─ receipts/
│  │  │  │  │  ├─ create/ · process/ · get/ · list/ · set-anchor/ · decide/
│  │  │  │  │  │    ├─ handler.ts   the logic: (deps: functions) => (validated input) => { statusCode, body }
│  │  │  │  │  │    └─ lambda.ts    creates the clients, builds the Middy chain, injects concrete functions
│  │  │  │  │  └─ view.ts         the response every receipt endpoint returns
│  │  │  │  ├─ transactions/list/
│  │  │  │  └─ employees/list/
│  │  │  ├─ http/
│  │  │  │  ├─ contract.ts      the HTTP contract: request schemas (Zod), response shapes, error codes
│  │  │  │  ├─ middleware.ts    validateInput (Zod) · jsonResponse · errorResponse
│  │  │  │  └─ responses.ts     HttpResult · ok · created
│  │  │  ├─ dynamo/             client.ts · table.ts (dynatable schema) · items.ts · employees.ts · transactions.ts · receipts.ts
│  │  │  ├─ s3/                 client.ts · receipt-files.ts (getImage, saveRawExtraction, uploadUrl, viewUrl)
│  │  │  ├─ receipt-reading/    textract-client.ts · extract.ts (Textract or fixtures, by EXTRACTOR) · textract-mapper.ts · image.ts (dHash + EXIF)
│  │  │  └─ config.ts           env parsed with Zod
│  │  ├─ seed/demo-company.ts   the demo company: employees and a week of card transactions
│  │  └─ scripts/               local-setup · make-demo-receipts · record-fixtures
│  └─ web/                      React Router SPA + Tailwind; app/lib/api-types.ts mirrors the HTTP contract
└─ package.json                 workspaces + root scripts
```

**Two packages, one direction.** `api` holds the domain and everything server-side; `web` is a client that talks to it over HTTP and holds its own copy of the response types (`app/lib/api-types.ts`). There is no shared package: the web computes nothing that belongs to the domain. Display data it needs (line-item categories, what a merchant category sells, the MCC label) comes ready in the API responses (`ReceiptResponse.insights`, `TransactionListItem.merchantType`). Trade-off: the two type definitions can drift without the compiler noticing; `http/contract.ts` is the source of truth.

`npm run lint` enforces the boundaries (`eslint.config.js`, `no-restricted-imports`):

| Where | Can't import |
|---|---|
| `api/src/domain` | AWS SDK, dynatable, Middy, React, Zod, `node:*`/`fs`/`path`, the API's env `config`, or any other API folder (`dynamo`, `s3`, `receipt-reading`, `http`, `functions`) |
| `api/src/functions/**/handler.ts` | AWS SDK, Middy, `dynamo/*`, `s3/*`, `receipt-reading/*`, `config`, `http/middleware`: handlers get their I/O injected by `lambda.ts` |
| `web/app` | AWS SDK, Middy, Zod, or any code from the `api` package |

**Function injection, no container.** No classes, no repository interfaces, no adapter layer:
- `dynamo/*`, `s3/receipt-files` and `receipt-reading/*` are modules of plain functions that take their client or table as the first argument (`receipts.get(table, id)`, `s3.getImage(s3Client, bucket, id)`). Each service folder also owns its client factory (`dynamo/client.ts`, `s3/client.ts`, `receipt-reading/textract-client.ts`).
- Each handler declares the functions it needs as a type (`ProcessReceiptDeps = { getReceipt, transitionReceipt, getImage, extract, … }`) and composes the domain's workflow steps with them.
- Each `lambda.ts` creates only the clients it uses, at module load (the cold start, reused while warm), and injects concrete functions: `getReceipt: (id) => receipts.get(table, id)`.
- Tests inject in-memory functions with the same signatures (`test/memory.ts`), so the whole workflow runs in milliseconds without Docker.
- The domain stays pure: the few async workflow steps receive the one lookup they need as an argument (`verify(receipt, anchor, findReceiptsByFingerprints)`).

## 4. API

### 4.1 Endpoints (API Gateway HTTP API → one Lambda per route)

| Method | Path | Purpose |
|---|---|---|
| GET | `/employees` | list employees |
| GET | `/transactions?filter=attention` | list transactions with receipt status and risk |
| POST | `/receipts` | `{ employeeId, kind, mimeType, size }` → creates the receipt (`status: uploading`) and returns `{ receipt, upload: { url, headers, expiresInSeconds } }` (S3 presigned PUT) |
| POST | `/receipts/{id}/process` | after the upload: claim → fetch from S3 → hash → extract → match → verify → persist. `409` if already processed, `503` if the extractor is unavailable |
| GET | `/receipts` | all receipts, newest first: the review queue (reimbursements have no transaction to show them on) |
| GET | `/receipts/{id}` | receipt + match + signals + anchor transaction + a presigned image GET URL |
| POST | `/receipts/{id}/anchor` | `{ transactionId }` → re-verify against the chosen transaction |
| POST | `/receipts/{id}/decision` | `{ decision, note? }` |

### 4.2 Upload flow
```
web ── POST /receipts ──────────────► api: validate, create Receipt(status=uploading), presign PUT
web ── PUT <uploadUrl> (image) ─────► S3  (direct, no Lambda)
web ── POST /receipts/{id}/process ─► api: GetObject → jimp/exifr
                                          → claim (uploading → processing) + image fingerprints
                                          → Textract(Bytes) → match → verify
                                          → save (processing → pending_review) + content fingerprint
web ◄─ receipt with match and signals
```
`/process` is synchronous. Textract's synchronous API takes about 1–3 s, well within API Gateway's 29 s timeout. An S3-event-driven async pipeline is a next step for bulk uploads.

A conditional write claims the receipt (`uploading → processing`), so a second concurrent call gets `409 INVALID_STATE`. If Textract rejects the document, the receipt is kept as unreadable. If the extractor itself fails (throttling, network), the receipt goes back to `uploading` and the API answers `503 EXTRACTION_UNAVAILABLE`; the web app retries without uploading the file again.

Textract receives the image **as bytes**, not as an `S3Object` reference. Local mode uses the emulator's S3, which real Textract can't read, so bytes keep both modes on the same code path.

### 4.3 One folder per Lambda: `lambda.ts` + `handler.ts`

```ts
// functions/receipts/decide/handler.ts: logic only, no Middy, no API Gateway types
export const decide = (deps: DecideDeps) => async ({ params, body }) => {
  const receipt = found(await deps.getReceipt(params.id), 'Receipt', params.id);
  const decided = decideReceipt(receipt, body, deps.now());          // pure domain rule
  await deps.recordDecision(decided.receipt, decided.decision);       // injected I/O
  return ok(await receiptView(deps, receipt.id));
};

// functions/receipts/decide/lambda.ts: the Middy chain, and dependency injection
export const createLambda = (deps: DecideDeps) =>
  middy<HttpEvent<InputOf<typeof schemas>>>()
    .use(httpHeaderNormalizer())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(validateInput(schemas))
    .use(jsonResponse())
    .use(errorResponse())
    .handler((event) => decide(deps)(event.input));

const config = parseConfig(process.env);
const table = dynamoTable(config);

export const handler = createLambda({                                  // serverless.yml: functions/receipts/decide/lambda.handler
  ...receiptViewDeps(table, s3Client(config), config.UPLOADS_BUCKET),
  recordDecision: (receipt, decision) => receipts.recordDecision(table, receipt, decision),
  now: () => new Date(),
});
```

The Middy stack:
1. `@middy/http-header-normalizer`
2. `@middy/http-json-body-parser`, only on endpoints that take a body (it rejects bodyless requests with a JSON content type)
3. **`validateInput`**: parses body, path and query parameters with the Zod schemas from `http/contract.ts` into `event.input` → 400 `VALIDATION_ERROR` with the Zod error tree
4. **`jsonResponse`**: serializes the handler's `{ statusCode, body }` as a JSON API Gateway response
5. **`errorResponse`**: domain error codes → HTTP statuses, `{ error: { code, message } }`; anything unexpected is logged and returned as 500 `INTERNAL_ERROR`

CORS is handled by API Gateway (`httpApi.cors`), not by Middy: two layers adding `Access-Control-Allow-Origin` would send the header twice, which browsers reject.

### 4.4 Functions and IAM
- One IAM role for the service, scoped to its own table and indexes, the uploads bucket's objects, and the single `textract:AnalyzeExpense` action. Per-function roles would need an extra plugin; listed as a next step.
- Architecture is `arm64`, with 512 MB of memory (1024 MB for `/process`, since jimp decodes images in JS).
- The uploads bucket has CORS for the web origin, blocks public access, and expires objects after 30 days in the dev stage.

## 5. Data model (single table, dynatable)

Table `receipt-match-${stage}`, with primary key `PK`/`SK` and two GSIs: `GSI1PK/GSI1SK` and `GSI2PK/GSI2SK`. Billing is `PAY_PER_REQUEST`.

### 5.1 Entities and keys

| Entity | PK | SK | GSI1 | GSI2 |
|---|---|---|---|---|
| Employee | `EMP#${employeeId}` | `PROFILE` | — | `EMPLOYEES` / `EMP#${name}` |
| Transaction | `TX#${txId}` | `TX` | `EMP#${employeeId}#TX` / `${authorizedAt}` | `TXS` / `${authorizedAt}` |
| Receipt | `RCPT#${receiptId}` | `RCPT` | `EMP#${employeeId}#RCPT` / `${uploadedAt}` | `RCPTS` / `${uploadedAt}` |
| Decision (audit) | `RCPT#${receiptId}` | `DECISION#${decidedAt}` | — | — |
| Fingerprint | `FP#${kind}#${value}` | `RCPT#${receiptId}` | — | — |

### 5.2 Access patterns

| # | Pattern | How |
|---|---|---|
| AP1 | List transactions, newest first | GSI2 `TXS`, descending |
| AP2 | Candidate transactions for an employee in a date window | GSI1 `EMP#id#TX`, `between(from, to)` |
| AP3 | Get a receipt, a transaction or an employee by ID | primary key `get` |
| AP4 | Receipt + its decision history | both live in partition `RCPT#id`: `get` the receipt (SK `RCPT`), query SK `begins_with DECISION#` |
| AP5 | Find receipts sharing a fingerprint | query `PK = FP#kind#value` → receipt IDs → batchGet, all strongly consistent (§5.3) |
| AP7 | List receipts, newest first | GSI2 `RCPTS`, descending |
| AP6 | List employees | GSI2 `EMPLOYEES` |

The single-partition GSI2 keys (`TXS`, `RCPTS`) are hot partitions. That is fine for one demo company. In production the key would be `COMPANY#id#TXS`, with time bucketing for large tenants. It's documented as a known simplification.

Only the link is denormalized: approving a card receipt writes `receiptId` onto the Transaction item, in the same TransactWrite as the decision. The transaction list (receipt status and risk per transaction) is computed in the domain (`transactionViews`) from AP1 plus AP7: two queries, no per-row lookups. Fine at demo scale; at production scale the status and risk would be denormalized onto the transaction too.

### 5.3 Duplicate detection in DynamoDB
DynamoDB can't search by Hamming distance, so the perceptual hash is indexed with **banding**:
- The 64-bit dHash is split into **7 bands** (bands 1–6 of 9 bits, band 7 of 10 bits).
- If two hashes differ in **≤ 6 bits**, at least one of the 7 bands must be identical (pigeonhole principle).
- On processing, the service writes one fingerprint item per band, `FP#DH${i}#${bandValue}`, and queries those same 7 keys. The candidate receipts that come back are then compared with the exact Hamming distance in `domain`.

Other fingerprint kinds:
- `FP#SHA#${sha256}`: exact duplicates.
- `FP#CONTENT#${merchantNorm}|${date}|${totalMinor}${currency}`: the same receipt photographed twice.

**Why 7 queries:** the lookup is "which *other* receipts share band 1 **or** band 2 … **or** band 7". Those are 7 different partition keys, and a `Query` targets one partition. DynamoDB has no OR across keys. The queries run in parallel (`Promise.all`), so the latency is about one round trip. Alternatives rejected:
- `BatchGetItem` needs the full key, and the SK (the other receipt's ID) is exactly what is unknown.
- PartiQL `WHERE PK IN [...]` performs the same reads internally, and dynatable doesn't expose it.
- One GSI per band would still mean 7 queries, and it would spend 7 of the 20 GSIs on a single feature.

Processing first claims the receipt with a conditional write (`uploading → processing`), saving its image features. It then writes the image fingerprints (SHA and dHash bands) **before** querying, with strongly consistent reads; a receipt's own ID is filtered out of the results. Of two uploads of the same image at the same moment, the one that queries last always finds the other. The content fingerprint can only be written after extraction, and it uses the amounts as verified (with the currency settled against the anchor), the same reading later lookups use; choosing another anchor re-indexes it.

### 5.4 Atomic decision (TransactWrite)
1. Update Receipt: `status = approved | rejected`, with the condition `status = pending_review`.
2. Update Transaction (card receipts that are approved): set `receiptId`, with the condition that the transaction exists and has no `receiptId` yet.
3. Put Decision: `ifNotExists`.

If a condition fails, nothing is written and the API returns `409 TRANSACTION_ALREADY_MATCHED` or `409 INVALID_STATE`.

### 5.5 Receipt states and conditional writes

```
uploading ──claim──► processing ──► pending_review ──decide──► approved | rejected
    ▲                    │
    └── extractor down ──┘  (503, retryable)
```

Each arrow is a conditional write on the stored `status` (`dynamo/receipts.ts`, `transition`), so two concurrent requests can't both move the same receipt: the loser gets `409 INVALID_STATE`. Re-anchoring (`POST /receipts/{id}/anchor`) still saves with an unconditional put; a version attribute for optimistic locking is the planned fix.

### 5.6 Table creation
- **AWS:** the table is defined in `serverless.yml` `resources` (CloudFormation).
- **Local:** `npm run local:setup` creates the same table and bucket in the emulator with a script that reads the same key definitions, then runs the seed.

## 6. Frontend

- React Router in SPA mode, built with Vite to static files. Three routes:
  - `/`: Overview. The review queue (pending receipts, riskiest first), card transactions with their receipt status, and decided receipts.
  - `/receipts/new`: upload form.
  - `/receipts/:id`: the receipt, what Textract read, the verification (risk, receipt-vs-network comparison table, signals), the match candidates with their reasons, manual assignment, and the decision.
- Data goes through `clientLoader` and `clientAction`, with a typed `api` client over the web's own response types (`app/lib/api-types.ts`).
- The upload page shows its two steps: *Upload* (presigned PUT to S3) and *Read & verify* (`/process`). If processing fails after the upload (e.g. `503`), the button becomes *Try again* and only `/process` is called again.
- Styling is Tailwind with no component library. Risk and signal severities use one consistent color scale.
- `VITE_API_URL` points to `serverless-offline` locally, or to the deployed API Gateway.
- Hosting the SPA on AWS (S3 + CloudFront) is out of scope. For the demo it runs locally against either API.

## 7. Environments and scripts

| Mode | API | DB / S3 | Extractor | Needs |
|---|---|---|---|---|
| **local** | `serverless-offline` | Floci | fixture | Docker, Node 24 |
| **local + real Textract** | `serverless-offline` | Floci | textract (`EXTRACTOR=textract npm run dev:api`) | + AWS credentials |
| **dev (deployed)** | API Gateway + Lambda | DynamoDB + S3 | textract | AWS credentials |

| Script (root) | What it does |
|---|---|
| `npm run local:up` | `docker compose up -d` (Floci) |
| `npm run local:setup` | reset the table and bucket, then seed |
| `npm run dev:api` | `serverless-offline` on port 4000 |
| `npm run dev:web` | Vite dev server on port 5173 |
| `npm test` | Vitest across all packages |
| `npm run test:integration` | repository tests against Floci |
| `npm run typecheck` | `tsc` in both packages |
| `npm run lint` | ESLint architecture boundaries (§3) |
| `npm run demo-receipts` | regenerate the demo receipt images |
| `npm run record-fixtures` | real Textract → `fixtures/receipts/*.textract.json` (`-- --write` to save) |

Deploying is `npm run deploy -w @receipt-match/api` (`serverless deploy --stage dev`); seeding a deployed stage is not scripted.

## 8. Testing

| Level | Scope | Tooling |
|---|---|---|
| Unit | `domain`: every rule, check, banding and date case | Vitest, no mocks |
| Scenario | Every row of SPEC §10 through the Lambda handlers, with in-memory functions (`test/memory.ts`), plus real-world conditions: simultaneous duplicate uploads, `/process` called twice at once, the extractor down and retried | Vitest |
| Mapper | Recorded Textract JSON → `ExtractedReceipt` | Vitest + fixtures |
| Handler and Middy | `handler.ts` logic with injected functions; each `lambda.ts` chain via `createLambda(deps)`: validation, malformed JSON, error mapping, serialization | Vitest |
| `dynamo/*` (integration) | dynatable schema against Floci: key templates, GSI queries, conditional state transitions, TransactWrite conditions | Vitest, opt-in (`npm run test:integration`) |
| Manual | Deployed dev stage with real Textract, before recording | — |

## 9. Risks and open decisions

### 9.1 Serverless Framework v3 is past end of support
The last v3 release is 3.40.0, from December 2024. Its config schema predates `nodejs24.x`, but deploying with `runtime: nodejs24.x` has been verified to work: v3 passes the value through to CloudFormation and at most logs a config validation warning. Being unmaintained is still a risk for future AWS changes; the fallback is the community-maintained v3 fork (`osls`), which uses the same YAML.

The rationale for v3 goes in the write-up: v4 changed its licensing model, and v3's feature set covers everything this project needs.

### 9.2 Synchronous, client-triggered processing
`/process` runs inside one HTTP request (API Gateway's 30 s limit), and the browser triggers it after the upload. If the browser never calls it, the receipt stays `uploading`. The planned fix is S3 `ObjectCreated` → SQS → a worker Lambda running the same `processReceipt` handler, with retries and a dead-letter queue.

### 9.3 Upload limits are declared, not enforced
The 5 MB limit and the MIME type are validated on what the browser declares in `POST /receipts`; a presigned PUT can't cap the size. The planned fix is a presigned POST with `content-length-range`, plus checking the real size and magic bytes before processing.

### 9.4 Local emulator
Floci emulates DynamoDB and S3 but not Textract. That's why local mode uses the fixture extractor, or real Textract with bytes (§4.2).

## 10. Gotchas found during implementation
- **Presigned PUT URLs and SDK checksums.** Recent AWS SDK v3 versions add flexible checksums by default, which signs a CRC32 of the *empty* payload into presigned PUT URLs. Every browser upload then fails with `BadDigest`. The S3 clients set `requestChecksumCalculation: 'WHEN_REQUIRED'`.
- **dynatable `cleanInternalKeys`.** The middleware wraps only the initial builder, so chained calls (`.consistentRead()`, `.select()`) return items with `PK`/`SK`/`GSI*` attached. The repository strips internal attributes itself.
- **dynatable `Object` attributes.** Runtime accepts an object attribute without `schema` (a free-form map), but the published types require one. Nested domain structures use `schema: {}`.
- **Textract reads "$" as USD.** AnalyzeExpense returns `Currency: USD` for every "$" amount, even on a ticket that prints `TOTAL MXN`. In Argentina (and Mexico, Colombia, Chile) "$" is pesos. The mapper uses a code or unambiguous notation printed on the document (`ARS`, `USD`, `U$S`, `US$`), and otherwise reads a bare "$" in the company currency and flags it as ambiguous. The matcher then also tries the transaction's dollar-sign currency, so a US invoice printing only "$49.99" matches its USD charge and the receipt is re-read in USD (`settleCurrency`, re-decided if the user picks another transaction).
- **Textract's expense model is weak on Latin American tickets.** On Mexican tickets `CITY` came back truncated ("Ciudad de"); on Argentine ones it often found no city or address at all ("CABA" isn't recognised) and once no vendor name, although its OCR read every line correctly. The mapper recovers merchant, city and address from the printed lines with reduced confidence, and prefers `ADDRESS_BLOCK`, which excludes the merchant name.
- **Item text can include the price** ("Sandwich 235.00"). The mapper strips a trailing money-formatted amount (with decimals only, so "Refresco 600" stays intact).
- **Nulls.** dynatable's optional attributes reject `null`, and DynamoDB can't store `undefined`. The repository drops top-level nulls on write and restores them on read.
- **Unreadable vs unavailable.** Treating every extractor error as "unreadable receipt" turned a Textract throttle into a permanent verdict. Textract's document errors (`UnsupportedDocumentException`, `BadDocumentException`, `DocumentTooLargeException`, `InvalidParameterException`) mean unreadable; anything else gives the receipt back as `uploading` and returns `503`.
- **Content fingerprint and currency.** The content key includes the currency. It was first written with the amounts as read ("$" as ARS) but looked up with the amounts as verified (settled to USD), so a second photo of a "$" invoice was never found. Both now use the verified reading.
