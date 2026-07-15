import type { Digest } from '@inbox-concierge/shared';
import type { DigestStatus } from '../../hooks/useDigestStream';

const URGENCY_STYLES: Record<Digest['actionItems'][number]['urgency'], string> = {
  high: 'bg-amber-400',
  medium: 'bg-indigo-400',
  low: 'bg-slate-600',
};

/**
 * The proactive "this week" briefing (build guide §6 stretch, elevated into the one deep Phase 6
 * feature) — the first thing in this app that tells the user what to *do*, not just what the
 * inbox looks like. Never auto-fires (real Sonnet spend); the button and empty state make that
 * cost boundary visible rather than hiding it behind a silent background call.
 */
export function DigestPanel({
  digest,
  status,
  inputEmailCount,
  errorMessage,
  onGenerate,
}: {
  digest: Digest | null;
  status: DigestStatus;
  inputEmailCount: number;
  errorMessage: string | null;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-400">This week</p>
          {digest ? (
            <p className="mt-1 text-lg font-semibold text-slate-100">{digest.headline}</p>
          ) : status === 'running' ? (
            <p className="mt-1 text-lg text-slate-300">
              Reading {inputEmailCount > 0 ? `${inputEmailCount} shortlisted emails` : 'your inbox'}…
            </p>
          ) : (
            <p className="mt-1 text-lg text-slate-300">Get a proactive briefing on what needs you this week.</p>
          )}
        </div>
        <button
          onClick={onGenerate}
          disabled={status === 'running'}
          className="shrink-0 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          {status === 'running' ? 'Generating…' : digest ? 'Regenerate' : "Generate this week's digest"}
        </button>
      </div>

      {status === 'error' && errorMessage && <p className="mt-3 text-sm text-red-400">{errorMessage}</p>}

      {digest && (
        <div className="mt-4 space-y-2">
          {digest.actionItems.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing needs action right now — you&rsquo;re caught up.</p>
          ) : (
            digest.actionItems.map((item) => (
              <div key={item.emailId} className="flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${URGENCY_STYLES[item.urgency]}`}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium text-slate-100">{item.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{item.why}</p>
                </div>
              </div>
            ))
          )}
          {digest.fyiCount > 0 && (
            <p className="pt-1 text-xs text-slate-600">
              +{digest.fyiCount} other shortlisted email{digest.fyiCount === 1 ? '' : 's'} already handled or FYI-only.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
