import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref, type RefObject } from 'react'
import type { Game } from '@shared/api'
import { IconBtn, Pill } from '../../lantern/controls'
import { Spinner } from '../../lantern/ui'
import type { PDFDocumentProxy } from '../../lib/pdfjs'
import { isTouchDevice } from '../../lib/platform'
import { keepFile, keepView, keptView, type Zoom } from './keep'
import PdfPage, { CSS_UNITS } from './PdfPage'
import { useGestures, type Focal } from './useGestures'

type Walkthrough = Game['walkthroughs'][number]

/** What the keyboard, the controller and the window's own buttons ask of the reader that is open. */
export interface ReaderHandle {
  scroll: (dx: number, dy: number) => void
  page: (step: 1 | -1) => void
  zoom: (step: 1 | -1) => void
  fit: () => void
  /** Fit, then 125 and 150 percent, and round again. */
  cycle: () => void
}

/** The space around the pages and between them, and the zoom's limits and step. */
const PAD = 8
const MIN = 0.25
const MAX = 5
const STEP = 1.25
const CYCLE: Zoom[] = ['fit', 1.25, 1.5]

type Size = [number, number]

/**
 * One file. A PDF is drawn by PDF.js, page under page, a picture is one page, and a text file is wrapped text.
 * Fit means the width of the window. On a phone a PDF opens at 100 percent, which is readable, and is panned.
 */
