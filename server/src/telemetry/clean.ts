/** The longest message the report carries. */
const MAX = 200

/**
 * A path starts at a word with a slash, a backslash or a leading ~, and goes on over the words of
 * a folder or file name that has spaces, up to the file name with an extension, or the end of the line.
 */
function withoutPaths(line: string): string {
  let inPath = false
  return line.split(/(\s+)/).map((word) => {
    if (/^\s+$/.test(word)) return inPath ? '' : word
    const starts = !inPath && /[\\/]|^~/.test(word)
    if (starts) inPath = true
    const text = inPath ? (starts ? '<x>' : '') : word
    if (inPath && /\.[A-Za-z][A-Za-z0-9]{0,4}[.,;:)\]]*$/.test(word)) inPath = false
    return text
  }).join('')
}

/**
 * An error as the report may carry it: its first line, 200 characters at most, with what could
 * name a person, a place or a secret replaced by <x>: anything in quotes, addresses, paths, email
 * addresses, long numbers and long codes. What is left says what went wrong, not where.
 */
export function cleanError(text: unknown): string {
  let line = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''
  line = line
    .replace(/"[^"]*"|`[^`]*`|“[^”]*”|(?<!\w)'[^']*'(?!\w)|(?<!\w)‘[^’]*’(?!\w)/g, '<x>')
    // A quote that never closes hides the rest of the line.
    .replace(/["`“].*$|(?<!\w)['‘].*$/, '<x>')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '<x>')
    .replace(/\S+@\S+/g, '<x>')
  return withoutPaths(line).replace(/\d{7,}/g, '<x>').replace(/\b[A-Za-z0-9_-]{24,}\b/g, '<x>').slice(0, MAX)
}
