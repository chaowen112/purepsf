import { Helmet } from 'react-helmet-async'
import AgentsView from '../components/AgentsView'

const SITE = 'https://purepsf.tet.sg'

export default function AgentsRoute() {
  return (
    <div className="flex-1 overflow-hidden">
      <Helmet>
        <title>Singapore property agent leaderboard · purePSF</title>
        <meta
          name="description"
          content="Find the most active Singapore property agents by town, HDB vs condo, seller vs buyer, and date range. Built from CEA Salesperson Property Transaction Records on data.gov.sg — 1.3M transactions, 32k+ agents."
        />
        <link rel="canonical" href={SITE + '/agents'} />
        <meta property="og:title" content="Singapore property agent leaderboard · purePSF" />
        <meta property="og:description" content="Rank agents by town, property type, transaction side." />
        <meta property="og:type" content="article" />
      </Helmet>
      <AgentsView />
    </div>
  )
}
