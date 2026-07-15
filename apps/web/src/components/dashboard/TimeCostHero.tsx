import type { DashboardAnalytics } from '@inbox-concierge/shared';

/**
 * The demo's opening beat (build guide §2/§6): a single headline number, not a chart — a hero
 * figure needs no plot. `assumptionNote` is rendered verbatim so the estimate stays honest about
 * being an estimate (the model's per-email read-time guess, not a measurement).
 */
export function TimeCostHero({ timeCost }: { timeCost: DashboardAnalytics['timeCost'] }) {
  const hours = timeCost.totalHours;
  const display = hours >= 10 ? hours.toFixed(0) : hours.toFixed(1);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <p className="text-sm font-medium text-slate-400">Inbox time cost</p>
      <p className="mt-1 text-5xl font-semibold text-slate-50">
        ~{display} <span className="text-2xl font-medium text-slate-400">hours of reading</span>
      </p>
      <p className="mt-3 max-w-xl text-xs text-slate-500">{timeCost.assumptionNote}</p>
      {timeCost.unestimatedCount > 0 && (
        <p className="mt-1 text-xs text-slate-600">
          {timeCost.unestimatedCount} email{timeCost.unestimatedCount === 1 ? '' : 's'} not yet estimated —
          excluded from this total.
        </p>
      )}
    </div>
  );
}
