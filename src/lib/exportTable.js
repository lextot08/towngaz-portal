// Download a table of the page as Excel (.xlsx) or PDF, laid out like the screen:
// the same columns, merged headings (colSpan / rowSpan) and numbers.
// A cell can give its own text with data-export="..."; elements marked data-export-skip
// (like the (!) of a new order) are left out.
// The libraries are loaded only when a file is downloaded, so the pages stay fast.

// the text of a cell, as shown on the screen
const cellText = (cell) => {
  if (cell.dataset.export !== undefined) return cell.dataset.export
  let node = cell
  if (cell.querySelector('[data-export-skip], input[type="checkbox"]')) {
    node = cell.cloneNode(true)
    node.querySelectorAll('[data-export-skip], input[type="checkbox"]').forEach((e) => e.remove())
  }
  const text = node === cell ? cell.innerText : node.textContent
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

// "₱1,285.00" -> 1285 (money), "1,234" -> 1234, "\u221220" -> -20; other text stays text
const toValue = (text) => {
  const t = text.replace(/\u2212/g, '-').trim()
  const m = /^(-?)(₱?)(-?)([\d,]+(\.\d+)?)$/.exec(t)
  if (!m) return { v: text }
  const n = Number(m[4].replace(/,/g, '')) * (m[1] || m[3] ? -1 : 1)
  return m[2] ? { v: n, money: true } : { v: n }
}

// The rows of a table: [{ head, cells: [{ text, colSpan, rowSpan }] }]
export function readTable(table) {
  return [...table.rows].map((row) => ({
    head: row.parentElement.tagName === 'THEAD',
    cells: [...row.cells].map((c) => ({ text: cellText(c), colSpan: c.colSpan || 1, rowSpan: c.rowSpan || 1 })),
  }))
}

const safeName = (name) => name.replace(/[\\/:*?"<>|]+/g, '-').trim()

export async function downloadExcel(table, { title, subtitle, filename }) {
  const XLSX = await import('xlsx')
  const rows = readTable(table)
  const top = [[title], [subtitle || ''], []] // the title above the table
  const start = top.length
  const grid = []
  const merges = []
  const taken = new Set() // cells covered by a merge from above

  rows.forEach((row, r) => {
    grid[r] ||= []
    let c = 0
    for (const cell of row.cells) {
      while (taken.has(`${r}:${c}`)) c++
      const value = toValue(cell.text)
      grid[r][c] = value.v === '' ? null : value.money ? { t: 'n', v: value.v, z: '"₱"#,##0.00' } : value.v
      if (cell.colSpan > 1 || cell.rowSpan > 1) {
        merges.push({ s: { r: start + r, c }, e: { r: start + r + cell.rowSpan - 1, c: c + cell.colSpan - 1 } })
        for (let dr = 0; dr < cell.rowSpan; dr++) {
          for (let dc = 0; dc < cell.colSpan; dc++) if (dr || dc) taken.add(`${r + dr}:${c + dc}`)
        }
      }
      c += cell.colSpan
    }
  })

  const sheet = XLSX.utils.aoa_to_sheet([...top, ...grid.map((r) => Array.from(r, (v) => v ?? null))])
  sheet['!merges'] = merges
  // column widths from the longest line in each column
  const width = []
  grid.forEach((r) =>
    r.forEach((v, c) => {
      const text = v && typeof v === 'object' ? String(v.v) + '00000' : String(v ?? '')
      const longest = Math.max(...text.split('\n').map((l) => l.length))
      width[c] = Math.min(Math.max(width[c] || 8, longest + 2), 50)
    })
  )
  sheet['!cols'] = width.map((w) => ({ wch: w || 8 }))

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Report')
  XLSX.writeFile(book, `${safeName(filename)}.xlsx`)
}

export async function downloadPdf(table, { title, subtitle, filename }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const rows = readTable(table)
  // the PDF font has no peso sign
  const pdfText = (t) => t.replace(/₱/g, 'PHP ').replace(/\u2212/g, '-')
  const toCells = (row) =>
    row.cells.map((c) => ({ content: pdfText(c.text), colSpan: c.colSpan, rowSpan: c.rowSpan }))

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFontSize(14)
  doc.text(pdfText(title), 40, 40)
  doc.setFontSize(10)
  doc.setTextColor(100)
  if (subtitle) doc.text(pdfText(subtitle), 40, 58)

  autoTable(doc, {
    startY: 72,
    head: rows.filter((r) => r.head).map(toCells),
    body: rows.filter((r) => !r.head).map(toCells),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, valign: 'middle', lineColor: [200, 214, 205], lineWidth: 0.5 },
    headStyles: { fillColor: [11, 68, 54], textColor: 255, halign: 'center' },
    margin: { left: 40, right: 40 },
  })
  doc.save(`${safeName(filename)}.pdf`)
}
