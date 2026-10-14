import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'
import { loadLowLevels, stockStatus, statusColor } from './stockStatus'
import { todayString } from './dateUtils'

// Empty cylinders are not tracked by the system yet. Set to false to hide the EMPTIES columns.
const SHOW_EMPTIES = true

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const CELL = 'border border-(color:--border) px-3 py-2 text-center'
const LABEL = 'border border-(color:--border) px-3 py-2 text-left uppercase'
const NUMBER_INPUT = 'box-border w-20 text-center'

// "2.7kg" -> "2.7 KG"
const sizeLabel = (size) => size.replace(/kg$/i, ' KG').toUpperCase()

export default function InventoryTable({
  branch,
  canEdit = false,
  headerLeft = null, // replaces the title on the left of the top row
  date: dateProp, // the admin page controls the date, the staff page does not
  onDateChange,
  tableClass, // lets the admin page give the table a fixed size
}) {
  const [ownDate, setOwnDate] = useState('')
  const date = dateProp ?? ownDate // '' means today
  const setDate = onDateChange ?? setOwnDate
  const [rows, setRows] = useState([])
  const [levels, setLevels] = useState({})
  const [remarks, setRemarks] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [remarksDraft, setRemarksDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const shownDate = date || todayString()

  // the day runs from midnight to midnight in this device's local time
  const dayRange = () => {
    const from = new Date(`${shownDate}T00:00:00`)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)
    return { from, to }
  }

  const load = async () => {
    setMessage('')
    const { from, to } = dayRange()
    const { data, error } = await supabase.rpc('inventory_report', {
      p_branch: branch,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    })
    if (error) setMessage(error.message)
    else setRows(data)

    const remarksResult = await supabase
      .from('inventory_remarks')
      .select('remarks')
      .eq('branch', branch)
      .eq('day', shownDate)
      .maybeSingle()
    setRemarks(remarksResult.data?.remarks || '')

    setLevels(await loadLowLevels(supabase))
  }

  useEffect(() => {
    setEditing(false)
    load()
  }, [branch, shownDate])

  const startEdit = () => {
    setDrafts(
      Object.fromEntries(
        rows.map((r) => [
          r.size,
          {
            beginning: String(r.beginning),
            // empty means "no count yet"
            actual: r.actual === null ? '' : String(r.actual),
          },
        ])
      )
    )
    setRemarksDraft(remarks)
    setMessage('')
    setEditing(true)
  }

  // only digits are allowed: no minus sign, decimal point, or letters
  const setDraft = (size, field) => (e) =>
    setDrafts({
      ...drafts,
      [size]: { ...drafts[size], [field]: e.target.value.replace(/\D/g, '') },
    })

  const save = async () => {
    setMessage('')

    const changes = []
    rows.forEach((r) => {
      const d = drafts[r.size]
      if (!d) return
      if (d.beginning !== '' && Number(d.beginning) !== r.beginning) {
        changes.push({ size: r.size, kind: 'beginning', value: Number(d.beginning) })
      }
      if (d.actual !== '' && (r.actual === null || Number(d.actual) !== r.actual)) {
        changes.push({ size: r.size, kind: 'ending', value: Number(d.actual) })
      }
    })
    const remarksChanged = remarksDraft.trim() !== remarks

    if (changes.length === 0 && !remarksChanged) {
      setMessage('Nothing was changed')
      return
    }

    if (!(await confirmDialog(`Are you sure you want to save these changes for ${shownDate}?`))) {
      return
    }

    setSaving(true)
    const { from, to } = dayRange()
    for (const c of changes) {
      const { error } = await supabase.rpc('adjust_stock', {
        p_branch: branch,
        p_size: c.size,
        p_kind: c.kind,
        p_new_value: c.value,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      })
      if (error) {
        setSaving(false)
        setEditing(false)
        await load()
        setMessage(error.message)
        return
      }
    }
    if (remarksChanged) {
      const { error } = await supabase.rpc('save_inventory_remarks', {
        p_branch: branch,
        p_day: shownDate,
        p_remarks: remarksDraft.trim(),
      })
      if (error) {
        setSaving(false)
        setEditing(false)
        await load()
        setMessage(error.message)
        return
      }
    }
    setSaving(false)
    setEditing(false)
    await load()
    setMessage('Saved')
  }

  const sizeCount = rows.length
  const columns = SHOW_EMPTIES ? sizeCount * 2 : sizeCount

  // one row of the table: a label, the number of each size, and (empties) a dash
  const bodyRow = (label, cell, options = {}) => (
    <tr key={label}>
      <th scope="row" className={`${LABEL} ${options.bold ? 'font-bold' : 'font-medium'}`}>
        {label}
      </th>
      {rows.map((r) => (
        <td key={r.size} className={CELL}>{cell(r)}</td>
      ))}
      {SHOW_EMPTIES &&
        rows.map((r) => (
          <td key={`empty-${r.size}`} className={`${CELL} text-gray-400`}>-</td>
        ))}
      {options.remarks && (
        <td rowSpan={7} className="border border-(color:--border) p-3 text-left align-top">
          {editing ? (
            <textarea
              className="box-border h-full min-h-40 w-full resize-none rounded-md border border-(color:--border) p-2"
              value={remarksDraft}
              onChange={(e) => setRemarksDraft(e.target.value)}
              placeholder="Remarks of the day"
            />
          ) : (
            <span className="whitespace-pre-wrap">{remarks}</span>
          )}
        </td>
      )}
    </tr>
  )

  return (
    <div>
      {/* Title on the left, buttons on the right */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {headerLeft ?? (
          <div>
            <h1 className="m-0 text-2xl">Stock Inventory</h1>
            <p className="m-0 text-[14px] text-gray-500">{branchName(branch)}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button disabled={saving} onClick={save}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
              <button className={OUTLINE} onClick={() => setEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <label className={`${OUTLINE} flex items-center gap-2`}>
                Date
                <input
                  type="date"
                  className="border-0 bg-transparent p-0"
                  value={shownDate}
                  max={todayString()}
                  onChange={(e) =>
                    setDate(!e.target.value || e.target.value === todayString() ? '' : e.target.value)
                  }
                />
              </label>
              <button className={OUTLINE} onClick={() => setDate('')}>Today</button>
              <button className={OUTLINE} onClick={load}>Refresh</button>
              {canEdit && <button className={OUTLINE} onClick={startEdit}>Edit</button>}
            </>
          )}
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      {editing && (
        <p className="mt-0 mb-4 max-w-160 text-[14px]">
          Type the correct numbers in the table. Beginning is the stock when the day started.
          Actual count is what you counted (it updates the real stock, so tomorrow starts from it).
          Leave a box empty if nothing changes.
        </p>
      )}

      {rows.length === 0 ? (
        <p>No data</p>
      ) : (
        <div
          className={
            tableClass ?? 'overflow-x-auto rounded-xl border border-(color:--border) bg-white'
          }
        >
          <table className="w-full min-w-[900px]">
            <thead>
              <tr>
                <th rowSpan={3} className={`${CELL} min-w-40 text-left align-top`}>
                  DATE:
                  <div className="font-normal">{shownDate}</div>
                </th>
                <th colSpan={columns} className={CELL}>STOCK INVENTORY</th>
                <th rowSpan={3} className={`${CELL} min-w-48`}>REMARKS</th>
              </tr>
              <tr>
                <th colSpan={sizeCount} className={CELL}>FILLED</th>
                {SHOW_EMPTIES && <th colSpan={sizeCount} className={CELL}>EMPTIES</th>}
              </tr>
              <tr>
                {rows.map((r) => (
                  <th key={`filled-${r.size}`} className={CELL}>{sizeLabel(r.size)}</th>
                ))}
                {SHOW_EMPTIES &&
                  rows.map((r) => (
                    <th key={`empties-${r.size}`} className={CELL}>{sizeLabel(r.size)}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {bodyRow(
                'Beginning',
                (r) =>
                  editing ? (
                    <input
                      className={NUMBER_INPUT}
                      inputMode="numeric"
                      maxLength={6}
                      value={drafts[r.size]?.beginning ?? ''}
                      onChange={setDraft(r.size, 'beginning')}
                    />
                  ) : (
                    r.beginning
                  ),
                { remarks: true }
              )}
              {bodyRow('Incoming/Refill', (r) => r.incoming)}
              {bodyRow('Total', (r) => r.beginning + r.incoming, { bold: true })}
              {bodyRow('Sales', (r) => r.sold)}
              {bodyRow('Ending Inventory', (r) => {
                const status = stockStatus('LPG Cylinder ' + r.size, r.ending, levels)
                return status === 'In stock' ? (
                  r.ending
                ) : (
                  <span
                    className="font-semibold"
                    style={{ color: statusColor(status) }}
                    title={status}
                  >
                    {r.ending}
                  </span>
                )
              })}
              {bodyRow('Actual Count', (r) =>
                editing ? (
                  <input
                    className={NUMBER_INPUT}
                    inputMode="numeric"
                    maxLength={6}
                    value={drafts[r.size]?.actual ?? ''}
                    onChange={setDraft(r.size, 'actual')}
                  />
                ) : (
                  (r.actual ?? '')
                )
              )}
              {bodyRow('Variance', (r) =>
                r.variance === null ? (
                  ''
                ) : (
                  <span className={r.variance === 0 ? '' : 'font-semibold text-brand-red'}>
                    {r.variance}
                  </span>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 mb-0 max-w-160 text-[14px] text-gray-600">
        Incoming/Refill: stock that came in that day. Ending Inventory: Beginning + Incoming − Sales
        (orange or red when the stock is low). Variance: Actual Count − Ending Inventory.
      </p>
    </div>
  )
}