import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { confirmDialog } from '../components/Confirm'
import { branchName } from '../lib/branches'
import { dateString } from '../lib/dateUtils'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'
const DANGER = 'rounded-lg bg-brand-red px-4 py-2 text-white'
const PANEL =
  'h-[calc(100vh-260px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'
// fixed-size grid with lines like a spreadsheet
const TABLE =
  'w-full min-w-[1000px] table-fixed border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-1.5 [&_td]:py-2 [&_td]:align-top [&_td]:[overflow-wrap:anywhere] [&_th]:px-1.5 [&_th]:py-2'
const CELL_INPUT = 'box-border block w-full min-w-0 p-1 text-[13px]'
const EDITABLE = 'cursor-cell hover:bg-black/[0.03]'

// the three column groups; each has one column per size
const GROUPS = [
  { key: 'borrowed', label: 'Borrowed' },
  { key: 'sell', label: 'Sell' },
  { key: 'buy', label: 'Buy' },
]

const pad = (n) => String(n).padStart(2, '0')
// a date as the value of a date-and-time box ("2026-10-16T14:35"), in this device's time
const toInputValue = (iso) => {
  const d = new Date(iso)
  return `${dateString(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const dateText = (value) =>
  new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const timeText = (value) =>
  new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

const qtyOf = (row, group, size) => Number(row.quantities?.[group]?.[size] || 0)

// Ledger (staff): its own list, not linked to orders or stock.
// Every cell is edited by double-click: Enter (or clicking away) saves, Esc cancels.
export default function Ledger({ branch }) {
  const [sizes, setSizes] = useState([])
  const [rows, setRows] = useState([])
  const [message, setMessage] = useState('')
  const [cell, setCell] = useState(null) // { id, field: 'time' | 'name' | 'group:size', value }
  const savingCell = useRef(false) // stops Enter and clicking away from saving twice
  const cancelledCell = useRef(false) // Esc was pressed: do not save when the box closes
  const [adding, setAdding] = useState(false)
  const [selecting, setSelecting] = useState(false) // choosing rows to delete
  const [selected, setSelected] = useState([]) // ids of the ticked rows

  const load = async () => {
    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    const rowsResult = await supabase
      .from('ledger_entries')
      .select('*')
      .eq('branch', branch)
      .order('entry_time', { ascending: false })
    const error = sizesResult.error || rowsResult.error
    if (error) {
      setMessage(error.message)
      return
    }
    setSizes(sizesResult.data.map((p) => p.size))
    setRows(rowsResult.data)
  }

  useEffect(() => {
    load()
  }, [branch])

  // ---- Editing a cell ----
  const isEditing = (row, field) => cell && cell.id === row.id && cell.field === field

  const startCell = (row, field) => {
    if (selecting || savingCell.current || isEditing(row, field)) return
    let value
    if (field === 'time') value = toInputValue(row.entry_time)
    else if (field === 'name') value = row.customer_name || ''
    else {
      const [group, size] = field.split(':')
      const qty = qtyOf(row, group, size)
      value = qty > 0 ? String(qty) : ''
    }
    cancelledCell.current = false
    setMessage('')
    setCell({ id: row.id, field, value })
  }

  const cancelCell = () => {
    cancelledCell.current = true
    setCell(null)
  }

  const saveCell = async (row) => {
    if (!cell || cancelledCell.current || savingCell.current) return
    let patch
    if (cell.field === 'time') {
      if (!cell.value) {
        setMessage('Please choose a date and time')
        return
      }
      const time = new Date(cell.value).toISOString()
      if (time === new Date(row.entry_time).toISOString()) return setCell(null)
      patch = { entry_time: time }
    } else if (cell.field === 'name') {
      const name = cell.value.trim()
      if (name === (row.customer_name || '')) return setCell(null)
      patch = { customer_name: name }
    } else {
      const [group, size] = cell.field.split(':')
      const qty = cell.value === '' ? 0 : Number(cell.value)
      if (qty === qtyOf(row, group, size)) return setCell(null)
      const groupQtys = { ...(row.quantities?.[group] || {}) }
      if (qty > 0) groupQtys[size] = qty
      else delete groupQtys[size] // empty or 0 = nothing
      patch = { quantities: { ...(row.quantities || {}), [group]: groupQtys } }
    }

    savingCell.current = true
    const { data, error } = await supabase
      .from('ledger_entries')
      .update(patch)
      .eq('id', row.id)
      .select('id')
    savingCell.current = false
    if (error) setMessage(error.message)
    else if (data.length === 0) setMessage('You are not allowed to change this row')
    else setCell(null)
    await load()
  }

  // keys inside a box: Enter saves (by leaving the box), Esc cancels
  const cellKeys = (e) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') cancelCell()
  }

  // ---- Add a row: a new empty row at the top, with the name box open ----
  const addRow = async () => {
    setMessage('')
    setAdding(true)
    const { data, error } = await supabase
      .from('ledger_entries')
      .insert({ branch, entry_time: new Date().toISOString(), customer_name: '' })
      .select()
      .single()
    setAdding(false)
    if (error) {
      setMessage(error.message)
      return
    }
    await load()
    cancelledCell.current = false
    setCell({ id: data.id, field: 'name', value: '' })
  }

  // ---- Delete: tick the small boxes at the end of the rows, then delete them together ----
  const startDelete = () => {
    setMessage('')
    setCell(null)
    setSelected([])
    setSelecting(true)
  }

  const stopDelete = () => {
    setSelecting(false)
    setSelected([])
  }

  const toggleSelected = (id) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const deleteSelected = async () => {
    const count = selected.length
    if (count === 0) return
    if (
      !(await confirmDialog(
        `Are you sure you want to delete ${count === 1 ? 'this row' : `these ${count} rows`} from the ledger?`
      ))
    ) {
      return
    }
    const { error } = await supabase.from('ledger_entries').delete().in('id', selected)
    if (error) setMessage(error.message)
    else stopDelete()
    await load()
  }

  // ---- Table ----
  const sizeList = sizes.length > 0 ? sizes : ['']
  const sizeCols = sizeList.length
  const sizeWidth = (selecting ? 64 : 69) / (sizeCols * GROUPS.length) // the size columns share the rest

  const qtyCell = (row, group, size) => {
    const field = `${group}:${size}`
    const qty = qtyOf(row, group, size)
    return (
      <td
        key={field}
        className={`text-center ${EDITABLE}`}
        onDoubleClick={() => startCell(row, field)}
      >
        {isEditing(row, field) ? (
          <input
            autoFocus
            className={`${CELL_INPUT} text-center`}
            inputMode="numeric"
            maxLength={6}
            value={cell.value}
            onChange={(e) => setCell({ ...cell, value: e.target.value.replace(/\D/g, '') })}
            onKeyDown={cellKeys}
            onBlur={() => saveCell(row)}
          />
        ) : qty > 0 ? (
          qty
        ) : (
          ''
        )}
      </td>
    )
  }

  const totalOf = (group, size) => rows.reduce((sum, row) => sum + qtyOf(row, group, size), 0)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Ledger</h1>
          <p className="m-0 text-[14px] text-gray-500">{branchName(branch)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={OUTLINE} onClick={load}>Refresh</button>
          {selecting ? (
            <>
              <button className={DANGER} disabled={selected.length === 0} onClick={deleteSelected}>
                Delete selected ({selected.length})
              </button>
              <button className={OUTLINE} onClick={stopDelete}>Cancel</button>
            </>
          ) : (
            <>
              <button className={SOLID} disabled={adding} onClick={addRow}>
                {adding ? 'Adding...' : 'Add row'}
              </button>
              <button className={OUTLINE} onClick={startDelete}>Delete</button>
            </>
          )}
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <p className="mt-0 text-[14px]">
        Double-click any cell to edit it. Press Enter to save or Esc to cancel.
      </p>

      <div className={PANEL}>
        <table className={TABLE}>
          <colgroup>
            <col style={{ width: '13%' }} />
            <col style={{ width: '18%' }} />
            {Array.from({ length: sizeCols * GROUPS.length }, (_, i) => (
              <col key={i} style={{ width: `${sizeWidth}%` }} />
            ))}
            {selecting && <col style={{ width: '5%' }} />}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Date/Time</th>
              <th rowSpan={2}>Customer Name</th>
              {GROUPS.map((gr) => (
                <th key={gr.key} colSpan={sizeCols} className="text-center">{gr.label}</th>
              ))}
              {selecting && <th rowSpan={2} className="text-center">Delete</th>}
            </tr>
            <tr>
              {GROUPS.map((gr) =>
                sizeList.map((s) => (
                  <th key={`${gr.key}-${s}`} className="text-center">{s}</th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={selecting && selected.includes(row.id) ? 'bg-red-50' : ''}>
                <td className={EDITABLE} onDoubleClick={() => startCell(row, 'time')}>
                  {isEditing(row, 'time') ? (
                    <input
                      autoFocus
                      type="datetime-local"
                      className={CELL_INPUT}
                      value={cell.value}
                      onChange={(e) => setCell({ ...cell, value: e.target.value })}
                      onKeyDown={cellKeys}
                      onBlur={() => saveCell(row)}
                    />
                  ) : (
                    <>
                      {dateText(row.entry_time)}
                      <div className="text-gray-500">{timeText(row.entry_time)}</div>
                    </>
                  )}
                </td>
                <td className={EDITABLE} onDoubleClick={() => startCell(row, 'name')}>
                  {isEditing(row, 'name') ? (
                    <input
                      autoFocus
                      className={CELL_INPUT}
                      placeholder="Customer name"
                      value={cell.value}
                      onChange={(e) => setCell({ ...cell, value: e.target.value })}
                      onKeyDown={cellKeys}
                      onBlur={() => saveCell(row)}
                    />
                  ) : (
                    row.customer_name || <span className="text-gray-400">(no name)</span>
                  )}
                </td>
                {GROUPS.map((gr) => sizeList.map((s) => qtyCell(row, gr.key, s)))}
                {selecting && (
                  <td className="text-center align-middle!">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer p-0"
                      aria-label={`Delete the row of ${row.customer_name || 'no name'}`}
                      checked={selected.includes(row.id)}
                      onChange={() => toggleSelected(row.id)}
                    />
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2 + sizeCols * GROUPS.length + (selecting ? 1 : 0)}>
                  No rows yet. Click Add row to start.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={2}>Total</td>
              {GROUPS.map((gr) =>
                sizeList.map((s) => {
                  const total = totalOf(gr.key, s)
                  return (
                    <td key={`${gr.key}-${s}`} className="text-center">
                      {total > 0 ? total : ''}
                    </td>
                  )
                })
              )}
              {selecting && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
