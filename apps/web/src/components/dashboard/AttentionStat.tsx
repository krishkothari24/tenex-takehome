import type { DashboardAnalytics } from '@inbox-concierge/shared';

/**
 * "Count of Important threads that appear unanswered" (build guide §6) — a single current value
 * plus a caveat, so a stat tile rather than a chart. Amber styling matches the existing
 * `unclassifiedEmailIds` banner convention in App.tsx, since both signal "needs your attention."
 */
export function AttentionStat({ attention }: { attention: DashboardAnalytics['attention'] }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <p className="text-sm font-medium text-slate-400">Awaiting your reply</p>
      <p className="mt-1 text-5xl font-semibold text-amber-400">{attention.unansweredCount}</p>
      <p className="mt-2 text-xs text-slate-500">
        of {attention.importantTotal} Important thread{attention.importantTotal === 1 ? '' : 's'} with no
        reply from you yet.
      </p>
      {attention.unknownReplyStatusCount > 0 && (
        <p className="mt-1 text-xs text-slate-600">
          {attention.unknownReplyStatusCount} Important thread
          {attention.unknownReplyStatusCount === 1 ? '' : 's'} not yet checked — sync your inbox again to
          include them.
        </p>
      )}
    </div>
  );
}
