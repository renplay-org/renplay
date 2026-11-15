import type { PDFDocumentProxy } from '../../lib/pdfjs'

/** Where the text is on a page, in CSS pixels at 100 percent from the page's left edge. */
export interface Column {
  left: number
  right: number
}

/** Pages read for the column: a guide's pages share one layout, and a long one need not be read through. */
const PAGES = 8
/** The room kept around the text, in CSS pixels. */
const MARGIN = 12
/** A column narrower than this share of the page is a page number or a caption, not a text column. */
const LEAST = 0.2

/**
 * The text column of a PDF: the union of its text items' boxes over the first pages, with a small margin. Null
 * when the pages have no text (a scan) or too little to be a column.
 */
export async function textColumn(doc: PDFDocumentProxy, scale: number): Promise<Column | null> {
  let left = Infinity
  let right = -Infinity
  let page = 0
  for (let i = 1; i <= Math.min(PAGES, doc.numPages); i++) {
    const p = await doc.getPage(i)
    const view = p.getViewport({ scale })
    page = Math.max(page, view.width)
    for (const item of (await p.getTextContent()).items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [a, , , , x, y] = item.transform as number[]
      // The item's two ends along the line, in the page's pixels.
      const [x0] = view.convertToViewportPoint(x!, y!)
      const [x1] = view.convertToViewportPoint(x! + item.width * Math.sign(a || 1), y!)
      left = Math.min(left, x0!, x1!)
      right = Math.max(right, x0!, x1!)
    }
  }
  if (!(right > left) || right - left < page * LEAST) return null
  return { left: Math.max(0, left - MARGIN), right: Math.min(page, right + MARGIN) }
}
