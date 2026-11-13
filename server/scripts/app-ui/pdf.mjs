// A small real PDF for the guide's checks: Letter pages with a heading and lines of 10 point Helvetica, which
// is not embedded, so PDF.js reads its standard font from the library's own files.
const pad = (n) => String(n).padStart(10, '0')

/** `pages` is how many pages, `lines` how many lines of body text on each. */
export function pdf(pages = 3, lines = 40) {
  const objects = []
  const add = (body) => objects.push(body) && objects.length
  const catalog = add('')
  const tree = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
  const kids = []
  for (let p = 1; p <= pages; p++) {
    let text = `BT /F2 20 Tf 54 730 Td (Chapter ${p}: the route of day ${p}) Tj ET\n`
    for (let i = 0; i < lines; i++) text += `BT /F1 10 Tf 54 ${700 - i * 14} Td (Choice ${p}.${i + 1}: talk to Diya, then Min-seo, and pick the second option.) Tj ET\n`
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}endstream`)
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`
  let out = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${pad(o)} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
