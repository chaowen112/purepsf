import { useEffect, useMemo, useState } from 'react'
import { fetchAgents, fetchAgentTowns, type AgentFilter, type AgentLeader } from '../api'

const PAGE_SIZE = 50

export default function AgentsView() {
  const [towns, setTowns] = useState<string[]>([])
  const [filter, setFilter] = useState<AgentFilter>({ sort: 'total' })
  const [rows, setRows] = useState<AgentLeader[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchAgentTowns().then(setTowns).catch(console.error) }, [])

  useEffect(() => {
    setLoading(true)
    fetchAgents({ ...filter, limit: PAGE_SIZE, offset })
      .then(({ rows, total }) => { setRows(rows); setTotal(total) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filter, offset])

  const update = (patch: Partial<AgentFilter>) => {
    setOffset(0)
    setFilter((f) => ({ ...f, ...patch }))
  }

  const pageInfo = useMemo(() => {
    if (total === 0) return '0 agents'
    const from = offset + 1
    const to = Math.min(offset + rows.length, total)
    return `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} agents`
  }, [offset, rows.length, total])

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* Filter bar */}
      <div className="border-b bg-white px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Town">
            <select
              value={filter.town ?? ''}
              onChange={(e) => update({ town: e.target.value || undefined })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            >
              <option value="">All towns</option>
              {towns.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Property type">
            <select
              value={filter.property_type ?? ''}
              onChange={(e) => update({ property_type: (e.target.value || undefined) as AgentFilter['property_type'] })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            >
              <option value="">Any</option>
              <option value="HDB">HDB</option>
              <option value="CONDOMINIUM">Condominium</option>
              <option value="EXECUTIVE CONDOMINIUM">EC</option>
              <option value="LANDED">Landed</option>
            </select>
          </Field>
          <Field label="Side">
            <select
              value={filter.represented ?? ''}
              onChange={(e) => update({ represented: (e.target.value || undefined) as AgentFilter['represented'] })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            >
              <option value="">Any</option>
              <option value="SELLER">Seller</option>
              <option value="BUYER">Buyer</option>
              <option value="LANDLORD">Landlord</option>
              <option value="TENANT">Tenant</option>
            </select>
          </Field>
          <Field label="From">
            <input
              type="month"
              value={filter.from?.slice(0, 7) ?? ''}
              onChange={(e) => update({ from: e.target.value ? `${e.target.value}-01` : undefined })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="To">
            <input
              type="month"
              value={filter.to?.slice(0, 7) ?? ''}
              onChange={(e) => update({ to: e.target.value ? `${e.target.value}-01` : undefined })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Sort by">
            <select
              value={filter.sort ?? 'total'}
              onChange={(e) => update({ sort: e.target.value as AgentFilter['sort'] })}
              className="rounded border border-slate-200 px-2 py-1 text-sm"
            >
              <option value="total">Total txns</option>
              <option value="hdb">HDB txns</option>
              <option value="condo">Condo txns</option>
              <option value="seller">Seller side</option>
              <option value="buyer">Buyer side</option>
            </select>
          </Field>
          <button
            onClick={() => { setFilter({ sort: 'total' }); setOffset(0) }}
            className="ml-auto text-xs text-blue-600 hover:underline"
          >Reset</button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Source: CEA Salesperson Property Transaction Records (data.gov.sg). Records are de-identified
          (no price, no address, month granularity). Volume reflects activity, not necessarily quality.
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-slate-500 shadow-sm">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Agent</th>
              <th className="px-3 py-2 text-left font-medium">Agency</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">HDB</th>
              <th className="px-3 py-2 text-right font-medium">Condo</th>
              <th className="px-3 py-2 text-right font-medium">EC</th>
              <th className="px-3 py-2 text-right font-medium">Landed</th>
              <th className="px-3 py-2 text-right font-medium">Seller</th>
              <th className="px-3 py-2 text-right font-medium">Buyer</th>
              <th className="px-3 py-2 text-right font-medium">Landlord</th>
              <th className="px-3 py-2 text-right font-medium">Tenant</th>
              <th className="px-3 py-2 text-left font-medium">Top towns</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={a.registration_no} className="border-t border-slate-100 hover:bg-white">
                <td className="px-3 py-1.5 text-slate-400 tabular-nums">{offset + i + 1}</td>
                <td className="px-3 py-1.5 text-slate-800">{a.name}</td>
                <td className="px-3 py-1.5 text-slate-600 truncate max-w-[200px]" title={a.estate_agent ?? ''}>
                  {a.estate_agent ?? '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{a.total_txns}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.hdb_count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.condo_count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.ec_count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.landed_count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.seller_count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.buyer_count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.landlord_count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.tenant_count}</td>
                <td className="px-3 py-1.5 text-slate-500 text-xs">
                  {a.top_towns?.slice(0, 3).join(', ') ?? ''}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-400">No matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      <div className="flex items-center justify-between border-t bg-white px-4 py-2 text-sm">
        <span className="text-slate-500">{loading ? 'Loading…' : pageInfo}</span>
        <div className="flex gap-2">
          <button
            disabled={offset === 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            className="rounded border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >Prev</button>
          <button
            disabled={offset + rows.length >= total || loading}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            className="rounded border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >Next</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  )
}