function DocReader({ w, handle }: { w: Walkthrough; handle: Ref<ReaderHandle | null> }) {
  const touch = useMemo(isTouchDevice, [])
  const kept = useMemo(() => keptView(w.file), [w.file])
  const view = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<Zoom>(kept.zoom ?? (w.kind === 'pdf' && touch ? 1 : 'fit'))
  const [page, setPage] = useState(kept.page)
  // Each page's size at 100 percent, in CSS pixels. Null until the first is known.
  const [sizes, setSizes] = useState<Size[] | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [text, setText] = useState<string | null>(null)
  // Every page's size is known: until then the rest are the first page's, so a place far down is not found yet.
  const [measured, setMeasured] = useState(false)
  const [failed, setFailed] = useState(false)
  const [width, setWidth] = useState(0)
  const touched = useRef(false)

  useEffect(() => {
    let stopped = false
    let task: { destroy: () => Promise<void> } | undefined
    const load = async () => {
      if (w.kind === 'text') {
        const answer = await fetch(w.url)
        if (!answer.ok) throw new Error('The file could not be read')
        const body = await answer.text()
        if (!stopped) setText(body)
      } else if (w.kind === 'image') {
        const img = new Image()
        img.src = w.url
        await img.decode()
        if (!stopped) {
          setSizes([[img.naturalWidth, img.naturalHeight]])
          setMeasured(true)
        }
      } else {
        // PDF.js is a download of its own, made only when a PDF guide opens.
        const { openPdf } = await import('../../lib/pdfjs')
        const opening = openPdf(w.url)
        task = opening
        const doc = await opening.promise
        const all: Size[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const v = (await doc.getPage(i)).getViewport({ scale: CSS_UNITS })
          if (stopped) return
          all.push([v.width, v.height])
          // The first page shows at once, then every page in turn: the rest take the first one's size until they are known.
          if (i === 1) {
            setPdf(doc)
            setSizes(Array.from({ length: doc.numPages }, () => [v.width, v.height]))
          } else if (i === doc.numPages || i % 25 === 0) setSizes([...all, ...Array.from({ length: doc.numPages - all.length }, () => all[0]!)])
          if (i === doc.numPages) setMeasured(true)
        }
      }
    }
    load().catch(() => !stopped && setFailed(true))
    return () => {
      stopped = true
      void task?.destroy()
    }
  }, [w.kind, w.url])

  // The width the pages fit to.
  useEffect(() => {
    const el = view.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [sizes, text])

  const first = sizes?.[0]?.[0] ?? 0
  // A small picture is not stretched to a window.
  const fit = first && width ? Math.max(MIN, Math.min(MAX, (width - 2 * PAD) / first, w.kind === 'image' ? 1 : MAX)) : 1
  const scale = zoom === 'fit' ? fit : Math.max(MIN, Math.min(MAX, zoom))
  const offsets = useMemo(() => {
    let y = PAD
    return (sizes ?? []).map((s) => {
      const top = y
      y += s[1] * scale + PAD
      return top
    })
  }, [sizes, scale])

  const remember = useRef({ page, zoom })
  remember.current = { page, zoom }
  useEffect(() => keepView(w.file, { page, zoom }), [w.file, page, zoom])

  // Zooming keeps the point under the fingers where it is: the share of the content before it is kept.
  const anchor = useRef<{ rx: number; ry: number; fx: number; fy: number } | null>(null)
  const zoomTo = useCallback((next: Zoom, at?: Focal) => {
    const el = view.current
    if (el) {
      const fx = at?.x ?? el.clientWidth / 2
      const fy = at?.y ?? el.clientHeight / 2
      anchor.current = { rx: (el.scrollLeft + fx) / el.scrollWidth, ry: (el.scrollTop + fy) / el.scrollHeight, fx, fy }
    }
    setZoom(next)
  }, [])
  useLayoutEffect(() => {
    const el = view.current
    const a = anchor.current
    if (!el || !a) return
    anchor.current = null
    el.scrollLeft = a.rx * el.scrollWidth - a.fx
    el.scrollTop = a.ry * el.scrollHeight - a.fy
  }, [scale])

  const scaleNow = useRef(scale)
  scaleNow.current = scale
  const zoomBy = useCallback((factor: number, at?: Focal) => zoomTo(Math.max(MIN, Math.min(MAX, scaleNow.current * factor)), at), [zoomTo])
  const toggle = useCallback((at?: Focal) => zoomTo(remember.current.zoom === 'fit' ? 1 : 'fit', at), [zoomTo])
  useGestures(view, content, () => scaleNow.current, zoomBy, toggle, w.kind !== 'text' && sizes !== null)

  const reading = useRef(0)
  const goTo = useCallback(
    (index: number) => {
      const n = Math.max(0, Math.min((sizes?.length ?? 1) - 1, index))
      if (view.current && offsets[n] !== undefined) view.current.scrollTop = offsets[n]! - PAD
      reading.current = n
      setPage(n)
    },
    [sizes, offsets],
  )
  // Back at the page it was left at, once every page is measured, unless the person has already moved on.
  const restored = useRef(false)
  useEffect(() => {
    // Once the window's width is known too, so that the places of the pages are the ones the pages will have.
    if (restored.current || !measured || !width || !view.current || !offsets.length) return
    restored.current = true
    if (!touched.current && kept.page > 0) goTo(kept.page)
  }, [measured, width, offsets, kept.page, goTo])

  // The page at the top third of the window is the one being read.
  const onScroll = () => {
    const el = view.current
    if (!el || !offsets.length) return
    const y = el.scrollTop + el.clientHeight / 3
    let n = 0
    while (n + 1 < offsets.length && offsets[n + 1]! <= y) n++
    reading.current = n
    setPage((p) => (p === n ? p : n))
  }

  const cycle = useCallback(() => zoomTo(CYCLE[(CYCLE.findIndex((z) => z === remember.current.zoom) + 1) % CYCLE.length]!), [zoomTo])
  const api: ReaderHandle = {
    scroll: (dx, dy) => view.current?.scrollBy({ left: dx, top: dy }),
    page: (step) => goTo(reading.current + step),
    zoom: (step) => zoomBy(step > 0 ? STEP : 1 / STEP),
    fit: () => zoomTo('fit'),
    cycle,
  }
  const apiNow = useRef(api)
  apiNow.current = api
  useImperativeHandle(handle, () => ({ scroll: (dx, dy) => apiNow.current.scroll(dx, dy), page: (s) => apiNow.current.page(s), zoom: (s) => apiNow.current.zoom(s), fit: () => apiNow.current.fit(), cycle: () => apiNow.current.cycle() }), [])

  const pages = sizes?.length ?? 0
  const body = failed ? (
    <div className="gr-note">
      <p className="small muted">This guide could not be shown.</p>
      <Pill variant="s" size="sm" href={w.url} target="_blank" rel="noopener">
        Open the file
      </Pill>
    </div>
  ) : w.kind === 'text' ? (
    text === null ? (
      <div className="gr-note">
        <Spinner />
      </div>
    ) : (
      <div ref={view} className="gr-view gr-text" tabIndex={0} aria-label={w.title}>
        <pre>{text}</pre>
      </div>
    )
  ) : !sizes ? (
    <div className="gr-note">
      <Spinner />
    </div>
  ) : (
    <div ref={view} className="gr-view" tabIndex={0} aria-label={w.title} onScroll={onScroll} onPointerDown={() => (touched.current = true)} onWheel={() => (touched.current = true)}>
      <div ref={content} className="gr-content" style={{ gap: PAD, padding: PAD }}>
        {sizes.map((s, i) =>
          pdf ? (
            <PdfPage key={i} pdf={pdf} index={i} width={s[0]} height={s[1]} scale={scale} root={view} />
          ) : (
            <div key={i} className="gr-page" style={{ width: s[0] * scale, height: s[1] * scale }}>
              <img src={w.url} alt={w.title} draggable={false} />
            </div>
          ),
        )}
      </div>
    </div>
  )
  return (
    <>
      {w.kind !== 'text' && !failed && (
        <div className="gr-bar" role="toolbar" aria-label="Reader">
          {w.kind === 'pdf' && (
            <>
              <IconBtn label="Previous page" onClick={() => api.page(-1)} disabled={page <= 0}>
                <ChevronLeft />
              </IconBtn>
              <span className="gr-count" role="status">
                {pages ? `${page + 1} of ${pages}` : ''}
              </span>
              <IconBtn label="Next page" onClick={() => api.page(1)} disabled={!pages || page >= pages - 1}>
                <ChevronRight />
              </IconBtn>
            </>
          )}
          <span className="grow" />
          <IconBtn label="Zoom out" onClick={() => api.zoom(-1)} disabled={scale <= MIN}>
            <ZoomOut />
          </IconBtn>
          <IconBtn label="Zoom in" onClick={() => api.zoom(1)} disabled={scale >= MAX}>
            <ZoomIn />
          </IconBtn>
          <Pill variant="s" size="sm" aria-pressed={zoom === 'fit'} onClick={() => api.fit()}>
            Fit
          </Pill>
        </div>
      )}
      {body}
    </>
  )
}

/** Arrow keys scroll, Page Up and Page Down turn pages, plus and minus zoom and 0 fits. Buttons keep their own keys. */
const keyed = (reader: ReaderHandle, e: ReactKeyboardEvent): boolean => {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('button, a')) return false
  const step = 48
  switch (e.key) {
    case 'ArrowUp':
      return reader.scroll(0, -step), true
    case 'ArrowDown':
      return reader.scroll(0, step), true
    case 'ArrowLeft':
      return reader.scroll(-step, 0), true
    case 'ArrowRight':
      return reader.scroll(step, 0), true
    case 'PageUp':
      return reader.page(-1), true
    case 'PageDown':
      return reader.page(1), true
    case '+':
    case '=':
      return reader.zoom(1), true
    case '-':
      return reader.zoom(-1), true
    case '0':
      return reader.fit(), true
  }
  return false
}

/**
 * The tabs of the walkthrough's files, when there are several, over the file itself. Fills the space it is given,
 * takes focus as a whole (`data-reader`) and answers the keys while it has it. `handle` is the reader for the
 * controller, and for the window's own buttons.
 */
export function GuideReader({ game, file, onFile, handle }: { game: Game; file: string; onFile: (file: string) => void; handle: RefObject<ReaderHandle | null> }) {
  const files = game.walkthroughs
  const current = files.find((w) => w.file === file) ?? files[0]
  if (!current) return null
  return (
    <div
      className="gr"
      tabIndex={-1}
      data-reader=""
      onKeyDown={(e) => {
        if (handle.current && keyed(handle.current, e)) e.preventDefault()
      }}
    >
      {files.length > 1 && (
        <div className="gw-tabs" role="tablist" aria-label="Walkthroughs">
          {files.map((w) => (
            <button key={w.file} type="button" role="tab" aria-selected={w.file === current.file} className={w.file === current.file ? 'on' : ''} onClick={() => (keepFile(game, w.file), onFile(w.file))}>
              {w.title}
            </button>
          ))}
        </div>
      )}
      <DocReader key={current.file} w={current} handle={handle} />
    </div>
  )
}
