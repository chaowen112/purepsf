import { useCallback, useState } from 'react'
import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import MapView, { type LayerMode } from '../components/MapView'
import { fetchProjects, type ProjectFilters, type ProjectSummary } from '../api'
import { slugify } from '../lib/slug'

export type FlyTarget = { lng: number; lat: number; zoom?: number; nonce: number }

// MapShell stays mounted across panel route changes (/p/:id, /z/:id) so the
// MapLibre instance + tile cache survive. Outlet renders the side panel.
//
// Side panels broadcast their "fly to me" target through this shell via a
// callback exposed on Outlet context (see ProjectRoute / SubzoneRoute).
export default function MapShell() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [layerMode, setLayerMode] = useState<LayerMode>('markers')
  const [filters, setFilters] = useState<ProjectFilters>({})
  const [lastBbox, setLastBbox] = useState<[number, number, number, number] | null>(null)
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null)
  const projectMatch = useMatch('/p/:id/*')
  const subzoneMatch = useMatch('/z/:id/*')

  const handleBoundsChange = useCallback(async (bbox: [number, number, number, number]) => {
    setLastBbox(bbox)
    try {
      setProjects(await fetchProjects(bbox, filters))
    } catch (e) { console.error('fetchProjects', e) }
  }, [filters])

  const handleFiltersChange = useCallback(async (next: ProjectFilters) => {
    setFilters(next)
    if (!lastBbox) return
    try {
      setProjects(await fetchProjects(lastBbox, next))
    } catch (e) { console.error('fetchProjects', e) }
  }, [lastBbox])

  const handleSelectMarker = useCallback((id: number) => {
    const p = projects.find((x) => x.id === id)
    navigate(`/p/${id}${p ? '/' + slugify(p.name) : ''}`)
  }, [projects, navigate])

  const handleSelectSubzone = useCallback((id: number) => {
    navigate(`/z/${id}`)
  }, [navigate])

  // Track current selection from URL for marker highlight.
  const selectedProjectId = projectMatch ? Number(projectMatch.params.id) : null
  const panelOpen = !!(projectMatch || subzoneMatch)

  return (
    <>
      <div className={`relative flex-1 transition-all ${panelOpen ? 'mr-[360px]' : ''}`}>
        <MapView
          projects={projects}
          selectedId={selectedProjectId}
          onSelect={handleSelectMarker}
          onSelectSubzone={handleSelectSubzone}
          onBoundsChange={handleBoundsChange}
          layerMode={layerMode}
          flyTarget={flyTarget}
        />
        <LayerToggle value={layerMode} onChange={setLayerMode} />
        <ProjectFilterBar value={filters} onChange={handleFiltersChange} />
      </div>
      {panelOpen && (
        <aside className="absolute right-0 top-[52px] bottom-0 w-[360px] overflow-hidden border-l">
          <Outlet context={{ setFlyTarget } satisfies MapShellContext} />
        </aside>
      )}
    </>
  )
}

export type MapShellContext = {
  setFlyTarget: (t: FlyTarget) => void
}

function ProjectFilterBar({ value, onChange }: { value: ProjectFilters; onChange: (next: ProjectFilters) => void }) {
  function update(patch: Partial<ProjectFilters>) {
    const next = { ...value, ...patch }
    Object.keys(next).forEach((key) => {
      const k = key as keyof ProjectFilters
      if (next[k] == null) delete next[k]
    })
    onChange(next)
  }

  return (
    <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-128px)] flex-wrap gap-2 rounded-md bg-white/95 p-2 text-xs shadow">
      <select
        value={value.property_type ?? ''}
        onChange={(e) => update({ property_type: (e.target.value || undefined) as ProjectFilters['property_type'] })}
        className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700"
        aria-label="Property type"
      >
        <option value="">All types</option>
        <option value="condo">Condo/Apt</option>
        <option value="hdb">HDB</option>
        <option value="ec">EC</option>
        <option value="landed">Landed</option>
      </select>
      <select
        value={value.top_after ?? ''}
        onChange={(e) => update({ top_after: e.target.value ? Number(e.target.value) : undefined })}
        className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700"
        aria-label="TOP or lease after"
      >
        <option value="">Any TOP</option>
        <option value="2010">TOP after 2010</option>
        <option value="2015">TOP after 2015</option>
        <option value="2020">TOP after 2020</option>
        <option value="2024">TOP after 2024</option>
      </select>
      <select
        value={value.min_price ?? ''}
        onChange={(e) => update({ min_price: e.target.value ? Number(e.target.value) : undefined })}
        className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700"
        aria-label="Minimum average transaction price"
      >
        <option value="">No min price</option>
        <option value="500000">Min $500K</option>
        <option value="1000000">Min $1M</option>
        <option value="2000000">Min $2M</option>
        <option value="3000000">Min $3M</option>
      </select>
      <select
        value={value.max_price ?? ''}
        onChange={(e) => update({ max_price: e.target.value ? Number(e.target.value) : undefined })}
        className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700"
        aria-label="Maximum average transaction price"
      >
        <option value="">No max price</option>
        <option value="700000">Max $700K</option>
        <option value="1000000">Max $1M</option>
        <option value="1500000">Max $1.5M</option>
        <option value="2000000">Max $2M</option>
        <option value="3000000">Max $3M</option>
        <option value="5000000">Max $5M</option>
      </select>
    </div>
  )
}

function LayerToggle({ value, onChange }: { value: LayerMode; onChange: (m: LayerMode) => void }) {
  const opts: Array<{ key: LayerMode; label: string }> = [
    { key: 'markers', label: 'Markers' },
    { key: 'subzones', label: 'Subzone PSF' },
  ]
  return (
    <div className="absolute right-3 top-3 z-10 inline-flex rounded-md bg-white/95 shadow text-xs">
      {opts.map((o, i) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-3 py-1.5 ${i > 0 ? 'border-l border-slate-200' : ''} ${
            value === o.key ? 'font-semibold text-slate-800' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
