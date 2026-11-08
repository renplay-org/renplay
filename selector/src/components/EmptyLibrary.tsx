import { useAuth } from '../lib/auth'
import { useState } from 'react'
import DocsLink from './DocsLink'
import { Link } from 'react-router-dom'
import type { CatalogGame } from '@shared/api'
import { useContent, useSetInstallationLevel, useSystem } from '../lib/queries'
import type { AdultLevel } from '@shared/levels'
import { Frame } from '../lantern/art'
import { Pill, TagPill } from '../lantern/controls'
import { Button, errorText, useToast } from './ui'

/** A fresh install asks once which games it shows. Until then it uses the default, Shown. */
function ContentChoice() {
  const setInstallationLevel = useSetInstallationLevel()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const choose = async (mode: AdultLevel) => {
    setBusy(mode)
    try {
      await setInstallationLevel(mode)
    } catch (e) {
      toast(errorText(e), 'error')
      setBusy('')
    }
  }
  const options = [
    { mode: 'shown' as const, title: 'Every game, including adult games', hint: 'Adult games show with their pictures.' },
    { mode: 'blurred' as const, title: 'Adult games without pictures', hint: 'Adult games show, but Renplay never downloads their art.' },
    { mode: 'off' as const, title: 'Safe-for-work games only', hint: 'Adult games are hidden and cannot be installed.' },
  ]
  return (
    <section className="empty">
      <h1 className="h1">Which games should this Renplay show?</h1>
      <p className="lead" style={{ margin: '12px auto 0' }}>
        This applies to everyone who uses this Renplay. Each person can choose less for themselves. You can change it later in Settings.
      </p>
      <p style={{ marginTop: 16 }}>
        <DocsLink path="start-here/adult-games/">The three levels</DocsLink>
      </p>
      <div className="starters" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {options.map((option) => (
          <button key={option.mode} disabled={!!busy} onClick={() => void choose(option.mode)} className="panel" style={{ textAlign: 'left', minHeight: 44 }}>
            <h2 className="h3">{option.title}</h2>
            <p className="small muted" style={{ marginTop: 8 }}>{busy === option.mode ? 'Saving' : option.hint}</p>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function EmptyLibrary({ recipes }: { recipes: CatalogGame[] }) {
  const { data: system } = useSystem()
  const { data: content } = useContent()
  const starter = recipes.find((game) => game.free === true && !game.nsfw && game.engine === 'renpy' && ['verified', 'playable'].includes(game.releases[0]?.status ?? ''))
  const links = starter?.links ?? {}
  const developer = links.itch ?? links.website ?? links.steam
  const source = links.itch ? 'itch.io' : 'the developer'
  const admin = useAuth().data?.user.role === 'admin'
  if (!admin)
    return (
      <section className="empty">
        <h1 className="h1">Your library is empty.</h1>
        <p className="lead" style={{ marginTop: 12 }}>
          Ask an admin to add a game.
        </p>
      </section>
    )
  if (content && !content.installation.chosen) return <ContentChoice />
  return (
    <section className="empty">
      <h1 className="h1">Your library is empty.</h1>
      <p className="lead" style={{ margin: '12px auto 0' }}>
        Let us fix that. Start with a story, or add a game you already have.
      </p>
      {starter && (
        <div className="panel" style={{ marginTop: 26, display: 'flex', gap: 18, textAlign: 'left', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 110, flex: 'none' }}>
            <Frame game={starter} kind="grid" />
          </div>
          <div className="grow" style={{ minWidth: 220 }}>
            <p className="eyebrow">Start with a free game</p>
            <h2 className="h2" style={{ marginTop: 6 }}>{starter.title}</h2>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <TagPill tone="green">Free</TagPill>
              <TagPill>Safe for work</TagPill>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>{starter.summary}</p>
            <div className="actions" style={{ marginTop: 14 }}>
              {developer && (
                <Pill variant="p" href={developer} target="_blank" rel="noreferrer">
                  Get it on {source}
                </Pill>
              )}
              <Pill variant="s" to="/add">
                Upload the zip
              </Pill>
            </div>
          </div>
        </div>
      )}
      <div className="starters">
        <Link to="/add" className="panel" style={{ textAlign: 'left' }}>
          <h2 className="h3">Upload a game you have</h2>
          <p className="small muted" style={{ marginTop: 8 }}>
            Pick its normal PC download. Renplay prepares it for your browser.
          </p>
        </Link>
        <div className="panel" style={{ textAlign: 'left' }}>
          <h2 className="h3">Copy it to the server</h2>
          <p className="small muted" style={{ marginTop: 8 }}>
            Put downloads in the archives folder, then open Add games.
          </p>
          {system?.paths.archives && <code className="xs" style={{ display: 'block', marginTop: 10, overflowWrap: 'anywhere' }}>{system.paths.archives}</code>}
        </div>
      </div>
      <div className="actions" style={{ justifyContent: 'center', marginTop: 22 }}>
        <Pill variant="q" to="/catalog">
          Browse the catalog
        </Pill>
        <DocsLink path="guides/adding-games/">How to add games</DocsLink>
      </div>
    </section>
  )
}
