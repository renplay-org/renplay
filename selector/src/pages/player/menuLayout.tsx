// A prototype: three ways to lay out the player's menu, for Jan to try. Removed once one is chosen.
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cx } from '../../lantern/ui'

export type MenuLayout = 1 | 2 | 3
const LAYOUT_KEY = 'renplay:menu-layout'
const KEEP_KEY = 'renplay:keep-buttons'
const valid = (n: number): n is MenuLayout => n === 1 || n === 2 || n === 3

const stored = () => {
  try {
    const n = Number(localStorage.getItem(LAYOUT_KEY))
    return valid(n) ? n : 1
  } catch {
    return 1
  }
}

/** The layout: ?menu=1, 2 or 3 on the address, remembered in this browser. */
export function useMenuLayout(): [MenuLayout, (layout: MenuLayout) => void] {
  const [params, setParams] = useSearchParams()
  const fromUrl = Number(params.get('menu'))
  const [layout, setLayout] = useState<MenuLayout>(() => (valid(fromUrl) ? fromUrl : stored()))
  useEffect(() => {
    if (!valid(fromUrl)) return
    localStorage.setItem(LAYOUT_KEY, String(fromUrl))
    setLayout(fromUrl)
  }, [fromUrl])
  const choose = useCallback(
    (next: MenuLayout) => {
      localStorage.setItem(LAYOUT_KEY, String(next))
      setLayout(next)
      if (params.has('menu')) {
        const rest = new URLSearchParams(params)
        rest.delete('menu')
        setParams(rest, { replace: true })
      }
    },
    [params, setParams],
  )
  return [layout, choose]
}

/** Layout 3's choice to keep its buttons on the screen, kept in this browser. */
export function useKeepButtons(): [boolean, (keep: boolean) => void] {
  const [keep, setKeep] = useState(() => localStorage.getItem(KEEP_KEY) === '1')
  return [
    keep,
    (next) => {
      localStorage.setItem(KEEP_KEY, next ? '1' : '0')
      setKeep(next)
    },
  ]
}

/** Bottom right: Layout 1, 2, 3. On a narrow screen with the menu open it moves to the top, off the menu's buttons. */
export function LayoutSwitcher({ layout, onChange, up }: { layout: MenuLayout; onChange: (layout: MenuLayout) => void; up: boolean }) {
  return (
    <div className={cx('lay-sw', up && 'up')} role="group" aria-label="Menu layout">
      <span>Layout</span>
      {([1, 2, 3] as const).map((n) => (
        <button key={n} type="button" aria-pressed={n === layout} className={cx(n === layout && 'on')} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
    </div>
  )
}
