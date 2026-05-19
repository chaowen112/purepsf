import { useEffect, useMemo, useState } from 'react'
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

function fmtPrice(p: number) {
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(p >= 10_000_000 ? 1 : 2)}M`
  if (p >= 1_000) return `$${Math.round(p / 1_000)}K`
  return `$${p}`
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

        {/* Tenure / lease block */}
        <TenureBlock project={project} />

        {/* Official HDB block metadata */}
        <HDBMetadataBlock project={project} />

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

        {/* Transaction list */}
        {txns && txns.length > 0 && (
          <TransactionList txns={txns} projectName={project.name} />
        )}

        {/* Date range footer */}
        {txns && comp?.own.date_from && comp?.own.date_to && (
          <p className="text-xs text-slate-400">
            range · {comp.own.date_from.slice(0, 7)} – {comp.own.date_to.slice(0, 7)}
          </p>
        )}
      </div>
    </div>
  )
}

function TenureBlock({ project }: { project: ProjectSummary }) {
  if (!project.tenure_type) return null
  const tt = project.tenure_type
  const yr = project.lease_commence_year
  const rem = project.remaining_lease_years

  // For HDB, lease commencement ≈ TOP year (a BTO's lease starts on completion).
  // For URA, lease commencement is the *land* lease start — often years before
  // the building TOP. The free Data Service API doesn't expose real TOP year.
  const topLabel = project.source === 'HDB' ? 'TOP year' : 'Lease since'

  if (tt === 'Freehold') {
    return (
      <div className="rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2">
        <div className="text-xs text-emerald-700 font-medium uppercase tracking-wide">Freehold</div>
        <div className="text-xs text-slate-500 mt-0.5">No lease — owner holds the land in perpetuity.</div>
      </div>
    )
  }

  const remBand =
    rem == null ? 'text-slate-700' :
    rem < 60 ? 'text-amber-700' :
    rem < 30 ? 'text-red-700' :
    'text-slate-800'

  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{tt} lease</div>
        {rem != null && (
          <div className={`text-sm font-semibold tabular-nums ${remBand}`}>
            {rem} yrs left
          </div>
        )}
      </div>
      {yr != null && (
        <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-slate-400">{topLabel}</div>
            <div className="text-slate-700 tabular-nums">{yr}</div>
          </div>
          <div>
            <div className="text-slate-400">Expires</div>
            <div className="text-slate-700 tabular-nums">
              {yr + (tt === '999-year' ? 999 : 99)}
            </div>
          </div>
        </div>
      )}
      {project.source !== 'HDB' && (
        <p className="mt-1 text-[10px] text-slate-400">
          URA records land-lease commencement; building TOP can be 3–8 years later.
        </p>
      )}
    </div>
  )
}

function HDBMetadataBlock({ project }: { project: ProjectSummary }) {
  if (project.source !== 'HDB' || project.hdb_total_dwelling_units == null) return null

  const sold = project.hdb_sold_units ?? 0
  const rental = project.hdb_rental_units ?? 0
  const total = project.hdb_total_dwelling_units
  const unknown = Math.max(0, total - sold - rental)
  const mix = [
    sold > 0 ? `${sold.toLocaleString()} sold flats` : null,
    rental > 0 ? `${rental.toLocaleString()} public rental flats` : null,
    unknown > 0 ? `${unknown.toLocaleString()} other` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">HDB block metadata</div>
        {rental > 0 && (
          <div className="text-sm font-semibold text-slate-800">
            Public rental
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-slate-400">Completed</div>
          <div className="text-slate-700 tabular-nums">{project.hdb_year_completed ?? '—'}</div>
        </div>
        <div>
          <div className="text-slate-400">Floors</div>
          <div className="text-slate-700 tabular-nums">{project.hdb_max_floor_lvl ?? '—'}</div>
        </div>
        <div>
          <div className="text-slate-400">Units</div>
          <div className="text-slate-700 tabular-nums">{total.toLocaleString()}</div>
        </div>
      </div>
      {mix && <p className="mt-1 text-xs text-slate-500">{mix}</p>}
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

const INITIAL_ROWS = 50

function TransactionList({ txns, projectName }: { txns: Transaction[]; projectName: string }) {
  const [showAll, setShowAll] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const total = txns.length
  const rows = useMemo(
    () => (showAll ? txns : txns.slice(0, INITIAL_ROWS)),
    [txns, showAll],
  )
  const hidden = total - rows.length

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          Transactions
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{total} total</span>
          <button
            onClick={() => setModalOpen(true)}
            title="View full screen"
            className="text-slate-400 hover:text-slate-700 leading-none"
          >
            <ExpandIcon />
          </button>
        </div>
      </div>
      <CompactTable rows={rows} />
      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          Show {hidden} more
        </button>
      )}
      {modalOpen && (
        <TransactionModal
          txns={txns}
          projectName={projectName}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}

function CompactTable({ rows }: { rows: Transaction[] }) {
  const anyLease = rows.some((r) => r.remaining_lease_at_txn != null)
  return (
    <div className="overflow-x-auto rounded border border-slate-100">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Date</th>
            <th className="px-2 py-1.5 text-right font-medium">Area</th>
            <th className="px-2 py-1.5 text-right font-medium">Price</th>
            <th className="px-2 py-1.5 text-right font-medium">PSF</th>
            {anyLease && <th className="px-2 py-1.5 text-right font-medium" title="Years of lease remaining at the contract date">Lease@</th>}
            <th className="px-2 py-1.5 text-left font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const detail = [t.flat_type, t.floor_range, t.type_of_sale]
              .filter(Boolean).join(' · ')
            return (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-2 py-1 text-slate-700 whitespace-nowrap">
                  {t.contract_date.slice(0, 7)}
                </td>
                <td className="px-2 py-1 text-right text-slate-600 tabular-nums">
                  {t.area_sqm != null ? `${Math.round(t.area_sqm)}m²` : '—'}
                </td>
                <td className="px-2 py-1 text-right text-slate-700 tabular-nums">
                  {fmtPrice(t.price)}
                </td>
                <td className="px-2 py-1 text-right text-slate-700 tabular-nums">
                  {t.psf != null ? `$${Math.round(t.psf).toLocaleString()}` : '—'}
                </td>
                {anyLease && (
                  <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                    {t.remaining_lease_at_txn != null ? `${t.remaining_lease_at_txn}y` : '—'}
                  </td>
                )}
                <td className="px-2 py-1 text-slate-500 truncate max-w-[120px]" title={detail}>
                  {detail || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TransactionModal({
  txns, projectName, onClose,
}: { txns: Transaction[]; projectName: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-5xl flex-col rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{projectName}</h2>
            <p className="text-xs text-slate-500">{txns.length} transactions</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
            title="Close (Esc)"
          >×</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-slate-500 shadow-sm">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Area</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">PSF</th>
                <th className="px-3 py-2 text-right font-medium" title="Years of lease remaining at the contract date">Lease@</th>
                <th className="px-3 py-2 text-left font-medium">Floor</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Flat/Property</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">{t.contract_date}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600 tabular-nums">
                    {t.area_sqm != null ? `${t.area_sqm.toFixed(0)} m²` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-700 tabular-nums">
                    ${t.price.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-700 tabular-nums">
                    {t.psf != null ? `$${Math.round(t.psf).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-600 tabular-nums">
                    {t.remaining_lease_at_txn != null ? `${t.remaining_lease_at_txn}y` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{t.floor_range ?? '—'}</td>
                  <td className="px-3 py-1.5 text-slate-600">{t.type_of_sale ?? '—'}</td>
                  <td className="px-3 py-1.5 text-slate-600">{t.flat_type ?? t.property_type ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}
