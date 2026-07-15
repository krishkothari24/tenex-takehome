import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardAnalytics } from '@inbox-concierge/shared';

const FALLBACK_COLOR = '#64748B'; // matches the board's own "Unsorted" dot fallback
const AXIS_COLOR = '#94a3b8'; // slate-400 — reuses the app's existing muted-text tone
const GRID_COLOR = '#1e293b'; // slate-800 — matches the board's card border, a recessive hairline

/**
 * "Emails per bucket" (build guide §6). Horizontal bar rather than the guide's loose "bar or
 * donut" suggestion — bucket count is user-extensible via custom buckets, so it can exceed the
 * ~5 slices a donut stays legible past. Each bar reuses the bucket's own stored color (already used
 * by the board/cards) rather than a second palette, and the bucket name on the axis already
 * carries identity, so no separate legend is needed.
 */
export function VolumeBreakdownChart({ data }: { data: DashboardAnalytics['volumeByBucket'] }) {
  const sorted = [...data].sort((a, b) => b.count - a.count);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold text-slate-200">Volume by bucket</h3>
      <div className="mt-3 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sorted} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fill: AXIS_COLOR, fontSize: 12 }} stroke={GRID_COLOR} />
            <YAxis
              type="category"
              dataKey="bucket"
              width={100}
              tick={{ fill: AXIS_COLOR, fontSize: 12 }}
              stroke={GRID_COLOR}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              contentStyle={{ background: '#0f172a', border: `1px solid ${GRID_COLOR}`, borderRadius: 6 }}
              labelStyle={{ color: '#e2e8f0' }}
              itemStyle={{ color: '#cbd5e1' }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
              {sorted.map((entry) => (
                <Cell key={entry.bucket} fill={entry.color ?? FALLBACK_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
