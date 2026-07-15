import type { DashboardAnalytics, Digest } from '@inbox-concierge/shared';
import type { DigestStatus } from '../hooks/useDigestStream';
import { TimeCostHero } from './dashboard/TimeCostHero';
import { AttentionStat } from './dashboard/AttentionStat';
import { VolumeBreakdownChart } from './dashboard/VolumeBreakdownChart';
import { SenderFrequencyChart } from './dashboard/SenderFrequencyChart';
import { DigestPanel } from './dashboard/DigestPanel';

interface DashboardProps {
  analytics: DashboardAnalytics;
  digest: Digest | null;
  digestStatus: DigestStatus;
  digestInputEmailCount: number;
  digestErrorMessage: string | null;
  onGenerateDigest: () => void;
}

/**
 * The demo's opening screen (build guide §2/§6) — "quantified inbox intelligence," not just a
 * classified list. Takes the already-fetched analytics as a prop; no independent fetching, so
 * loading/error states stay owned by App.tsx's existing conventions. The digest panel sits above
 * the time-cost hero — Phase 6's proactive "what needs me this week" opener, alongside (not
 * replacing) the time-cost number that's been the dashboard's opening moment since Phase 4.
 */
export function Dashboard({
  analytics,
  digest,
  digestStatus,
  digestInputEmailCount,
  digestErrorMessage,
  onGenerateDigest,
}: DashboardProps) {
  return (
    <div className="space-y-4">
      <DigestPanel
        digest={digest}
        status={digestStatus}
        inputEmailCount={digestInputEmailCount}
        errorMessage={digestErrorMessage}
        onGenerate={onGenerateDigest}
      />
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
