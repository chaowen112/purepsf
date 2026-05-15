import { useEffect, useState } from 'react'
import {
  CartesianGrid, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ReferenceLine,
} from 'recharts'
import { fetchComparison, fetchTransactions, type Comparison, type ProjectSummary, type Transaction } from '../api'

type Props = { project: ProjectSummary; onClose: () => void }

const SALE_COLORS: Record<string, string> = {
  'New Sale': '#3b82f6',
  'Sub Sale': '#f59e0b',
  'Resale': '#22c55e',
}

function dateToMs(d: string) {
  return new Date(d).getTime()
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-SG', { year: 'numeric', month: 'short' })
}

export default function ProjectPanel({ project, onClose }: Props) {
  const [txns, setTxns] = useState<Transaction[] | null>(null)
  const [comp, setComp] = useState<Comparison | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setTxns(null)
    setComp(null)
    Promise.all([
      fetchTransactions(project.id),
      fetchComparison(project.id),
    ]).then(([t, c]) => {
      setTxns(t)
      setComp(c)
    }).finally(() => setLoading(false))
  }, [project.id])

  const addrLine = [project.street, project.postal_code ? `S(${project.postal_code})` : null]
    .filter(Boolean).join(' · ')
  const tagBits = [
    project.district ? `D${project.district}` : null,
    project.market_segment,
  ].filter(Boolean)

  // Group by type_of_sale
  const byType = txns
    ? txns.reduce<Record<string, { x: number; y: number }[]>>((acc, t) => {
        if (t.psf == null) return acc
        const key = t.type_of_sale ?? t.flat_type ?? 'Other'
        ;(acc[key] ??= []).push({ x: dateToMs(t.contract_date), y: t.psf })
        return acc
      }, {})
    : {}

  const ownPsf = comp?.own.avg_psf
  const nearbyPsf = comp?.nearby_500m.avg_psf

  return (
    <div className="flex h-full flex-col bg-white shadow-xl">
      {/* Header */}
      <div className="flex items-start justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-800 leading-tight truncate">{project.name}</h2>
          {addrLine && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{addrLine}</p>
          )}
          <div className="flex gap-1.5 mt-1 flex-wrap">
            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
              project.source === 'URA' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
            }`}>
              {project.source}
            </span>
            {project.property_type && (
              <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {project.property_type}
              </span>
            )}
            {tagBits.map((t) => (
              <span key={t!} className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {t}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={onClose}
          className="ml-2 mt-0.5 text-slate-400 hover:text-slate-700 text-xl leading-none flex-shrink-0"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {loading && <p className="text-sm text-slate-400">Loading…</p>}

        {/* Comparison stats */}
        {comp && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Own avg PSF" value={ownPsf ? `$${ownPsf.toLocaleString()}` : '—'} />
            <Stat
              label="Nearby 500m"
              value={nearbyPsf ? `$${nearbyPsf.toLocaleString()}` : '—'}
              sub={nearbyPsf ? `${comp.nearby_500m.count} txns` : undefined}
            />
            <Stat
              label="Premium"
              value={comp.premium_pct != null ? `${comp.premium_pct > 0 ? '+' : ''}${comp.premium_pct.toFixed(1)}%` : '—'}
              accent={comp.premium_pct != null ? (comp.premium_pct > 0 ? 'text-red-500' : 'text-green-500') : undefined}
            />
          </div>
        )}

        {/* PSF scatter plot */}
        {txns && txns.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">
              PSF by Transaction Date
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['auto', 'auto']}
                  scale="time"
                  tickFormatter={fmtDate}
                  tick={{ fontSize: 10 }}
                  tickCount={5}
                />
                <YAxis
                  dataKey="y"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `$${v}`}
                  width={52}
                />
                <Tooltip
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload
                    if (!d) return null
                    return (
                      <div className="rounded bg-white/90 px-2 py-1 text-xs shadow border border-slate-100">
                        <div>{fmtDate(d.x)}</div>
                        <div className="font-medium">${d.y.toLocaleString()} PSF</div>
                      </div>
                    )
                  }}
                />
                {ownPsf && (
                  <ReferenceLine y={ownPsf} stroke="#94a3b8" strokeDasharray="4 2"
                    label={{ value: 'avg', position: 'insideTopRight', fontSize: 10, fill: '#94a3b8' }} />
                )}
                {nearbyPsf && (
                  <ReferenceLine y={nearbyPsf} stroke="#f97316" strokeDasharray="4 2"
                    label={{ value: '500m', position: 'insideTopRight', fontSize: 10, fill: '#f97316' }} />
                )}
                {Object.entries(byType).map(([type, data]) => (
                  <Scatter
                    key={type}
                    name={type}
                    data={data}
                    fill={SALE_COLORS[type] ?? '#8b5cf6'}
                    opacity={0.65}
                    r={3}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-1">
              {Object.entries(byType).map(([type]) => (
                <div key={type} className="flex items-center gap-1 text-xs text-slate-500">
                  <span className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: SALE_COLORS[type] ?? '#8b5cf6' }} />
                  {type}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transaction count footer */}
        {txns && (
          <p className="text-xs text-slate-400">
            {txns.length} transactions · {comp?.own.date_from?.slice(0, 7)} – {comp?.own.date_to?.slice(0, 7)}
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div className="rounded bg-slate-50 px-2 py-2">
      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
      <div className={`text-lg font-semibold ${accent ?? 'text-slate-800'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  )
}
