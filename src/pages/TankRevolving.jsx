import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'
import { todayString } from '../lib/dateUtils'
import { loadTankCounts, BORROWED_BRANCHES } from '../lib/tankCount'
import DateButton from '../components/DateButton'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const CARD = 'overflow-x-auto rounded-xl border border-(color:--border) bg-white'
const TABLE =
  'w-full min-w-[760px] border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5 [&_td]:text-center [&_th]:text-center'
const BRANCH_CELL = '!text-left font-semibold uppercase'
const TOTAL_ROW = 'bg-[#eef6f3] font-bold'

// "September 29, 2026"
const longDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
}

const shown = (n) => (n === null || n === undefined ? '' : n.toLocaleString('en-PH'))
// adds up numbers; empty when none of them is known yet
const sum = (list) => {
  const known = list.filter((n) => n !== null && n !== undefined)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0)
}

// Tanks Count: the REVOLVING tanks (filled F and empties E at each branch) on top, the BORROWED
// tanks below, and the OVERALL TOTAL (revolving + borrowed) per size = the tanks count.
// Staff pass their own branch (only its row is shown); the admin sees every branch.
// The numbers at the end of the chosen day: see src/lib/tankCount.js
export default function TankRevolving({ branch: ownBranch }) {
  const [date, setDate] = useState('') // '' means today
  const [sizes, setSizes] = useState([])
  const [counts, setCounts] = useState({}) // { "table:branch:size:f|e": number }
  const [message, setMessage] = useState('')

  const shownDate = date || todayString()

  const only = (list) => (ownBranch ? list.filter((b) => b.id === ownBranch) : list)
  const revolvingBranches = only(BRANCHES)
  const borrowedBranches = only(BORROWED_BRANCHES)

  useEffect(() => {
    const load = async () => {
      setMessage('')
      const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
      if (sizesResult.error) {
        setMessage(sizesResult.error.message)
        return
      }
      setSizes([...new Set(sizesResult.data.map((p) => p.size))])

      const { counts: next, error } = await loadTankCounts(
        shownDate,
        revolvingBranches.map((b) => b.id),
        ownBranch
      )
      if (error) setMessage(error.message)
      setCounts(next)
    }
    load()
  }, [shownDate, ownBranch])

  // a number of the tables; the borrowed E of a branch is 0 when no tank is out
  const value = (table, branchId, size, kind) => {
    const n = counts[`${table}:${branchId}:${size}:${kind}`]
    if (n !== undefined && n !== null) return n
    return table === 'borrowed' && kind === 'e' ? 0 : null
  }

  // totals of a table: per size and kind, and per size (F + E)
  const total = (table, list, size, kind) => sum(list.map((b) => value(table, b.id, size, kind)))
  const both = (table, list, size) =>
    sum([total(table, list, size, 'f'), total(table, list, size, 'e')])

  const sizeHeads = () => (
    <>
      <tr>
        <th rowSpan={2} className={`${BRANCH_CELL} w-48`}>Branch</th>
        {sizes.map((s) => (
          <th key={s} colSpan={2}>{s}</th>
        ))}
      </tr>
      <tr>
        {sizes.map((s) => (
          <FE key={s} />
        ))}
      </tr>
    </>
  )

  const branchRows = (table, list) =>
    list.map((b) => (
      <tr key={b.id}>
        <td className={BRANCH_CELL}>{b.name}</td>
        {sizes.map((s) => (
          <Pair key={s} f={value(table, b.id, s, 'f')} e={value(table, b.id, s, 'e')} />
        ))}
      </tr>
    ))

  const totalRow = (table, list) => (
    <tr className={TOTAL_ROW}>
      <td className="!text-right text-brand-red">TOTAL</td>
      {sizes.map((s) => (
        <Pair key={s} f={total(table, list, s, 'f')} e={total(table, list, s, 'e')} />
      ))}
    </tr>
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Tanks Count</h1>
          <p className="m-0 text-[14px] text-gray-500">
            {ownBranch ? branchName(ownBranch) : 'All branches'} · {longDate(shownDate)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateButton
            value={shownDate}
            onChange={(v) => setDate(!v || v === todayString() ? '' : v)}
          />
          <button className={OUTLINE} onClick={() => setDate('')}>Today</button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      {/* ---- REVOLVING ---- */}
      <h2 className="mt-0 mb-2 text-center text-[17px] font-bold tracking-wide">
        <span className="text-brand-pine">REVOLVING</span> TANKS COUNT
      </h2>
      <div className={`${CARD} mb-1`}>
        <table className={TABLE}>
          <thead>{sizeHeads()}</thead>
          <tbody>
            {branchRows('revolving', revolvingBranches)}
            {totalRow('revolving', revolvingBranches)}
            {/* filled + empties of each size */}
            <tr>
              <td className="!text-right text-[12px] text-gray-500">F + E</td>
              {sizes.map((s) => (
                <td key={s} colSpan={2} className="font-semibold text-brand-red">
                  {shown(both('revolving', revolvingBranches, s))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---- BORROWED ---- */}
      <h2 className="mt-5 mb-2 text-center text-[17px] font-bold tracking-wide">
        <span className="text-brand-red">BORROWED</span> TANKS
      </h2>
      <div className={CARD}>
        <table className={TABLE}>
          <thead>{sizeHeads()}</thead>
          <tbody>
            {borrowedBranches.length > 0 ? (
              branchRows('borrowed', borrowedBranches)
            ) : (
              <tr>
                <td colSpan={1 + sizes.length * 2} className="text-gray-500">
                  The truck has no borrowed tanks.
                </td>
              </tr>
            )}
            {totalRow('borrowed', borrowedBranches)}
            {/* the tanks count: revolving (F + E) + borrowed, per size */}
            <tr className="bg-[#fdf1e3] text-[15px] font-bold">
              <td className={BRANCH_CELL}>Overall Total</td>
              {sizes.map((s) => (
                <td key={s} colSpan={2} className="text-brand-red">
                  {shown(
                    sum([both('revolving', revolvingBranches, s), both('borrowed', borrowedBranches, s)])
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// the F and E headings under a size
function FE() {
  return (
    <>
      <th className="w-12 text-[11px] font-medium text-blue-700">F</th>
      <th className="w-12 text-[11px] font-medium text-blue-700">E</th>
    </>
  )
}

// the F and E cells of a size
function Pair({ f, e }) {
  return (
    <>
      <td className="bg-[#f4f8fd]">{shown(f)}</td>
      <td>{shown(e)}</td>
    </>
  )
}
