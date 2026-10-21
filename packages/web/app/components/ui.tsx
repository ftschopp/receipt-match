import type { ReceiptStatus, RiskLevel, Severity } from '../lib/api-types';
import type { ReactNode } from 'react';

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'brand' | 'good' | 'warn' | 'bad';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const RISK: Record<RiskLevel, { tone: Tone; label: string }> = {
  low: { tone: 'good', label: 'Low risk' },
  medium: { tone: 'warn', label: 'Medium risk' },
  high: { tone: 'bad', label: 'High risk' },
};

export function RiskBadge({ level }: { level: RiskLevel | null | undefined }) {
  if (!level) return <span className="text-slate-400">—</span>;
  const { tone, label } = RISK[level];
  return (
    <Badge tone={tone}>
      <span className={`size-1.5 rounded-full ${level === 'high' ? 'bg-rose-500' : level === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
      {label}
    </Badge>
  );
}

const SEVERITY: Record<Severity, { tone: Tone; label: string }> = {
  strong: { tone: 'bad', label: 'Strong' },
  moderate: { tone: 'warn', label: 'Moderate' },
  weak: { tone: 'neutral', label: 'Weak' },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY[severity].tone}>{SEVERITY[severity].label}</Badge>;
}

const STATUS: Record<ReceiptStatus, { tone: Tone; label: string }> = {
  uploading: { tone: 'neutral', label: 'Uploading' },
  processing: { tone: 'neutral', label: 'Processing' },
  pending_review: { tone: 'brand', label: 'Pending review' },
  approved: { tone: 'good', label: 'Approved' },
  rejected: { tone: 'bad', label: 'Rejected' },
};

export function StatusBadge({ status }: { status: ReceiptStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

/** Extraction confidence (0..100) as a small bar; below 80 is flagged. */
export function Confidence({ value }: { value: number }) {
  const low = value < 80;
  return (
    <span className="inline-flex items-center gap-1.5" title={`Read with ${Math.round(value)}% confidence`}>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-slate-100">
        <span className={`block h-full rounded-full ${low ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(4, value)}%` }} />
      </span>
      <span className={`tabular text-xs ${low ? 'text-amber-700' : 'text-slate-400'}`}>{Math.round(value)}%</span>
    </span>
  );
}

export function Stat({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  const accent = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : tone === 'brand' ? 'text-brand-600' : 'text-ink';
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-slate-500">{label}</p>
      <p className={`tabular mt-1 text-2xl font-semibold ${accent}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-slate-500">{children}</p>;
}
