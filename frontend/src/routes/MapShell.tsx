import { useCallback, useState } from 'react'
import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import MapView, { type LayerMode } from '../components/MapView'
import { fetchProjects, type ProjectSummary } from '../api'
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
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null)
  const projectMatch = useMatch('/p/:id/*')
  const subzoneMatch = useMatch('/z/:id/*')

  const handleBoundsChange = useCallback(async (bbox: [number, number, number, number]) => {
    try {
      setProjects(await fetchProjects(bbox))
    } catch (e) { console.error('fetchProjects', e) }
  }, [])

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

