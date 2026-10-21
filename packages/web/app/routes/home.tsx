import { Link, useSearchParams } from 'react-router';
import { Badge, Card, Empty, RiskBadge, Stat, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import type { Receipt, RiskLevel, TransactionListItem } from '../lib/api-types';
import { chargeAmount, dateTime, merchantTypeLabel, money } from '../lib/format';
import type { Route } from './+types/home';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const filter = new URL(request.url).searchParams.get('filter') === 'attention' ? 'attention' : 'all';
  const [{ employees }, { transactions }, { receipts }] = await Promise.all([
    api.employees(),
    api.transactions(filter),
    api.receipts(),
  ]);
  return { employees, transactions, receipts, filter };
}

const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

/** Pending receipts, riskiest first: where a reviewer's time matters most. */
function reviewQueue(receipts: Receipt[]): Receipt[] {
  return receipts
    .filter((r) => r.status === 'pending_review')
    .sort((a, b) => RISK_ORDER[a.risk?.level ?? 'low'] - RISK_ORDER[b.risk?.level ?? 'low'] || b.uploadedAt.localeCompare(a.uploadedAt));
}

const RECEIPT_STATUS: Record<TransactionListItem['receiptStatus'], { tone: 'neutral' | 'brand' | 'good'; label: string }> = {
  missing: { tone: 'neutral', label: 'Missing receipt' },
  pending_review: { tone: 'brand', label: 'Pending review' },
  approved: { tone: 'good', label: 'Approved' },
};

export default function Home({ loaderData }: Route.ComponentProps) {
  const { employees, transactions, receipts, filter } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const names = new Map(employees.map((e) => [e.id, e.name]));
  const queue = reviewQueue(receipts);

  // Stats come from the receipts and the unfiltered view of transactions.
  const missing = transactions.filter((t) => t.receiptStatus === 'missing').length;
  const highRisk = queue.filter((r) => r.risk?.level === 'high').length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-slate-500">Card transactions for the week of Oct 12–18, 2026, and the receipts submitted for them.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Pending review" value={queue.length} hint="Receipts waiting for a decision" tone="brand" />
        <Stat label="High risk" value={highRisk} hint="Pending receipts with a strong signal" tone={highRisk > 0 ? 'bad' : 'neutral'} />
        <Stat label="Missing receipts" value={filter === 'all' ? missing : '—'} hint="Card charges with no receipt yet" />
      </div>

      <Card title="Review queue" action={<span className="text-slate-400">Riskiest first</span>}>
        {queue.length === 0 ? (
          <Empty>
            Nothing to review. <Link to="/receipts/new" className="font-medium text-brand-600 hover:underline">Upload a receipt</Link> to get started.
          </Empty>
        ) : (
          <ul className="-my-2 divide-y divide-slate-100">
            {queue.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/receipts/${r.id}`}
                  className="-mx-2 grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-lg px-2 py-3 hover:bg-slate-50 md:grid-cols-[7rem_minmax(0,14rem)_7rem_8rem_8rem_minmax(0,1fr)_auto]"
                >
                  <span>
                    <RiskBadge level={r.risk?.level} />
                  </span>
                  <span className="truncate font-medium">{r.extraction?.merchantName.value ?? 'Unreadable receipt'}</span>
                  <span className="tabular hidden text-right text-slate-600 md:block">{money(r.extraction?.total.value)}</span>
                  <span className="hidden truncate text-slate-500 md:block">{names.get(r.employeeId) ?? r.employeeId}</span>
                  <span className="hidden md:block">
                    <Badge>{r.kind === 'card' ? 'Card' : 'Reimbursement'}</Badge>
                  </span>
                  <span className="hidden truncate text-slate-500 md:block">{r.signals[0]?.title ?? r.risk?.reasons[0] ?? ''}</span>
                  <span className="font-medium text-brand-600">Review →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Card transactions"
        action={
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
            {(['all', 'attention'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSearchParams(f === 'all' ? {} : { filter: f })}
                className={`rounded-md px-3 py-1 transition ${filter === f ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-ink'}`}
              >
                {f === 'all' ? 'All' : 'Needs attention'}
              </button>
            ))}
          </div>
        }
      >
        {transactions.length === 0 ? (
          <Empty>No transactions need attention.</Empty>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-medium">Authorized</th>
                  <th className="px-5 py-3 font-medium">Merchant</th>
                  <th className="px-5 py-3 font-medium">Employee</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Receipt</th>
                  <th className="px-5 py-3 font-medium">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="tabular whitespace-nowrap px-5 py-3 text-slate-600">{dateTime(t.authorizedAt, t.merchantTimezone)}</td>
                    <td className="px-5 py-3">
                      <div className="font-mono text-xs font-medium">{t.merchantDescriptor}</div>
                      <div className="text-xs text-slate-400">
                        {merchantTypeLabel(t)} · {t.cardPresent ? t.merchantCity : 'Online'}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{names.get(t.employeeId) ?? t.employeeId}</td>
                    <td className="tabular whitespace-nowrap px-5 py-3 text-right">{chargeAmount(t)}</td>
                    <td className="px-5 py-3">
                      {t.linkedReceiptId ? (
                        <Link to={`/receipts/${t.linkedReceiptId}`} className="hover:opacity-80">
                          <Badge tone={RECEIPT_STATUS[t.receiptStatus].tone}>{RECEIPT_STATUS[t.receiptStatus].label} →</Badge>
                        </Link>
                      ) : (
                        <Badge tone="neutral">{RECEIPT_STATUS[t.receiptStatus].label}</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <RiskBadge level={t.riskLevel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {receipts.some((r) => r.status !== 'pending_review') && (
        <Card title="Decided receipts">
          <ul className="-my-2 divide-y divide-slate-100">
            {receipts
              .filter((r) => r.status !== 'pending_review')
              .map((r) => (
                <li key={r.id}>
                  <Link to={`/receipts/${r.id}`} className="-mx-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2.5 hover:bg-slate-50">
                    <StatusBadge status={r.status} />
                    <span className="font-medium">{r.extraction?.merchantName.value ?? 'Unreadable receipt'}</span>
                    <span className="tabular text-slate-600">{money(r.extraction?.total.value)}</span>
                    <span className="text-slate-500">{names.get(r.employeeId) ?? r.employeeId}</span>
                    <span className="ml-auto">
                      <RiskBadge level={r.risk?.level} />
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
