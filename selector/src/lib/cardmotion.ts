import { useSyncExternalStore } from 'react'

/*
 * Move cards with the pointer: game tiles lean toward the pointer and lift under it. On unless this browser turns it
 * off. Off, they behave as under reduced motion: the border, the glow and the sheen, with no lean and no lift. Reduced
 * motion turns the movement off whatever this says. The choice is kept in this browser, as the lighter background is.
 */
const KEY = 'renplay:card-motion'
const EVENT = 'renplay:card-motion'

function choice(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

/** Tile.css reads this on the page: with it set the tiles do not lean or lift. */
function apply(): void {
  if (choice()) delete document.documentElement.dataset['cards']
  else document.documentElement.dataset['cards'] = 'still'
}

export function setCardsMove(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, '0')
  } catch {}
  apply()
  dispatchEvent(new Event(EVENT))
}

/** Whether this browser lets cards move. Reduced motion is its own question (`reducedMotion`). */
export const cardsMove = choice

function subscribe(onChange: () => void): () => void {
  addEventListener(EVENT, onChange)
  addEventListener('storage', onChange)
  return () => {
    removeEventListener(EVENT, onChange)
    removeEventListener('storage', onChange)
  }
}

export function useCardsMove(): boolean {
  return useSyncExternalStore(subscribe, choice)
}

apply()
addEventListener('storage', apply)
