import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid, ResponsiveContainer, Line, LineChart,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  fetchSubzoneSummary, fetchSubzoneTransactions, fetchSubzoneTimeseries, fetchSubzoneAgents,
  type Agent, type PsfBucket, type SubzoneSummary, type SubzoneTransaction,
} from '../api'

type Props = { subzoneId: number; onClose: () => void }

type PType = '' | 'HDB' | 'CONDOMINIUM' | 'LANDED' | 'EXECUTIVE CONDOMINIUM'
type Side = '' | 'SELLER' | 'BUYER' | 'LANDLORD' | 'TENANT'

function fmtMonth(s: string) {
  const d = new Date(s + (s.length === 7 ? '-01' : ''))
  return d.toLocaleDateString('en-SG', { year: '2-digit', month: 'short' })
}

function fmtPrice(p: number) {
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(p >= 10_000_000 ? 1 : 2)}M`
  if (p >= 1_000) return `$${Math.round(p / 1_000)}K`
  return `$${p}`
}

export default function SubzonePanel({ subzoneId, onClose }: Props) {
  const [summary, setSummary] = useState<SubzoneSummary | null>(null)
  const [txns, setTxns] = useState<SubzoneTransaction[] | null>(null)
  const [series, setSeries] = useState<PsfBucket[] | null>(null)
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [propertyType, setPropertyType] = useState<PType>('')
  const [side, setSide] = useState<Side>('')

  useEffect(() => {
    setSummary(null); setTxns(null); setSeries(null); setAgents(null)
    Promise.all([
      fetchSubzoneSummary(subzoneId),
      fetchSubzoneTransactions(subzoneId, { limit: 200 }),
      fetchSubzoneTimeseries(subzoneId),
    ]).then(([s, t, ts]) => {
      setSummary(s); setTxns(t); setSeries(ts)
    }).catch((e) => console.error('subzone load', e))
  }, [subzoneId])

  useEffect(() => {
    fetchSubzoneAgents(subzoneId, {
      property_type: propertyType || undefined,
      represented: side || undefined,
      limit: 15,
    }).then(setAgents).catch((e) => console.error('agents', e))
  }, [subzoneId, propertyType, side])

  const chartData = useMemo(
    () => (series ?? []).map((b) => ({ ...b, x: new Date(b.month).getTime() })),
    [series],
  )

  return (
    <div className="flex h-full flex-col bg-white shadow-xl">
      {/* Header */}
      <div className="flex items-start justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-800 leading-tight truncate">
            {summary?.subzone_name ?? 'Loading…'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {summary?.planning_area ?? ''}{summary?.region ? ` · ${summary.region}` : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          className="ml-2 mt-0.5 text-slate-400 hover:text-slate-700 text-xl leading-none flex-shrink-0"
        >×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {summary && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Avg PSF" value={summary.avg_psf ? `$${summary.avg_psf.toLocaleString()}` : '—'} />
            <Stat label="Transactions" value={summary.transaction_count.toLocaleString()} />
            <Stat
              label="Range"
              value={summary.date_from && summary.date_to
                ? `${summary.date_from.slice(0, 4)}–${summary.date_to.slice(0, 4)}`
                : '—'}
            />
          </div>
        )}

        {/* PSF time series */}
        {chartData.length > 1 && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">
              Monthly avg PSF
            </h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="x" type="number" domain={['auto', 'auto']} scale="time"
                  tickFormatter={(v) => new Date(v).toLocaleDateString('en-SG', { year: '2-digit', month: 'short' })}
                  tick={{ fontSize: 10 }} tickCount={5}
                />
                <YAxis dataKey="avg_psf" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} width={52} />
                <Tooltip
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload
                    if (!d) return null
                    return (
                      <div className="rounded bg-white/90 px-2 py-1 text-xs shadow border border-slate-100">
                        <div>{fmtMonth(d.month)}</div>
                        <div className="font-medium">${d.avg_psf.toLocaleString()} PSF</div>
                        <div className="text-slate-400">{d.count} txns</div>
                      </div>
                    )
                  }}
                />
                <Line type="monotone" dataKey="avg_psf" stroke="#3b82f6" strokeWidth={1.6} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Agents */}
        <div>
          <h3 className="mb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">
            Top agents · {summary?.cea_town ?? summary?.planning_area ?? ''}
          </h3>
          <div className="flex gap-1.5 mb-2 flex-wrap">
            <Select value={propertyType} onChange={setPropertyType as (v: string) => void}
              options={[
                { v: '', l: 'Any type' },
                { v: 'HDB', l: 'HDB' },
                { v: 'CONDOMINIUM', l: 'Condo' },
                { v: 'EXECUTIVE CONDOMINIUM', l: 'EC' },
                { v: 'LANDED', l: 'Landed' },
              ]}
            />
            <Select value={side} onChange={setSide as (v: string) => void}
              options={[
                { v: '', l: 'Any side' },
                { v: 'SELLER', l: 'Seller' },
                { v: 'BUYER', l: 'Buyer' },
                { v: 'LANDLORD', l: 'Landlord' },
                { v: 'TENANT', l: 'Tenant' },
              ]}
            />
          </div>
          {agents == null ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : agents.length === 0 ? (
            <p className="text-xs text-slate-400">No CEA records match.</p>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-100">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Agent</th>
                    <th className="px-2 py-1.5 text-right font-medium">Txns</th>
                    <th className="px-2 py-1.5 text-left font-medium">Agency</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.registration_no} className="border-t border-slate-100">
                      <td className="px-2 py-1 text-slate-700">{a.name}</td>
                      <td className="px-2 py-1 text-right text-slate-700 tabular-nums">{a.total_txns}</td>
                      <td className="px-2 py-1 text-slate-500 truncate max-w-[150px]" title={a.estate_agent ?? ''}>
                        {a.estate_agent ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 text-[10px] text-slate-400">
            CEA data is planning-area level — ranking covers {summary?.cea_town ?? '…'}, not just this subzone.
          </p>
        </div>

        {/* Transactions */}
        {txns && txns.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">
              Recent transactions
            </h3>
            <div className="overflow-x-auto rounded border border-slate-100">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Date</th>
                    <th className="px-2 py-1.5 text-left font-medium">Project</th>
                    <th className="px-2 py-1.5 text-right font-medium">Price</th>
                    <th className="px-2 py-1.5 text-right font-medium">PSF</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.slice(0, 100).map((t) => (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="px-2 py-1 text-slate-700 whitespace-nowrap">{t.contract_date.slice(0, 7)}</td>
                      <td className="px-2 py-1 text-slate-700 truncate max-w-[140px]" title={t.project_name}>
                        {t.project_name}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-700 tabular-nums">{fmtPrice(t.price)}</td>
                      <td className="px-2 py-1 text-right text-slate-700 tabular-nums">
                        {t.psf != null ? `$${Math.round(t.psf).toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {txns.length > 100 && (
              <p className="mt-1 text-[10px] text-slate-400">
                showing 100 of {summary?.transaction_count.toLocaleString()} — total in subzone
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-50 px-2 py-2">
      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
      <div className="text-lg font-semibold text-slate-800">{value}</div>
    </div>
  )
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: Array<{ v: string; l: string }>
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
    >
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  )
}
