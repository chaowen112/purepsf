import { useCallback, useState } from 'react'
import MapView, { type LayerMode } from './components/MapView'
import ProjectPanel from './components/ProjectPanel'
import SubzonePanel from './components/SubzonePanel'
import { fetchProjects, type ProjectSummary } from './api'

export default function App() {
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
      <header className="border-b bg-white px-4 py-2.5 shadow-sm flex-shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-slate-800">purePSF</h1>
          <p className="text-xs text-slate-400">
            Independent project · Data sourced from URA &amp; HDB under the{' '}
            <a
              className="underline"
              href="https://www.ura.gov.sg/ms/eservices/Maps/acceptance-grant-licence"
              target="_blank"
              rel="noreferrer"
            >
              Singapore Open Data Licence
            </a>
          </p>
        </div>
      </header>
      <main className="flex flex-1 overflow-hidden">
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
      </main>
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
