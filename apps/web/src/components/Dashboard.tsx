import type { DashboardAnalytics } from '@inbox-concierge/shared';
import { TimeCostHero } from './dashboard/TimeCostHero';
import { AttentionStat } from './dashboard/AttentionStat';
import { VolumeBreakdownChart } from './dashboard/VolumeBreakdownChart';
import { SenderFrequencyChart } from './dashboard/SenderFrequencyChart';

/**
 * The demo's opening screen (build guide §2/§6) — "quantified inbox intelligence," not just a
 * classified list. Takes the already-fetched analytics as a prop; no independent fetching, so
 * loading/error states stay owned by App.tsx's existing conventions.
 */
export function Dashboard({ analytics }: { analytics: DashboardAnalytics }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TimeCostHero timeCost={analytics.timeCost} />
        <AttentionStat attention={analytics.attention} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <VolumeBreakdownChart data={analytics.volumeByBucket} />
        <SenderFrequencyChart data={analytics.topSenders} />
      </div>
    </div>
  );
}
