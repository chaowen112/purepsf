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

export function fetchSubzoneStats(params: { from?: string; to?: string; source?: 'URA' | 'HDB' } = {}) {
  const q = new URLSearchParams()
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  if (params.source) q.set('source', params.source)
  const qs = q.toString()
  return get<SubzoneFC>(`/api/subzones/stats${qs ? '?' + qs : ''}`)
}
