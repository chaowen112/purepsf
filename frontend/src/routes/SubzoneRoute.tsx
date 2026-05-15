import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import SubzonePanel from '../components/SubzonePanel'
import { fetchSubzoneSummary, type SubzoneSummary } from '../api'
import type { MapShellContext } from './MapShell'

const SITE = 'https://purepsf.tet.sg'

export default function SubzoneRoute() {
  const { id: idStr } = useParams<{ id: string; slug?: string }>()
  const navigate = useNavigate()
  const { setFlyTarget } = useOutletContext<MapShellContext>()
  const [summary, setSummary] = useState<SubzoneSummary | null>(null)
  const [notFound, setNotFound] = useState(false)

  const id = Number(idStr)

  useEffect(() => {
    if (!Number.isFinite(id)) return
    setSummary(null)
    setNotFound(false)
    fetchSubzoneSummary(id)
      .then(setSummary)
      .catch(() => setNotFound(true))
  }, [id])

  // Fly when summary becomes available — we don't get coords until then.
  useEffect(() => {
    if (!summary) return
    // SubzoneSummary doesn't carry lat/lng; SubzonePanel fetches its own.
    // We fly based on a centroid embedded in /api/search hits — for direct
    // URL loads, leave the map where it is unless the user clicks something.
    // (Skipping the auto-fly avoids a confusing camera jump on /z/:id deep-links.)
  }, [summary, setFlyTarget])

  if (notFound) {
    return <div className="flex h-full flex-col bg-white p-4 text-sm text-slate-500">Subzone not found.</div>
  }
  if (!summary) {
    return <div className="flex h-full flex-col bg-white p-4 text-sm text-slate-400">Loading…</div>
  }

  return (
    <>
      <SubzoneMeta summary={summary} />
      <SubzonePanel subzoneId={summary.id} onClose={() => navigate('/')} />
    </>
  )
}

function SubzoneMeta({ summary: s }: { summary: SubzoneSummary }) {
  const psf = s.avg_psf ? `avg PSF $${s.avg_psf.toLocaleString()}` : ''
  const range = s.date_from && s.date_to ? `${s.date_from.slice(0, 4)}–${s.date_to.slice(0, 4)}` : ''
  const title = `${s.subzone_name} property prices${s.planning_area ? ' · ' + s.planning_area : ''} | purePSF`
  const desc = [
    `${s.subzone_name} is a Singapore planning subzone${s.planning_area ? ` in ${s.planning_area}` : ''}${s.region ? `, ${s.region}` : ''}.`,
    `${s.transaction_count.toLocaleString()} property transactions`,
    psf,
    range,
  ].filter(Boolean).join(' · ')

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={`${SITE}/z/${s.id}`} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={desc} />
      <meta property="og:type" content="article" />
    </Helmet>
  )
}
