import { Form, Link, useNavigation } from 'react-router';
import { Badge, Card, Confidence, Empty, RiskBadge, SeverityBadge, StatusBadge } from '../components/ui';
import { api, isApiError } from '../lib/api';
import type { CurrencyResolution, ExtractedReceipt, Receipt, ReceiptResponse, ScoredCandidate, Signal, Transaction } from '../lib/api-types';
import { chargeAmount, date, dateTime, localDateAndTime, money, pct } from '../lib/format';
import type { Route } from './+types/receipt';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return api.receipt(params.id);
}

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  const form = await request.formData();
  try {
    if (form.get('intent') === 'anchor') {
      await api.setAnchor(params.id, String(form.get('transactionId')));
    } else {
      const note = String(form.get('note') ?? '').trim();
      await api.decide(params.id, { decision: form.get('decision') === 'approved' ? 'approved' : 'rejected', ...(note && { note }) });
    }
    return { error: null };
  } catch (e) {
    if (isApiError(e)) return { error: e.message, code: e.code };
    throw e;
  }
}

// ---------- Receipt vs card network ----------

type Row = { label: string; receipt: string; network: string; codes: string[] };

function comparison(extraction: ExtractedReceipt, receipt: Receipt, tx: Transaction, insights: ReceiptResponse['insights']): Row[] {
  const categories = insights.receiptCategories;
  const info = insights.anchorMerchantType;
  const printedDate = receipt.date ? `${date(receipt.date.date)}${receipt.date.resolution === 'printed' ? '' : ' (inferred)'}` : '—';
  const total = extraction.total.value;
  const tip = extraction.tip.value;
  return [
    { label: 'Merchant', receipt: extraction.merchantName.value ?? '—', network: tx.merchantDescriptor, codes: [] },
    {
      label: 'What was sold',
      receipt: categories.length ? categories.join(', ') : 'Not enough to classify',
      network: info ? `${info.label}: expects ${info.expects.join(' or ')}` : `MCC ${tx.mcc}`,
      codes: ['CATEGORY_MISMATCH'],
    },
    {
      label: 'When',
      receipt: `${printedDate}${extraction.time.value ? ` · ${extraction.time.value}` : ''}`,
      network: localDateAndTime(tx.authorizedAt, tx.merchantTimezone),
      codes: ['TIME_MISMATCH', 'DATE_MISMATCH'],
    },
    {
      label: 'Where',
      receipt: [extraction.city.value, extraction.address.value].filter(Boolean).join(' · ') || '—',
      network: tx.cardPresent ? `${tx.merchantCity} (card present)` : 'Online purchase',
      codes: ['CITY_MISMATCH'],
    },
    {
      label: 'Amount',
      receipt: tip ? `${money(total)} + tip ${money(tip)}` : money(total),
      network: chargeAmount(tx),
      codes: ['AMOUNT_MISMATCH', 'AMOUNT_UNEXPLAINED'],
    },
  ];
}

