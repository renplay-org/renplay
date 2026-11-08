import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Spinner } from '../components/ui'
import { DeviceAdultRow } from '../components/AdultLadder'
import { useRoom } from '../lantern/Room'
import { useAuth } from '../lib/auth'
import { useSystem } from '../lib/queries'
import { AboutPanel } from './settings/about'
import { BrowserSettings, KeepCache, LighterBackground } from './settings/browser'
import { CatalogPanel } from './settings/catalog'
import { DefaultsForEveryone } from './settings/defaults'
import { AdultGamesPanel, EnginesPanel, SignInOff } from './settings/general'
import { SavesPanel } from './settings/saves'
import { StoragePanel } from './settings/storage'

export default function Settings() {
  const { data } = useAuth()
  useRoom({ game: null, quiet: true })
  return data?.user.role === 'admin' ? <AdminSettings auth={data.auth} userName={data.user.name} /> : <BrowserSettings />
}

const SECTIONS: Array<[string, string]> = [
  ['general', 'General'],
  ['browser', 'This browser'],
  ['about', 'About'],
]

function AdminSettings({ auth, userName }: { auth: boolean; userName: string }) {
  const { data: sys, isLoading } = useSystem()
  const [section, setSection] = useState('general')
  if (isLoading || !sys) return <Spinner />
  return (
    <div>
      <h1 className="h1" style={{ marginBottom: 18 }}>Settings</h1>
      <div className="split">
        <nav className="side-nav" aria-label="Settings sections">
          <span className="grp">Server</span>
          {SECTIONS.map(([value, label]) => (
            <button key={value} onClick={() => setSection(value)} aria-current={section === value ? 'page' : undefined} className={section === value ? 'on' : ''}>
              {label}
            </button>
          ))}
          <span className="grp">People</span>
          <Link to="/settings/users">Users</Link>
          <Link to="/activity">Activity</Link>
        </nav>
        <div className="body stack" style={{ gap: 18 }}>
          <div className={section === 'general' ? 'stack' : 'hidden'} style={{ gap: 18 }}>
            {!auth && <SignInOff userName={userName} />}
            <AdultGamesPanel />
            <StoragePanel />
            <EnginesPanel />
            <SavesPanel />
            <CatalogPanel />
            <DefaultsForEveryone />
          </div>
          <section className={`${section === 'browser' ? '' : 'hidden'} panel stack`} style={{ gap: 14 }}>
            <h2 className="h3">This browser</h2>
            <LighterBackground />
            <KeepCache />
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <DeviceAdultRow />
            </div>
          </section>
          {section === 'about' && <AboutPanel />}
        </div>
      </div>
    </div>
  )
}
