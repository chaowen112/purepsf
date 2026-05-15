import { useCallback, useState } from 'react'
import MapView, { type LayerMode } from './components/MapView'
import ProjectPanel from './components/ProjectPanel'
import SubzonePanel from './components/SubzonePanel'
import AgentsView from './components/AgentsView'
import { fetchProjects, type ProjectSummary } from './api'

type View = 'map' | 'agents'

export default function App() {
  const [view, setView] = useState<View>('map')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selected, setSelected] = useState<ProjectSummary | null>(null)
  const [selectedSubzoneId, setSelectedSubzoneId] = useState<number | null>(null)
  const [layerMode, setLayerMode] = useState<LayerMode>('markers')

  const handleBoundsChange = useCallback(async (bbox: [number, number, number, number]) => {
    try {
      const data = await fetchProjects(bbox)
      setProjects(data)
    } catch (e) {
      console.error('fetchProjects', e)
    }
  }, [])

  const handleSelect = useCallback((id: number) => {
    const p = projects.find((p) => p.id === id)
    if (p) {
      setSelected(p)
      setSelectedSubzoneId(null)
    }
  }, [projects])

  const handleSelectSubzone = useCallback((id: number) => {
    setSelectedSubzoneId(id)
    setSelected(null)
  }, [])

  const handleClose = useCallback(() => {
    setSelected(null)
    setSelectedSubzoneId(null)
  }, [])

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2.5 shadow-sm flex-shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-slate-800">purePSF</h1>
          <nav className="flex gap-1 text-sm">
            <NavBtn label="Map"    active={view === 'map'}    onClick={() => setView('map')} />
            <NavBtn label="Agents" active={view === 'agents'} onClick={() => setView('agents')} />
          </nav>
        </div>
        <p className="text-xs text-slate-400 truncate ml-3">
          Independent project · Data sourced from URA, HDB &amp; CEA under the{' '}
          <a
            className="underline"
            href="https://www.ura.gov.sg/ms/eservices/Maps/acceptance-grant-licence"
            target="_blank"
            rel="noreferrer"
          >
            Singapore Open Data Licence
          </a>
        </p>
      </header>
      <main className="flex flex-1 overflow-hidden">
        {view === 'agents' ? <AgentsView /> : (
        <>
        <div className={`relative flex-1 transition-all ${selected || selectedSubzoneId ? 'mr-[360px]' : ''}`}>
          <MapView
            projects={projects}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            onSelectSubzone={handleSelectSubzone}
            onBoundsChange={handleBoundsChange}
            layerMode={layerMode}
          />
          <LayerToggle value={layerMode} onChange={setLayerMode} />
        </div>
        {(selected || selectedSubzoneId) && (
          <aside className="absolute right-0 top-[52px] bottom-0 w-[360px] overflow-hidden border-l">
            {selected
              ? <ProjectPanel project={selected} onClose={handleClose} />
              : selectedSubzoneId
                ? <SubzonePanel subzoneId={selectedSubzoneId} onClose={handleClose} />
                : null}
          </aside>
        )}
        </>
        )}
      </main>
    </div>
  )
}

function NavBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1 ${active ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {label}
    </button>
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
