import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/** The first screenful and each batch after it, in rows of the grid. */
const FIRST_ROWS = 5
const MORE_ROWS = 3

/** The grid's columns, from its own track list, so a batch is always whole rows. */
function columnsOf(grid: HTMLElement): number {
  return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length)
}

/** The layout's own column count (`--cols`), which the grids' tracks come from, before any grid is measured. */
export function layoutColumns(): number {
  return Math.max(1, Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cols'), 10) || 3)
}

/**
 * A grid that grows as you scroll to its end, in whole rows: the batch is the grid's column count times
 * a few rows, so no row is half full except the last of the list. The rows loaded are kept in the data
 * layer under `key` (the list and its filters), so coming back rebuilds them before the browser's
 * scroll is restored and the person is where they were, among the same tiles.
 *
 * Put `grid` on the grid element and `end` on an element right after it. `shown` is how many of the
 * list's `total` tiles to render.
 */
export function useGrowingGrid(key: string, total: number) {
  const qc = useQueryClient()
  const queryKey = ['rows', key]
  const { data: rows = FIRST_ROWS } = useQuery({ queryKey, queryFn: () => qc.getQueryData<number>(queryKey) ?? FIRST_ROWS, staleTime: Infinity, gcTime: 30 * 60_000 })
  // Until the grid is measured, the layout's own column count, which the grid's tracks come from.
  const [cols, setCols] = useState(layoutColumns)
  const [grid, grid$] = useState<HTMLElement | null>(null)
  const [end, end$] = useState<HTMLElement | null>(null)
  const shown = Math.min(total, rows * cols)
  const more = shown < total

  useEffect(() => {
    if (!grid) return
    const read = () => setCols(columnsOf(grid))
    read()
    const watch = new ResizeObserver(read)
    watch.observe(grid)
    return () => watch.disconnect()
  }, [grid])

  // Observing again after each batch asks again at once: a tall screen may still be inside the margin.
  useEffect(() => {
    if (!end || !more) return
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) qc.setQueryData(queryKey, rows + MORE_ROWS)
      },
      { rootMargin: '0px 0px 900px 0px' },
    )
    watch.observe(end)
    return () => watch.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, more, rows, cols, key])

  return { shown, more, grid: grid$, end: end$ }
}
