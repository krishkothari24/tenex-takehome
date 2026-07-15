import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from 'framer-motion';
import type { DashboardAnalytics } from '@inbox-concierge/shared';

// A single flat hue for this ranked single-series chart (dataviz skill's sequential blue,
// dark-surface step) — deliberately distinct from every bucket color so this chart is never
// mistaken for the volume-breakdown chart at a glance.
const SENDER_BAR_COLOR = '#3987e5';
const AXIS_COLOR = '#94a3b8';
const GRID_COLOR = '#1e293b';

/** "Top senders by volume" (build guide §6). Horizontal bar, sorted desc, top 8-10 — a single
 *  ranked series needs no legend (the title already names what's plotted). */
export function SenderFrequencyChart({ data }: { data: DashboardAnalytics['topSenders'] }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold text-slate-200">Top senders</h3>
      <div className="mt-3 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fill: AXIS_COLOR, fontSize: 12 }} stroke={GRID_COLOR} />
            <YAxis
              type="category"
              dataKey="senderLabel"
              width={120}
              tick={{ fill: AXIS_COLOR, fontSize: 12 }}
              stroke={GRID_COLOR}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              contentStyle={{ background: '#0f172a', border: `1px solid ${GRID_COLOR}`, borderRadius: 6 }}
              labelStyle={{ color: '#e2e8f0' }}
              itemStyle={{ color: '#cbd5e1' }}
            />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
              fill={SENDER_BAR_COLOR}
              isAnimationActive={!reduceMotion}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
