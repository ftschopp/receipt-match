import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card } from '../components/ui';
import { api, isApiError } from '../lib/api';
import { ACCEPTED_MIME_TYPES, MAX_FILE_BYTES, type ReceiptKind } from '../lib/api-types';
import type { Route } from './+types/receipt-new';

export async function clientLoader() {
  return api.employees();
}

type Step = 'idle' | 'uploading' | 'processing' | 'error';

const STEPS = [
  { key: 'uploading', label: 'Upload', detail: 'Straight to secure storage (S3, presigned URL)' },
  { key: 'processing', label: 'Read & verify', detail: 'Extract with Textract, match the card charge, run the checks' },
] as const;

export default function NewReceipt({ loaderData }: Route.ComponentProps) {
  const { employees } = loaderData;
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '');
  const [kind, setKind] = useState<ReceiptKind>('card');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  /** A receipt whose file is already in S3 but couldn't be processed yet: retrying skips the upload. */
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!file || file.type === 'application/pdf') return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(candidate: File | undefined) {
    setError(null);
    setUploadedId(null);
    if (!candidate) return;
    if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(candidate.type)) {
      return setError('Use a JPEG, PNG or single-page PDF.');
    }
    if (candidate.size > MAX_FILE_BYTES) return setError('The file is larger than 5 MB.');
    setFile(candidate);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setError(null);
    try {
      let receiptId = uploadedId;
      if (!receiptId) {
        setStep('uploading');
        const { receipt, upload } = await api.createReceipt({
          employeeId,
          kind,
          mimeType: file.type as (typeof ACCEPTED_MIME_TYPES)[number],
          size: file.size,
        });
        await api.upload(upload, file);
        receiptId = receipt.id;
        setUploadedId(receiptId);
      }
      setStep('processing');
      await api.process(receiptId);
      navigate(`/receipts/${receiptId}`);
    } catch (e) {
      setStep('error');
      setError(isApiError(e) ? e.message : 'Could not reach the API. Is it running?');
    }
  }

  const busy = step === 'uploading' || step === 'processing';
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload a receipt</h1>
        <p className="mt-1 text-slate-500">
          We read it, find the card charge it belongs to, and check it against what the card network recorded.
        </p>
      </div>

      <Card>
        <form onSubmit={submit} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="font-medium">Employee</span>
              <select
                value={employeeId}
                onChange={(e) => {
                  setEmployeeId(e.target.value);
                  setUploadedId(null);
                }}
                disabled={busy}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.department}
                  </option>
                ))}
              </select>
            </label>

            <fieldset>
              <legend className="font-medium">Paid with</legend>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(
                  [
                    ['card', 'Corporate card'],
                    ['reimbursement', 'Personal (reimburse)'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-lg border px-3 py-2 text-center transition ${
                      kind === value ? 'border-brand-500 bg-brand-50 font-medium text-brand-700' : 'border-slate-300 hover:border-slate-400'
                    }`}
                  >
                    <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => {
                        setKind(value);
                        setUploadedId(null);
                      }} disabled={busy} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files[0]);
            }}
            className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition ${
              dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-slate-400'
            }`}
          >
            <input type="file" accept={ACCEPTED_MIME_TYPES.join(',')} className="sr-only" disabled={busy} onChange={(e) => choose(e.target.files?.[0])} />
            {preview ? (
              <img src={preview} alt="Receipt preview" className="max-h-64 rounded-md shadow" />
            ) : (
              <span className="text-3xl" aria-hidden>
                🧾
              </span>
            )}
            {file ? (
              <span className="font-medium">
                {file.name} <span className="font-normal text-slate-400">· {(file.size / 1024).toFixed(0)} KB</span>
              </span>
            ) : (
              <span>
                <span className="font-medium text-brand-600">Choose a file</span> or drag it here
                <span className="block text-xs text-slate-400">JPEG, PNG or single-page PDF, up to 5 MB</span>
              </span>
            )}
          </label>

          {busy && (
            <ol className="space-y-3">
              {STEPS.map((s, i) => (
                <li key={s.key} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                      i < stepIndex ? 'bg-emerald-500 text-white' : i === stepIndex ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {i < stepIndex ? '✓' : i + 1}
                  </span>
                  <span>
                    <span className={`font-medium ${i === stepIndex ? 'text-ink' : 'text-slate-500'}`}>
                      {s.label}
                      {i === stepIndex && <span className="ml-1 animate-pulse">…</span>}
                    </span>
                    <span className="block text-xs text-slate-400">{s.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">{error}</p>}

          <button
            type="submit"
            disabled={!file || busy}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Working…' : uploadedId ? 'Try again' : 'Upload and check'}
          </button>
        </form>
      </Card>
    </div>
  );
}
