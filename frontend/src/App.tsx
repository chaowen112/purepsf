import { useCallback, useState } from 'react'
import MapView from './components/MapView'
import ProjectPanel from './components/ProjectPanel'
import { fetchProjects, type ProjectSummary } from './api'

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selected, setSelected] = useState<ProjectSummary | null>(null)

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
    if (p) setSelected(p)
  }, [projects])

  const handleClose = useCallback(() => setSelected(null), [])

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
        <div className={`flex-1 transition-all ${selected ? 'mr-[360px]' : ''}`}>
          <MapView
            projects={projects}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            onBoundsChange={handleBoundsChange}
          />
        </div>
        {selected && (
          <aside className="absolute right-0 top-[52px] bottom-0 w-[360px] overflow-hidden border-l">
            <ProjectPanel project={selected} onClose={handleClose} />
          </aside>
        )}
      </main>
    </div>
  )
}
