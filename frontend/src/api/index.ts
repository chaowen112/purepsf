export type ProjectSummary = {
  id: number
  source: 'URA' | 'HDB'
  name: string
  street?: string
  postal_code?: string
  district?: string
  market_segment?: string
  property_type?: string
  lat?: number
  lng?: number
  transaction_count: number
  avg_psf?: number
  latest_transaction?: string
  tenure_type?: 'Freehold' | '99-year' | '999-year' | 'Other'
  lease_commence_year?: number
  remaining_lease_years?: number
}

export type Transaction = {
  id: number
  contract_date: string
  area_sqm?: number
  price: number
  psf?: number
  floor_range?: string
  property_type?: string
  type_of_sale?: string
  flat_type?: string
  no_of_units?: number
  remaining_lease_at_txn?: number
}

export type Comparison = {
  project_id: number
  own: { avg_psf?: number; count: number; date_from?: string; date_to?: string }
  nearby_500m: { avg_psf?: number; count: number; radius_m: number }
  premium_pct?: number
}

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

export function fetchProjects(bbox: [number, number, number, number]) {
  const [lng1, lat1, lng2, lat2] = bbox
  return get<ProjectSummary[]>(`/api/projects?bbox=${lng1},${lat1},${lng2},${lat2}`)
}

export function fetchProject(id: number) {
  return get<ProjectSummary>(`/api/projects/${id}`)
}

export function fetchTransactions(projectId: number) {
  return get<Transaction[]>(`/api/projects/${projectId}/transactions`)
}

export function fetchComparison(projectId: number) {
  return get<Comparison>(`/api/projects/${projectId}/comparison`)
}

export type SubzoneProperties = {
  id: number
  subzone_name: string
  planning_area: string
  region: string
  avg_psf: number | null
  count: number
}

import type { Geometry } from 'geojson'

export type SubzoneFC = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: Geometry
    properties: SubzoneProperties
  }>
}

export function fetchSubzoneStats(params: { from?: string; to?: string } = {}) {
  const q = new URLSearchParams()
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  const qs = q.toString()
  return get<SubzoneFC>(`/api/subzones/stats${qs ? '?' + qs : ''}`)
}

export type SubzoneSummary = {
  id: number
  subzone_name: string
  planning_area?: string
  region?: string
  avg_psf?: number
  transaction_count: number
  date_from?: string
  date_to?: string
  cea_town?: string
}

export type SubzoneTransaction = Transaction & {
  project_name: string
  source: 'URA' | 'HDB'
}

export type PsfBucket = { month: string; avg_psf: number; count: number }

export type Agent = {
  name: string
  registration_no: string
  estate_agent?: string
  total_txns: number
  hdb_pct: number
  condo_pct: number
  seller_pct: number
  buyer_pct: number
}

export function fetchSubzoneSummary(id: number) {
  return get<SubzoneSummary>(`/api/subzones/${id}`)
}

export function fetchSubzoneTransactions(id: number, opts: { limit?: number; offset?: number } = {}) {
  const q = new URLSearchParams()
  if (opts.limit) q.set('limit', String(opts.limit))
  if (opts.offset) q.set('offset', String(opts.offset))
  const qs = q.toString()
  return get<SubzoneTransaction[]>(`/api/subzones/${id}/transactions${qs ? '?' + qs : ''}`)
}

export function fetchSubzoneTimeseries(id: number) {
  return get<PsfBucket[]>(`/api/subzones/${id}/psf-timeseries`)
}

export type AgentLeader = {
  name: string
  registration_no: string
  estate_agent?: string
  total_txns: number
  hdb_count: number
  condo_count: number
  ec_count: number
  landed_count: number
  seller_count: number
  buyer_count: number
  landlord_count: number
  tenant_count: number
  top_towns: string[]
}

export type AgentFilter = {
  town?: string
  property_type?: 'HDB' | 'CONDOMINIUM' | 'EXECUTIVE CONDOMINIUM' | 'LANDED'
  represented?: 'SELLER' | 'BUYER' | 'LANDLORD' | 'TENANT'
  from?: string
  to?: string
  sort?: 'total' | 'hdb' | 'condo' | 'seller' | 'buyer'
  limit?: number
  offset?: number
}

export async function fetchAgents(opts: AgentFilter = {}): Promise<{ rows: AgentLeader[]; total: number }> {
  const q = new URLSearchParams()
  if (opts.town) q.set('town', opts.town)
  if (opts.property_type) q.set('property_type', opts.property_type)
  if (opts.represented) q.set('represented', opts.represented)
  if (opts.from) q.set('from', opts.from)
  if (opts.to) q.set('to', opts.to)
  if (opts.sort) q.set('sort', opts.sort)
  if (opts.limit) q.set('limit', String(opts.limit))
  if (opts.offset) q.set('offset', String(opts.offset))
  const qs = q.toString()
  const res = await fetch(BASE + `/api/agents${qs ? '?' + qs : ''}`)
  if (!res.ok) throw new Error(`${res.status}`)
  const total = Number(res.headers.get('X-Total-Count') ?? 0)
  const rows = (await res.json()) as AgentLeader[]
  return { rows, total }
}

export function fetchAgentTowns() {
  return get<string[]>('/api/agents/towns')
}

export type SearchHit = {
  type: 'project' | 'subzone'
  id: number
  label: string
  secondary: string
  lat?: number
  lng?: number
  source?: 'URA' | 'HDB'
}

export function fetchSearch(q: string, limit = 12) {
  if (!q.trim()) return Promise.resolve<SearchHit[]>([])
  return get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`)
}

export function fetchSubzoneAgents(id: number, opts: {
  property_type?: 'HDB' | 'CONDOMINIUM' | 'LANDED' | 'EXECUTIVE CONDOMINIUM'
  represented?: 'SELLER' | 'BUYER' | 'LANDLORD' | 'TENANT'
  from?: string; to?: string; limit?: number
} = {}) {
  const q = new URLSearchParams()
  if (opts.property_type) q.set('property_type', opts.property_type)
  if (opts.represented) q.set('represented', opts.represented)
  if (opts.from) q.set('from', opts.from)
  if (opts.to) q.set('to', opts.to)
  if (opts.limit) q.set('limit', String(opts.limit))
  const qs = q.toString()
  return get<Agent[]>(`/api/subzones/${id}/agents${qs ? '?' + qs : ''}`)
}
