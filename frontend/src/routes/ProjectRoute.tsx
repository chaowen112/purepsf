import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import ProjectPanel from '../components/ProjectPanel'
import { fetchProject, type ProjectSummary } from '../api'
import type { MapShellContext } from './MapShell'
import { slugify } from '../lib/slug'

const SITE = 'https://purepsf.tet.sg'

export default function ProjectRoute() {
  const { id: idStr } = useParams<{ id: string; slug?: string }>()
  const navigate = useNavigate()
  const { setFlyTarget } = useOutletContext<MapShellContext>()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [notFound, setNotFound] = useState(false)

  const id = Number(idStr)

  useEffect(() => {
    if (!Number.isFinite(id)) return
    setProject(null)
    setNotFound(false)
    fetchProject(id)
      .then((p) => {
        setProject(p)
        if (p.lat != null && p.lng != null) {
          setFlyTarget({ lng: p.lng, lat: p.lat, zoom: 16, nonce: Date.now() })
        }
      })
      .catch(() => setNotFound(true))
  }, [id, setFlyTarget])

  if (notFound) {
    return (
      <div className="flex h-full flex-col bg-white p-4 text-sm text-slate-500">
        Project not found.
      </div>
    )
  }
  if (!project) {
    return <div className="flex h-full flex-col bg-white p-4 text-sm text-slate-400">Loading…</div>
  }

  return (
    <>
      <ProjectMeta project={project} />
      <ProjectPanel project={project} onClose={() => navigate('/')} />
    </>
  )
}

function ProjectMeta({ project: p }: { project: ProjectSummary }) {
  const dateBits = p.latest_transaction ? `latest ${p.latest_transaction.slice(0, 7)}` : ''
  const psf = p.avg_psf ? `avg PSF $${p.avg_psf.toLocaleString()}` : ''
  const tenure = p.tenure_type === 'Freehold'
    ? 'freehold'
    : p.tenure_type && p.lease_commence_year
      ? `${p.tenure_type} from ${p.lease_commence_year}`
      : ''
  const addr = [p.street, p.postal_code ? `S(${p.postal_code})` : null].filter(Boolean).join(', ')

  const title = `${p.name} property transactions${p.district ? ` · D${p.district}` : ''} | purePSF`
  const desc = [
    `${p.name}${addr ? ' at ' + addr : ''}.`,
    `${p.transaction_count.toLocaleString()} recorded ${p.source} transactions`,
    psf,
    tenure,
    dateBits,
  ].filter(Boolean).join(' · ')

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={`${SITE}/p/${p.id}/${slugify(p.name)}`} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={desc} />
      <meta property="og:type" content="article" />
      <meta property="og:url" content={`${SITE}/p/${p.id}/${slugify(p.name)}`} />
    </Helmet>
  )
}
