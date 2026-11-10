// An error message, cleaned again here because the sender is never trusted: its first line only, 200
// characters at most, with anything in quotes, URLs, paths, email addresses, IP addresses and numbers
// longer than 6 digits replaced by <x>.

const MAX = 200
const X = '<x>'

// A quote opens after something that is not a letter or digit, so an apostrophe in "doesn't" is not one.
const quoted = /(?<![\p{L}\p{N}])(?:'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)/gu
const url = /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi
const email = /\S+@\S+\.\S+/g
const ipv4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g
const longNumber = /\d{7,}/g
const windowsDrive = /\b[a-z]:[\\/]\S*/gi

/** Any word with a slash in it is a path, like /home/x/game/a.rpy, ~/saves, game/a.rpy or C:\Users\x. */
const path = (text: string) => text.replace(/\S+/g, (word) => (/[\\/]/.test(word) ? X : word))

export function cleanMessage(raw: string): string {
  const first = raw.split(/\r\n|\r|\n|\u2028|\u2029/, 1)[0] ?? ''
  const cleaned = path(
    first
      .replace(quoted, X)
      .replace(url, X)
      .replace(windowsDrive, X)
      .replace(email, X)
      .replace(ipv4, X)
      .replace(longNumber, X),
  )
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, MAX).trim()
}
