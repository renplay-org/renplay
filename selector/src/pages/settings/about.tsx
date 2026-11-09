import DocsLink from '../../components/DocsLink'
import { useSystem } from '../../lib/queries'

/** The version, the license and links. */
export function AboutPanel() {
  const { data: sys } = useSystem()
  if (!sys) return null
  return (
      <section className="panel stack" style={{ gap: 10 }}>
        <h2 className="h3">About Renplay</h2>
        <p className="small muted">Version {sys.version} · Made by the Renplay Team</p>
        <p className="small muted">Renplay is open source, under the MIT license. Game art belongs to its developers.</p>
        <div className="actions" style={{ gap: 16 }}>
          <DocsLink />
          <DocsLink path="troubleshooting/">Troubleshooting</DocsLink>
          <a className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="https://renplay.org/releases" target="_blank" rel="noreferrer">Release notes ↗</a>
          <a className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="https://renplay.org/github" target="_blank" rel="noreferrer">GitHub ↗</a>
          <a className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="https://renplay.org/support" target="_blank" rel="noreferrer">Support ↗</a>
          <a className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="https://github.com/renplay-org/renplay/blob/main/LICENSE" target="_blank" rel="noreferrer">License ↗</a>
        </div>
      </section>
  )
}
