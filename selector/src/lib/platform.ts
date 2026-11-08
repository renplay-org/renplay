// What kind of device and browser this is. Each check is written once, here.

/** An iPhone or iPad. iPadOS Safari says it is a Mac, so a Mac with touch counts too. */
export function isAppleTouch(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

/** A Mac computer: no touch, so not an iPad that says it is a Mac. */
export function isMacComputer(): boolean {
  return /Macintosh|Mac OS X/.test(navigator.userAgent) && navigator.maxTouchPoints <= 1
}

/** An Apple device, whose keyboard shortcuts use Command instead of Control. */
export function isApple(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) || isAppleTouch()
}

/** Phones and tablets: no hover, coarse pointer. */
export function isTouchDevice(): boolean {
  return matchMedia('(hover: none) and (pointer: coarse)').matches
}

/** Opened from the home screen (no browser bars). */
export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export type ComputerSystem = 'mac' | 'windows' | 'linux'

/** The computer's system, for where its save folder is, or null on a phone or tablet. */
export function computerSystem(): ComputerSystem | null {
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|android/.test(ua) || isAppleTouch()) return null
  const p = (((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || ua) as string).toLowerCase()
  return p.includes('mac') ? 'mac' : p.includes('win') ? 'windows' : p.includes('linux') ? 'linux' : null
}
