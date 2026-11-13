// PDF.js, loaded only when a PDF guide opens: this module is imported lazily, so none of it is in the library's first download.
import * as pdfjs from 'pdfjs-dist'
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

declare const __PDFJS_BASE__: string

pdfjs.GlobalWorkerOptions.workerSrc = worker

/** Opens a PDF. The fonts and decoders it may ask for are served with the library, so a guide reads offline too. */
export const openPdf = (url: string) =>
  pdfjs.getDocument({ url, standardFontDataUrl: `${__PDFJS_BASE__}standard_fonts/`, wasmUrl: `${__PDFJS_BASE__}wasm/` })

export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
