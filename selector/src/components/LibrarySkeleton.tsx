import { layoutColumns } from '../lib/grow'
import './LibrarySkeleton.css'

/** What the Library last looked like on this device: with the Up next carousel above its grid, or the grid alone. */
const SHAPE = 'renplay:library-shape'
export const rememberShape = (stage: boolean) => {
  try {
    localStorage.setItem(SHAPE, stage ? 'stage' : 'plain')
  } catch {}
}

/** A tile: the picture's 2:3 and the two lines under it. */
const Tile = () => (
  <div className="card">
    <div className="skel" style={{ aspectRatio: '2/3', borderRadius: 'var(--r-tile)' }} />
    <div className="skel skel-line ct" style={{ width: '70%' }} />
    <div className="skel skel-line cm" style={{ width: '45%' }} />
  </div>
)

/** The stage: the poster, the text block and the two actions. */
const Stage = (
  <section className="stage">
    <div className="art hero-a skel" />
    <div className="art wide-a skel" />
    <div className="in">
      <div className="cover">
        <div className="skel" style={{ aspectRatio: '2/3', borderRadius: 'var(--r-tile)' }} />
      </div>
      <div className="tb skel-tb">
        <div className="in-t">
          <div className="skel skel-line" style={{ width: 70, height: 14 }} />
          <div className="skel skel-line" style={{ width: 'min(420px, 80%)', height: 40, marginTop: 10 }} />
        </div>
      </div>
      <div className="acts skel-acts">
        <div className="actions">
          <div className="skel" style={{ width: 150, height: 54, borderRadius: 999 }} />
          <div className="skel" style={{ width: 150, height: 54, borderRadius: 999 }} />
        </div>
      </div>
    </div>
  </section>
)

/**
 * The Library while its games load, in the shape of the loaded page: the carousel with its dots and
 * the grid with its toolbar, in the same sizes, so the page does not rearrange when the games arrive.
 */
export default function LibrarySkeleton() {
  const stage = localStorage.getItem(SHAPE) !== 'plain'
  const cols = layoutColumns()
  return (
    <div role="status" aria-label="Loading the library">
      {stage && (
        <>
          <div className="carousel-wrap">
            <div className="carousel">
              <div className="slide">{Stage}</div>
            </div>
            <div className="dots">
              {[0, 1, 2].map((i) => (
                <span key={i} className="dot" />
              ))}
            </div>
          </div>
        </>
      )}
      <section className="sec">
        <div className="sec-h" style={{ minHeight: 29 }}>
          <div className="skel skel-line" style={{ width: 130, height: 24 }} />
        </div>
        <div className="toolbar" style={{ position: 'static' }}>
          <div className="skel" style={{ flex: '1 1 200px', maxWidth: 360, height: 44, borderRadius: 999 }} />
          <div className="skel" style={{ width: 110, height: 44, borderRadius: 999, flex: 'none' }} />
        </div>
        <div className="count-line">
          <div className="skel skel-line" style={{ width: 70, height: 14 }} />
        </div>
        <div className="chip-bar" style={{ marginBottom: 16, minHeight: 48 }}>
          <div className="skel" style={{ width: 150, height: 40, borderRadius: 999 }} />
        </div>
        <div className="grid">
          {Array.from({ length: cols * 2 }, (_, i) => (
            <Tile key={i} />
          ))}
        </div>
      </section>
    </div>
  )
}
