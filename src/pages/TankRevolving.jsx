import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'
import { todayString } from '../lib/dateUtils'
import DateButton from '../components/DateButton'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const PANEL =
  'h-[calc(100vh-260px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'
const TABLE =
  'w-full min-w-[800px] border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_td]:text-center [&_th]:text-center'

const OVERALL = 0

// the numbers of one size; for "All branches" they are added up
const FIELDS = ['beginning', 'incoming', 'refill', 'sold', 'filled', 'empty', 'total']

// Tank Count > Revolving (admin): the cylinders of a day, from the Stock Inventory.
// FILLED: Beginning + Incoming + Refill - Sold = Ending. EMPTIES: the Ending of the EMPTIES.
// Total cylinders = Filled Ending + Empties Ending. No numbers are typed here.
export default function TankRevolving() {
  const [branch, setBranch] = useState(OVERALL)
  const [date, setDate] = useState('') // '' means today
  const [rows, setRows] = useState([])
  const [message, setMessage] = useState('')

  const shownDate = date || todayString()

  const load = async () => {
    setMessage('')
    // the day runs from midnight to midnight in this device's local time
    const from = new Date(`${shownDate}T00:00:00`)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)

    const ids = branch === OVERALL ? BRANCHES.map((b) => b.id) : [branch]
    const results = await Promise.all(
      ids.map(async (id) => {
        const [filled, empties] = await Promise.all([
          supabase.rpc('inventory_report', {
            p_branch: id,
            p_from: from.toISOString(),
            p_to: to.toISOString(),
          }),
          supabase.rpc('empties_report', { p_branch: id, p_day: shownDate }),
        ])
        return { filled, empties }
      })
    )
    const failed = results.find((r) => r.filled.error || r.empties.error)
    if (failed) {
      setMessage((failed.filled.error || failed.empties.error).message)
      return
    }

    // add up the branches, size by size (in the order of the Stock Inventory)
    const bySize = new Map()
    const row = (size) => {
      if (!bySize.has(size)) {
        bySize.set(size, { size, ...Object.fromEntries(FIELDS.map((f) => [f, 0])) })
      }
      return bySize.get(size)
    }
    results.forEach(({ filled, empties }) => {
      ;(filled.data || []).forEach((x) => {
        const t = row(x.size)
        t.beginning += Number(x.beginning) || 0
        t.incoming += Number(x.incoming) || 0
        t.refill += Number(x.refill) || 0
        t.sold += Number(x.sold) || 0
        t.filled += Number(x.ending) || 0
      })
      ;(empties.data || []).forEach((x) => {
        row(x.size).empty += Number(x.ending) || 0
      })
    })
    bySize.forEach((t) => (t.total = t.filled + t.empty))
    setRows([...bySize.values()])
  }

  useEffect(() => {
    load()
  }, [branch, shownDate])

  const total = (field) => rows.reduce((sum, r) => sum + r[field], 0)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Tank Count - Revolving</h1>
          <p className="m-0 text-[14px] text-gray-500">
            {branch === OVERALL ? 'All branches' : branchName(branch)} · {shownDate}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={branch} onChange={(e) => setBranch(Number(e.target.value))}>
            <option value={OVERALL}>All branches</option>
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <DateButton
            value={shownDate}
            onChange={(v) => setDate(!v || v === todayString() ? '' : v)}
          />
          <button className={OUTLINE} onClick={() => setDate('')}>Today</button>
          <button className={OUTLINE} onClick={load}>Refresh</button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <div className={PANEL}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th rowSpan={2}>Size</th>
              <th colSpan={5}>Filled</th>
              <th rowSpan={2}>Empties</th>
              <th rowSpan={2}>Total cylinders</th>
            </tr>
            <tr>
              <th>Beginning</th>
              <th>Incoming</th>
              <th>Refill</th>
              <th>Sold</th>
              <th>Ending</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.size}>
                <td className="font-semibold">{r.size}</td>
                <td>{r.beginning}</td>
                <td>{r.incoming}</td>
                <td>{r.refill}</td>
                <td>{r.sold}</td>
                <td className="font-semibold">{r.filled}</td>
                <td className="font-semibold">{r.empty}</td>
                <td className="font-bold text-brand-pine">{r.total}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>No data</td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-bold">
                <td>Total</td>
                {FIELDS.map((f) => (
                  <td key={f}>{total(f)}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 mb-0 max-w-200 text-[13px] text-gray-600">
        From the Stock Inventory of the chosen day. Filled: Beginning + Incoming + Refill − Sold = Ending. A refill exchanges empties for filled ones, so it does not change the Total cylinders; only Incoming (new cylinders) raises it.
        Empties: the Ending Inventory of the EMPTIES. Total cylinders = Filled Ending + Empties.
      </p>
    </div>
  )
}