function AnchorComparison({ rows, signals }: { rows: Row[]; signals: Signal[] }) {
  const flagged = new Map(signals.map((s) => [s.code, s.severity]));
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-left">
        <thead className="text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-5 pb-2 font-medium" />
            <th className="px-5 pb-2 font-medium">Receipt says</th>
            <th className="px-5 pb-2 font-medium">Card network says</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const severity = row.codes.map((c) => flagged.get(c)).find(Boolean);
            const tint = severity === 'strong' ? 'bg-rose-50' : severity ? 'bg-amber-50' : '';
            return (
              <tr key={row.label} className={tint}>
                <th className="whitespace-nowrap px-5 py-2.5 font-medium text-slate-500">
                  {severity && <span className={`mr-1.5 inline-block size-1.5 rounded-full ${severity === 'strong' ? 'bg-rose-500' : 'bg-amber-500'}`} />}
                  {row.label}
                </th>
                <td className="px-5 py-2.5">{row.receipt}</td>
                <td className="px-5 py-2.5 font-medium">{row.network}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Signals({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return <p className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">No inconsistencies found. The receipt agrees with the card network and with every other receipt.</p>;
  }
  return (
    <ul className="space-y-3">
      {signals.map((s, i) => {
        const other = typeof s.evidence.otherReceiptId === 'string' ? s.evidence.otherReceiptId : null;
        return (
          <li key={`${s.code}-${i}`} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={s.severity} />
              <span className="font-medium">{s.title}</span>
              <code className="ml-auto text-xs text-slate-400">{s.code}</code>
            </div>
            <p className="mt-1.5 text-slate-600">{s.explanation}</p>
            {other && (
              <Link to={`/receipts/${other}`} className="mt-1.5 inline-block text-xs font-medium text-brand-600 hover:underline">
                Open the other receipt →
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Extracted data ----------

function Field({ label, value, confidence, note }: { label: string; value: string | null; confidence: number; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="flex items-center gap-3 text-right">
        <span className={value ? 'font-medium' : 'text-slate-400'}>
          {value ?? 'not found'}
          {note && <span className="ml-1 text-xs font-normal text-amber-700">{note}</span>}
        </span>
        {value && <Confidence value={confidence} />}
      </dd>
    </div>
  );
}

function Extracted({ receipt, categories }: { receipt: Receipt; categories: ReceiptResponse['insights']['lineItemCategories'] }) {
  const x = receipt.extraction;
  if (!x) return <Empty>The receipt could not be read.</Empty>;
  const d = receipt.date;
  return (
    <>
      <dl className="divide-y divide-slate-100">
        <Field label="Merchant" value={x.merchantName.value} confidence={x.merchantName.confidence} />
        <Field label="Address" value={x.address.value} confidence={x.address.confidence} />
        <Field label="City" value={x.city.value} confidence={x.city.confidence} />
        <Field
          label="Date"
          value={d ? date(d.date) : null}
          confidence={x.date.confidence}
          {...(d && d.resolution !== 'printed' && { note: d.resolution === 'inferred_from_transactions' ? 'ambiguous, inferred from charges' : 'ambiguous, inferred from currency' })}
        />
        <Field label="Time" value={x.time.value} confidence={x.time.confidence} />
        <Field label="Subtotal" value={x.subtotal.value ? money(x.subtotal.value) : null} confidence={x.subtotal.confidence} />
        <Field label="Tax" value={x.tax.value ? money(x.tax.value) : null} confidence={x.tax.confidence} />
        <Field label="Tip" value={x.tip.value ? money(x.tip.value) : null} confidence={x.tip.confidence} />
        <Field label="Total" value={x.total.value ? money(x.total.value) : null} confidence={x.total.confidence} />
      </dl>
      {receipt.currency && <CurrencyNote currency={receipt.currency} />}
      {x.lineItems.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Line items</h3>
          <ul className="space-y-1.5">
            {x.lineItems.map((li, i) => {
              const category = categories[i] ?? null;
              return (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex-1">{li.description}</span>
                  {category ? <Badge tone="brand">{category}</Badge> : <Badge>unclassified</Badge>}
                  <span className="tabular w-24 text-right text-slate-600">{money(li.amount)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

const CURRENCY_NOTES: Record<CurrencyResolution['resolution'], (c: CurrencyResolution) => string> = {
  printed: (c) => `${c.code}, printed on the receipt.`,
  company_default: (c) => `${c.code}: the receipt shows only "$", read in the company currency.`,
  inferred_from_transaction: (c) =>
    `${c.code}: the receipt shows only "$", and the amounts match the card charge in ${c.code} (first read as ${c.readAs}).`,
};

function CurrencyNote({ currency }: { currency: CurrencyResolution }) {
  const inferred = currency.resolution === 'inferred_from_transaction';
  return (
    <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${inferred ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-500'}`}>
      <span className="font-medium">Currency</span> · {CURRENCY_NOTES[currency.resolution](currency)}
    </p>
  );
}

// ---------- Match ----------

function Candidate({ candidate, tx, isAnchor, canChoose }: { candidate: ScoredCandidate; tx: Transaction | undefined; isAnchor: boolean; canChoose: boolean }) {
  return (
    <li className={`rounded-lg border p-3 ${isAnchor ? 'border-brand-500 bg-brand-50/40' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium">{tx?.merchantDescriptor ?? candidate.transactionId}</span>
        {tx && <span className="tabular text-slate-600">{chargeAmount(tx)}</span>}
        {tx && <span className="text-slate-400">{dateTime(tx.authorizedAt, tx.merchantTimezone)}</span>}
        <span className="tabular ml-auto font-semibold">{pct(candidate.score)}</span>
        {isAnchor && <Badge tone="brand">Selected</Badge>}
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
        {Object.entries(candidate.signals).map(([name, s]) => (
          <li key={name}>
            <span className="inline-block w-16 font-medium capitalize text-slate-400">{name}</span> {s.reason}
          </li>
        ))}
      </ul>
      {canChoose && !isAnchor && (
        <Form method="post" className="mt-2">
          <input type="hidden" name="intent" value="anchor" />
          <input type="hidden" name="transactionId" value={candidate.transactionId} />
          <button className="text-xs font-medium text-brand-600 hover:underline">Use this transaction</button>
        </Form>
      )}
    </li>
  );
}

const OUTCOME = {
  suggested: { tone: 'good', label: 'Suggested match' },
  needs_review: { tone: 'warn', label: 'Needs review' },
  no_match: { tone: 'bad', label: 'No match' },
} as const;

// ---------- Page ----------

export default function ReceiptPage({ loaderData, actionData }: Route.ComponentProps) {
  const { receipt, anchor, decisions, employee, imageUrl, assignable, insights } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  const pending = receipt.status === 'pending_review';
  const highRisk = receipt.risk?.level === 'high';
  const byId = new Map([...assignable, ...(anchor ? [anchor] : [])].map((t) => [t.id, t]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/" className="text-slate-500 hover:text-ink">
            ← Overview
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{receipt.extraction?.merchantName.value ?? 'Unreadable receipt'}</h1>
          <p className="mt-1 text-slate-500">
            {employee?.name ?? receipt.employeeId} · {receipt.kind === 'card' ? 'Corporate card' : 'Reimbursement'} · uploaded{' '}
            {dateTime(receipt.uploadedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={receipt.status} />
          <RiskBadge level={receipt.risk?.level} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-6">
          <Card title="Receipt">
            {imageUrl ? (
              receipt.mimeType === 'application/pdf' ? (
                <a href={imageUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
                  Open PDF →
                </a>
              ) : (
                <img src={imageUrl} alt="Receipt" className="mx-auto max-h-[28rem] rounded-md border border-slate-200" />
              )
            ) : (
              <Empty>No image uploaded.</Empty>
            )}
          </Card>
          <Card title="Read from the receipt" action={<span className="text-xs text-slate-400">AWS Textract</span>}>
            <Extracted receipt={receipt} categories={insights.lineItemCategories} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Verification" action={<RiskBadge level={receipt.risk?.level} />}>
            {receipt.risk && receipt.risk.reasons.length > 0 && <p className="mb-4 text-slate-500">Because of {receipt.risk.reasons.join('; ')}.</p>}
            {anchor && receipt.extraction && (
              <div className="mb-5">
                <AnchorComparison rows={comparison(receipt.extraction, receipt, anchor, insights)} signals={receipt.signals} />
              </div>
            )}
            {!anchor && receipt.kind === 'reimbursement' && (
              <p className="mb-4 rounded-lg bg-slate-50 px-4 py-3 text-slate-600">
                Reimbursement: there is no card transaction to verify against, so only duplicate and document checks apply.
              </p>
            )}
            {!anchor && receipt.kind === 'card' && (
              <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-amber-800">Choose the card transaction below to check the receipt against it.</p>
            )}
            <Signals signals={receipt.signals} />
          </Card>

          {receipt.kind === 'card' && (
            <Card
              title="Card transaction"
              action={receipt.match && <Badge tone={OUTCOME[receipt.match.outcome].tone}>{OUTCOME[receipt.match.outcome].label}</Badge>}
            >
              {receipt.match && <p className="mb-3 text-slate-500">{receipt.match.explanation}</p>}
              {receipt.match && receipt.match.candidates.length > 0 && (
                <ul className="space-y-2">
                  {receipt.match.candidates.map((c) => (
                    <Candidate
                      key={c.transactionId}
                      candidate={c}
                      tx={byId.get(c.transactionId)}
                      isAnchor={c.transactionId === receipt.anchorTransactionId}
                      canChoose={pending && byId.has(c.transactionId)}
                    />
                  ))}
                </ul>
              )}
              {anchor && !receipt.match?.candidates.some((c) => c.transactionId === anchor.id) && (
                <p className="mt-3 rounded-lg border border-brand-500 bg-brand-50/40 p-3">
                  Assigned manually: <span className="font-mono text-xs font-medium">{anchor.merchantDescriptor}</span> · {chargeAmount(anchor)} ·{' '}
                  {dateTime(anchor.authorizedAt, anchor.merchantTimezone)}
                </p>
              )}
              {pending && assignable.length > 0 && (
                <Form method="post" className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <input type="hidden" name="intent" value="anchor" />
                  <label htmlFor="transactionId" className="text-slate-500">
                    Assign another transaction
                  </label>
                  <select id="transactionId" name="transactionId" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5">
                    {assignable.map((t) => (
                      <option key={t.id} value={t.id}>
                        {dateTime(t.authorizedAt, t.merchantTimezone)} · {t.merchantDescriptor} · {chargeAmount(t)}
                      </option>
                    ))}
                  </select>
                  <button disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-50">
                    Assign
                  </button>
                </Form>
              )}
            </Card>
          )}

          {pending ? (
            <Card title="Decision">
              <Form method="post" className="space-y-3">
                <label className="block">
                  <span className="font-medium">Note {highRisk ? <span className="text-rose-600">(required for high-risk receipts)</span> : <span className="font-normal text-slate-400">(optional)</span>}</span>
                  <textarea
                    name="note"
                    rows={3}
                    placeholder={highRisk ? 'Why is this receipt acceptable? E.g. "Confirmed with the employee: client dinner, ticket reprinted at the bar."' : ''}
                    className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                {actionData?.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">{actionData.error}</p>}
                <div className="flex gap-2">
                  <button
                    name="decision"
                    value="approved"
                    disabled={busy}
                    className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    name="decision"
                    value="rejected"
                    disabled={busy}
                    className="flex-1 rounded-lg border border-rose-300 bg-white px-4 py-2 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
                <p className="text-xs text-slate-400">Every decision is recorded with the risk level at the time and the note.</p>
              </Form>
            </Card>
          ) : (
            <Card title="Decision history">
              <ul className="space-y-2">
                {decisions.map((d) => (
                  <li key={d.decidedAt} className="rounded-lg bg-slate-50 px-3 py-2">
                    <span className="font-medium capitalize">{d.decision}</span> · {dateTime(d.decidedAt)} · risk at the time:{' '}
                    {d.riskLevelAtDecision ?? '—'}
                    {d.note && <p className="mt-1 text-slate-600">“{d.note}”</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
