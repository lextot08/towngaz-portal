import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { confirmDialog } from '../components/Confirm'
import { branchName } from '../lib/branches'
import { todayString, localDateString } from '../lib/dateUtils'
import DateButton from '../components/DateButton'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'
const MINI = 'px-2.5 py-1 text-[12px]'
const MINI_CANCEL = `${MINI} border border-(color:--border) bg-white text-(color:--text)`
const QTY_INPUT = 'box-border block w-full min-w-0 p-1 text-center text-[13px]'

// fixed-size grid with lines like a spreadsheet
const TABLE =
  'w-full min-w-[900px] table-fixed border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-1.5 [&_td]:py-2 [&_td]:align-top [&_th]:px-1.5 [&_th]:py-2'
const PANEL =
  'h-[calc(100vh-260px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'

const dateText = (value) =>
  new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const timeText = (value) =>
  new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

// only digits are allowed: no minus sign, decimal point, or letters
const digits = (text) => text.replace(/\D/g, '')

const isFullyReturned = (row) => Object.values(row.items).every((i) => i.returned >= i.borrowed)

// Pahiram: cylinders taken without giving back the empty.
// Borrowed lowers the EMPTIES variance of that day; a return raises the EMPTIES variance of the day it is recorded.
export default function Pahiram({ branch }) {
  const [sizes, setSizes] = useState([])
  const [rows, setRows] = useState([])
  const [date, setDate] = useState('') // '' means today
  const [newRow, setNewRow] = useState(null) // the empty row of "Add pahiram"
  const [editId, setEditId] = useState(null) // the row whose Returned cells are being typed
  const [editQtys, setEditQtys] = useState({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const shownDate = date || todayString()

  const load = async () => {
    setMessage('')
    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    const listResult = await supabase.rpc('pahiram_list', { p_branch: branch })
    if (sizesResult.error) {
      setMessage(sizesResult.error.message)
      return
    }
    if (listResult.error) {
      setMessage(listResult.error.message)
      return
    }
    setSizes(sizesResult.data.map((p) => p.size))

    // one row per pahiram (the list has one line per size)
    const grouped = new Map()
    listResult.data.forEach((x) => {
      if (!grouped.has(x.row_id)) {
        grouped.set(x.row_id, { id: x.row_id, createdAt: x.created_at, items: {} })
      }
      grouped.get(x.row_id).items[x.size] = { borrowed: x.borrowed, returned: x.returned }
    })
    setRows([...grouped.values()])
  }

  useEffect(() => {
    setNewRow(null)
    setEditId(null)
    load()
  }, [branch])

  // The rows of the chosen day, and (first, highlighted) the rows of earlier days that are still not fully returned
  const dayOf = (row) => localDateString(row.createdAt)
  const waitingRows = rows.filter((r) => dayOf(r) < shownDate && !isFullyReturned(r))
  const dayRows = rows.filter((r) => dayOf(r) === shownDate)
  const shown = [...waitingRows, ...dayRows]

  const sizeCols = Math.max(sizes.length, 1)
  const sizeWidth = 72 / (sizeCols * 2) // the size columns share 72% of the table

  // ---- Add pahiram ----
  const startNew = () => {
    setMessage('')
    setEditId(null)
    setDate('') // a new pahiram is always for today
    setNewRow({ time: new Date(), qtys: Object.fromEntries(sizes.map((s) => [s, ''])) })
  }

  const setNewQty = (size) => (e) =>
    setNewRow((row) => ({ ...row, qtys: { ...row.qtys, [size]: digits(e.target.value) } }))

  const saveNew = async () => {
    setMessage('')
    const items = sizes
      .map((s) => ({ size: s, quantity: Number(newRow.qtys[s]) || 0 }))
      .filter((i) => i.quantity > 0)
    if (items.length === 0) {
      setMessage('Please enter a quantity for at least one size')
      return
    }
    const what = items.map((i) => `${i.quantity} x ${i.size}`).join(', ')
    if (
      !(await confirmDialog(
        `Are you sure you want to add this pahiram: ${what}? The empties variance of today will go down by the same amount.`
      ))
    ) {
      return
    }

    setSaving(true)
    const { error } = await supabase.rpc('pahiram_add', {
      p_items: items,
      p_time: newRow.time.toISOString(),
    })
    setSaving(false)
    if (error) {
      setMessage(error.message)
      return
    }
    setNewRow(null)
    await load()
  }

  // ---- Record a return (type the total returned so far) ----
  const startEdit = (row) => {
    setMessage('')
    setNewRow(null)
    setEditId(row.id)
    setEditQtys(
      Object.fromEntries(Object.entries(row.items).map(([s, it]) => [s, String(it.returned)]))
    )
  }

  const setEditQty = (size) => (e) =>
    setEditQtys((q) => ({ ...q, [size]: digits(e.target.value) }))

  const saveReturn = async (row) => {
    setMessage('')
    const returns = []
    for (const s of sizes) {
      const it = row.items[s]
      if (!it) continue
      const typed = editQtys[s]
      if (typed === undefined || typed === '') continue
      const total = Number(typed)
      if (total < it.returned) {
        setMessage(
          `Returned for ${s} cannot be lowered (already ${it.returned}). To fix a mistake, delete the row and add it again.`
        )
        return
      }
      if (total > it.borrowed) {
        setMessage(`Returned for ${s} cannot be more than the borrowed (${it.borrowed})`)
        return
      }
      if (total !== it.returned) returns.push({ size: s, returned: total })
    }
    if (returns.length === 0) {
      setMessage('Nothing was changed')
      return
    }

    const what = returns.map((r) => `${r.returned - row.items[r.size].returned} x ${r.size}`).join(', ')
    const today = dateText(new Date())
    if (
      !(await confirmDialog(
        `Are you sure you want to record this return: ${what}? It is counted in the empties of today (${today}), not on the day it was borrowed.`
      ))
    ) {
      return
    }

    setSaving(true)
    const { error } = await supabase.rpc('pahiram_return', {
      p_row_id: row.id,
      p_returns: returns,
    })
    setSaving(false)
    if (error) {
      setMessage(error.message)
      return
    }
    setEditId(null)
    await load()
  }

  // ---- Delete a row ----
  const deleteRow = async (row) => {
    const what = sizes
      .filter((s) => row.items[s])
      .map((s) => `${row.items[s].borrowed} x ${s}`)
      .join(', ')
    if (
      !(await confirmDialog(
        `Are you sure you want to delete this pahiram (${what})? Its effect on the empties is removed too.`
      ))
    ) {
      return
    }
    const { error } = await supabase.rpc('pahiram_delete', { p_row_id: row.id })
    if (error) {
      setMessage(error.message)
      return
    }
    if (editId === row.id) setEditId(null)
    await load()
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Pahiram</h1>
          <p className="m-0 text-[14px] text-gray-500">{branchName(branch)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateButton
            value={shownDate}
            onChange={(v) => setDate(!v || v === todayString() ? '' : v)}
          />
          <button className={OUTLINE} onClick={() => setDate('')}>Today</button>
          <button className={OUTLINE} onClick={load}>Refresh</button>
          <button className={SOLID} disabled={Boolean(newRow)} onClick={startNew}>
            Add pahiram
          </button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <p className="mt-0 text-[14px]">
        Pahiram from earlier days that is not fully returned yet is shown first (highlighted), whatever
        the date.
      </p>

      <div className={PANEL}>
        <table className={TABLE}>
          <colgroup>
            <col style={{ width: '16%' }} />
            {Array.from({ length: sizeCols * 2 }, (_, i) => (
              <col key={i} style={{ width: `${sizeWidth}%` }} />
            ))}
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Date / Time</th>
              <th colSpan={sizeCols} className="text-center">Returned</th>
              <th colSpan={sizeCols} className="text-center">Borrowed</th>
              <th rowSpan={2}>Action</th>
            </tr>
            <tr>
              {sizes.length === 0 ? <th></th> : sizes.map((s) => (
                <th key={`r-${s}`} className="text-center">{s}</th>
              ))}
              {sizes.length === 0 ? <th></th> : sizes.map((s) => (
                <th key={`b-${s}`} className="text-center">{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* The empty row of "Add pahiram": the date and time are filled in, type the borrowed sizes */}
            {newRow && (
              <tr className="bg-brand-light">
                <td className="font-semibold">
                  {dateText(newRow.time)}
                  <div>{timeText(newRow.time)}</div>
                </td>
                {sizes.map((s) => (
                  <td key={`r-${s}`} className="text-center text-gray-400">-</td>
                ))}
                {sizes.map((s) => (
                  <td key={`b-${s}`} className="text-center">
                    <input
                      className={QTY_INPUT}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="0"
                      value={newRow.qtys[s] ?? ''}
                      onChange={setNewQty(s)}
                    />
                  </td>
                ))}
                <td>
                  <div className="flex flex-wrap gap-1">
                    <button className={MINI} disabled={saving} onClick={saveNew}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button className={MINI_CANCEL} disabled={saving} onClick={() => setNewRow(null)}>
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {shown.map((row) => {
              const editing = editId === row.id
              const waiting = dayOf(row) < shownDate // an earlier day, still waiting to be returned
              return (
                <tr key={row.id} className={waiting ? 'bg-[#fff7e0]' : ''}>
                  <td>
                    {dateText(row.createdAt)}
                    <div className="text-gray-500">{timeText(row.createdAt)}</div>
                  </td>

                  {/* Returned: the total returned so far */}
                  {sizes.map((s) => {
                    const it = row.items[s]
                    if (!it) return <td key={`r-${s}`} />
                    if (editing && it.returned < it.borrowed) {
                      return (
                        <td key={`r-${s}`} className="text-center">
                          <input
                            className={QTY_INPUT}
                            inputMode="numeric"
                            maxLength={6}
                            value={editQtys[s] ?? ''}
                            onChange={setEditQty(s)}
                          />
                          <div className="text-[11px] text-gray-500">max {it.borrowed}</div>
                        </td>
                      )
                    }
                    return <td key={`r-${s}`} className="text-center">{it.returned}</td>
                  })}

                  {/* Borrowed: what is still outstanding (the original amount is shown under it) */}
                  {sizes.map((s) => {
                    const it = row.items[s]
                    if (!it) return <td key={`b-${s}`} />
                    const live =
                      editing && editQtys[s] !== undefined && editQtys[s] !== ''
                        ? Number(editQtys[s])
                        : it.returned
                    const remaining = Math.max(it.borrowed - live, 0)
                    return (
                      <td key={`b-${s}`} className="text-center">
                        {remaining}
                        {live > 0 && (
                          <div className="text-[11px] text-gray-400">of {it.borrowed}</div>
                        )}
                      </td>
                    )
                  })}

                  <td>
                    <div className="flex flex-wrap gap-1">
                      {editing ? (
                        <>
                          <button className={MINI} disabled={saving} onClick={() => saveReturn(row)}>
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            className={MINI_CANCEL}
                            disabled={saving}
                            onClick={() => setEditId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button className={MINI} onClick={() => startEdit(row)}>Edit</button>
                          <button className={MINI} onClick={() => deleteRow(row)}>Delete</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}

            {shown.length === 0 && !newRow && (
              <tr>
                <td colSpan={2 + sizeCols * 2}>No pahiram on this date</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 mb-0 max-w-200 text-[13px] text-gray-600">
        Borrowed: cylinders taken without giving back the empty. They are already counted as sales, so
        the EMPTIES variance of that day goes down and the EMPTIES Ending Inventory goes down with it.
        Returned: type the total returned so far in Edit. The returned empties are counted on the day
        you record them, so that day&apos;s EMPTIES Ending Inventory is the one that goes up, and the
        Borrowed column shows what is still outstanding.
      </p>
    </div>
  )
}