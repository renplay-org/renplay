import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Frame } from '../lantern/art'
import { useRoom } from '../lantern/Room'
import { Empty, Spinner, errorText } from '../lantern/ui'
import { api } from '../lib/api'
import type { ArtFormat } from '@shared/art'
import { duration, timeZone } from '../lib/format'
import type { HistoryPage } from '@shared/api'
import { Pill } from '../lantern/controls'
import BackLink from '../components/BackLink'

/** A length of time in seconds: "45m", "1h 20m". */
const length = (seconds: number) => (seconds < 60 ? 'Under a minute' : duration(seconds))

const STATUS: Record<string, string> = { playing: 'Playing', stalled: 'Stalled', dropped: 'Dropped', finished: 'Finished' }

/** Today, Yesterday, or the weekday and date. */
function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const date = new Date(y, m - 1, d)
  const today = new Date()
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - date.getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(y !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function Icon({ title, icon, nsfw }: { title: string; icon: ArtFormat | null; nsfw: boolean }) {
  return <Frame game={{ title, nsfw, art: icon ? { icon } : {} }} kind="sq" style={{ width: 44, height: 44, flex: 'none' }} />
}

/** Play history: totals, the sessions by day, and the time per game with ratings and statuses. No charts. */
export default function History() {
  useRoom({ game: null, quiet: true })
  const pages = useInfiniteQuery({
    queryKey: ['history'],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => api<HistoryPage>(`/api/history?days=14&tz=${encodeURIComponent(timeZone())}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.next,
  })
  if (pages.isPending) return <Spinner />
  if (pages.error) return <Empty title="Could not load your history">{errorText(pages.error)}</Empty>
  const first = pages.data.pages[0]!
  const days = pages.data.pages.flatMap((p) => p.days)
  if (!first.totals.sessions)
    return (
      <Empty title="Nothing played yet" action={<Link to="/" className="btn">Library</Link>}>
        Your play history fills in as you play. It counts the time a game is open and in front of you, and stops after 15 minutes without a tap, click or key.
      </Empty>
    )
  return (
    <div className="stack" style={{ gap: 32 }}>
      <header>
        <BackLink to="/account" />
        <h1 className="h1">History</h1>
        <p className="muted-2" style={{ marginTop: 8 }}>
          {length(first.totals.seconds)} in {first.totals.sessions} {first.totals.sessions === 1 ? 'session' : 'sessions'} across {first.totals.games} {first.totals.games === 1 ? 'game' : 'games'}
          {first.totals.since ? `, since ${new Date(first.totals.since).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.
        </p>
      </header>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <section className="stack" style={{ gap: 24 }}>
          {days.map((d) => (
            <div key={d.day}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <h2 className="h3">{dayLabel(d.day)}</h2>
                <span className="small muted tnum">{length(d.seconds)}</span>
              </div>
              <div className="list">
                {d.sessions.map((s) => (
                  <Link key={`${s.game}-${s.startedAt}`} to={`/game/${s.game}`} className="row" style={{ gap: 12, alignItems: 'center', minHeight: 'var(--hit)' }}>
                    <Icon title={s.title} icon={s.icon} nsfw={s.nsfw} />
                    <span className="grow" style={{ fontWeight: 600 }}>{s.title}</span>
                    <span className="small muted tnum">
                      {time(s.startedAt)} to {time(s.endedAt)}, {length(s.seconds)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {pages.hasNextPage && (
            <Pill onClick={() => void pages.fetchNextPage()} loading={pages.isFetchingNextPage}>
              Earlier days
            </Pill>
          )}
        </section>

        <section className="panel">
          <h2 className="h3" style={{ marginBottom: 10 }}>Time per game</h2>
          <div className="list">
            {first.games.map((g) => (
              <Link key={g.id} to={`/game/${g.id}`} className="row" style={{ gap: 12, alignItems: 'center', minHeight: 'var(--hit)' }}>
                <Icon title={g.title} icon={g.icon} nsfw={g.nsfw} />
                <span className="grow">
                  <span style={{ display: 'block', fontWeight: 600 }}>{g.title}</span>
                  <span className="xs muted">
                    {[g.playStatus ? STATUS[g.playStatus] : null, g.rating ? `${'★'.repeat(g.rating)}` : null, `${g.sessions} ${g.sessions === 1 ? 'session' : 'sessions'}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="small muted tnum">{length(g.seconds)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
