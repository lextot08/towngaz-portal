import { useState } from 'react'
import { downloadExcel, downloadPdf } from '../lib/exportTable'

const OUTLINE =
  'flex items-center gap-1.5 rounded-lg border border-(color:--border) bg-white px-3 py-2 text-brand-pine hover:bg-brand-light disabled:opacity-60'

function DownloadIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  )
}

// "Excel" and "PDF" buttons that download the table shown.
// getTable() returns the <table> element; title, subtitle and filename name the file.
export default function DownloadButtons({ getTable, title, subtitle, filename }) {
  const [busy, setBusy] = useState(false)

  const download = async (save) => {
    const table = getTable()
    if (!table) return
    setBusy(true)
    try {
      await save(table, { title, subtitle, filename })
    } catch (e) {
      window.alert(`The file could not be made: ${e.message}`)
    }
    setBusy(false)
  }

  return (
    <>
      <button className={OUTLINE} disabled={busy} onClick={() => download(downloadExcel)} title="Download as Excel">
        <DownloadIcon /> Excel
      </button>
      <button className={OUTLINE} disabled={busy} onClick={() => download(downloadPdf)} title="Download as PDF">
        <DownloadIcon /> PDF
      </button>
    </>
  )
}
