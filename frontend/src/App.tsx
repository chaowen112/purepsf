import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import SearchBox from './components/SearchBox'
import MapShell from './routes/MapShell'
import ProjectRoute from './routes/ProjectRoute'
import SubzoneRoute from './routes/SubzoneRoute'
import AgentsRoute from './routes/AgentsRoute'
import { slugify } from './lib/slug'
import type { SearchHit } from './api'

const SITE = 'https://purepsf.tet.sg'

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()

  const handleSearchPick = (hit: SearchHit) => {
    const slug = slugify(hit.label)
    if (hit.type === 'subzone') {
      navigate(`/z/${hit.id}/${slug}`)
    } else {
      navigate(`/p/${hit.id}/${slug}`)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Default site-wide head; route components override per-page. */}
      <Helmet>
        <title>purePSF — Singapore property transaction map (URA + HDB)</title>
        <meta
          name="description"
          content="Explore real Singapore property transaction prices from URA private sales and HDB resale on an interactive map. PSF charts, subzone comparisons, lease info, and agent activity — sourced from data.gov.sg under the Singapore Open Data Licence."
        />
        <link rel="canonical" href={SITE + location.pathname} />
        <meta property="og:title" content="purePSF — Singapore transaction map" />
        <meta property="og:description" content="Real transaction prices, mapped. URA + HDB, 1990 to today." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={SITE + location.pathname} />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>

      <header className="flex items-center justify-between border-b bg-white px-4 py-2.5 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-lg font-semibold text-slate-800 hover:text-slate-900">purePSF</Link>
          <nav className="flex gap-1 text-sm">
            <NavBtn to="/" label="Map" end />
            <NavBtn to="/agents" label="Agents" />
          </nav>
          <SearchBox onPick={handleSearchPick} />
        </div>
        <p className="text-xs text-slate-400 truncate ml-3">
          Independent project · Data sourced from URA, HDB &amp; CEA under the{' '}
          <a
            className="underline"
            href="https://www.ura.gov.sg/ms/eservices/Maps/acceptance-grant-licence"
            target="_blank"
            rel="noreferrer"
          >Singapore Open Data Licence</a>
        </p>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<MapShell />}>
            <Route index element={null} />
            <Route path="p/:id" element={<ProjectRoute />} />
            <Route path="p/:id/:slug" element={<ProjectRoute />} />
            <Route path="z/:id" element={<SubzoneRoute />} />
            <Route path="z/:id/:slug" element={<SubzoneRoute />} />
          </Route>
          <Route path="/agents" element={<AgentsRoute />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  )
}

function NavBtn({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded px-3 py-1 ${isActive ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`
      }
    >
      {label}
    </NavLink>
  )
}

function NotFound() {
  return (
    <div className="flex h-full w-full items-center justify-center text-slate-500">
      <Helmet><title>Not found · purePSF</title></Helmet>
      <div className="text-center">
        <p className="text-lg">Page not found.</p>
        <Link className="text-blue-600 underline text-sm" to="/">Back to the map</Link>
      </div>
    </div>
  )
}
