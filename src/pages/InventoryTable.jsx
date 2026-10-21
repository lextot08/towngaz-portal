import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { confirmDialog } from '../components/Confirm'
import { branchName, BRANCHES } from '../lib/branches'
import { loadLowLevels, stockStatus, statusColor } from '../lib/stockStatus'
import { todayString } from '../lib/dateUtils'
import DateButton from '../components/DateButton'

// Set to false to hide the EMPTIES columns.
const SHOW_EMPTIES = true

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const CELL = 'border border-(color:--border) px-3 py-2 text-center'
const LABEL = 'border border-(color:--border) px-3 py-2 text-left uppercase'
const NUMBER_INPUT = 'box-border w-20 text-center'

// "2.7kg" -> "2.7 KG"
const sizeLabel = (size) => size.replace(/kg$/i, ' KG').toUpperCase()

// typed text -> number, or null when it is empty
const parse = (text) => (text === '' ? null : Number(text))
const pick = (text, saved) => parse(text) ?? saved

// FILLED: Total = Beginning + Incoming + Refill. Ending = Total - Sales. Actual Count = Ending.
// Incoming = new filled cylinders. Refill = the branch's empties exchanged for filled ones.
// "saved" are the numbers from the database, "draft" is what is typed in Edit mode.
const calcFilled = (saved, draft) => {
  const beginning = pick(draft?.beginning ?? '', saved.beginning)
  const incoming = pick(draft?.incoming ?? '', saved.incoming)
  const refill = pick(draft?.refill ?? '', saved.refill)
  const sales = pick(draft?.sales ?? '', saved.sales)
  const total = beginning + incoming + refill
  return { beginning, incoming, refill, sales, total, ending: total - sales }
}

// EMPTIES: Ending = Beginning + the FILLED Sales + the Variance (the pahiram: negative = borrowed)
// - the Refill (those empties went out to be refilled).
// Incoming and Total are not calculated: they are only what was typed.
const calcEmpties = (saved, draft, filledSales, refill) => {
  const beginning = pick(draft?.beginning ?? '', saved.beginning)
  const variance = Number(saved.variance) || 0
  const beforeRefill = beginning + filledSales + variance // the empties the branch has to refill
  return { beginning, variance, beforeRefill, refill, ending: beforeRefill - refill }
}

const filledSaved = (r) => ({
  beginning: r.beginning,
  incoming: r.incoming,
  refill: Number(r.refill) || 0,
  sales: r.sold,
})
const emptiesSaved = (e) => ({ beginning: e.beginning, variance: e.variance })

// the message for a number that cannot be saved, or ''
const filledProblem = (name, v, minSales) => {
  if (v.sales < minSales) {
    return `${name}: Sales cannot be lower than ${minSales} (the orders already in the Daily Sales Report)`
  }
  if (v.ending < 0) return `${name}: Sales (${v.sales}) cannot be more than the Total (${v.total})`
  return ''
}

export default function InventoryTable({
  branch,
  canEdit = false,
  overall = false, // admin: the total of all branches (view only)
  headerLeft = null, // replaces the title on the left of the top row
  date: dateProp, // the admin page controls the date, the staff page does not
  onDateChange,
  tableClass, // lets the admin page give the table a fixed size
}) {
  const [ownDate, setOwnDate] = useState('')
  const date = dateProp ?? ownDate // '' means today
  const setDate = onDateChange ?? setOwnDate
  const [rows, setRows] = useState([]) // filled
  const [emptyRows, setEmptyRows] = useState([]) // empties
  const [levels, setLevels] = useState({})
  const [remarks, setRemarks] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState({ filled: {}, empties: {} })
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

  // Overall: adds up the numbers of all branches, size by size.
  // A "nullable" field stays empty when no branch has a number for it.
  const addUp = (lists, fields, nullable = []) => {
    const total = new Map()
    lists.forEach((list) =>
      (list || []).forEach((r) => {
        if (!total.has(r.size)) {
          total.set(r.size, {
            size: r.size,
            ...Object.fromEntries(fields.map((f) => [f, nullable.includes(f) ? null : 0])),
          })
        }
        const t = total.get(r.size)
        fields.forEach((f) => {
          if (nullable.includes(f)) {
            if (r[f] !== null && r[f] !== undefined) t[f] = (t[f] ?? 0) + Number(r[f])
          } else {
            t[f] += Number(r[f]) || 0
          }
        })
      })
    )
    return [...total.values()]
  }

  const load = async () => {
    setMessage('')
    const { from, to } = dayRange()

    if (overall) {
      const ids = BRANCHES.map((b) => b.id)

      const filledResults = await Promise.all(
        ids.map((id) =>
          supabase.rpc('inventory_report', {
            p_branch: id,
            p_from: from.toISOString(),
            p_to: to.toISOString(),
          })
        )
      )
      const failed = filledResults.find((x) => x.error)
      if (failed) setMessage(failed.error.message)
      else {
        setRows(
          addUp(
            filledResults.map((x) => x.data),
            ['beginning', 'incoming', 'refill', 'total', 'sold', 'orders_sold', 'ending']
          )
        )
      }

      if (SHOW_EMPTIES) {
        const emptiesResults = await Promise.all(
          ids.map((id) => supabase.rpc('empties_report', { p_branch: id, p_day: shownDate }))
        )
        const failedEmpties = emptiesResults.find((x) => x.error)
        if (failedEmpties) setMessage(failedEmpties.error.message)
        else {
          setEmptyRows(
            addUp(
              emptiesResults.map((x) => x.data),
              ['beginning', 'incoming', 'refill', 'total', 'ending', 'variance'],
              ['incoming', 'total']
            )
          )
        }
      }

      // the remarks of every branch for that day, one line per branch
      const remarksResult = await supabase
        .from('inventory_remarks')
        .select('branch, remarks')
        .eq('day', shownDate)
        .order('branch')
      setRemarks(
        (remarksResult.data || [])
          .filter((r) => r.remarks)
          .map((r) => `${branchName(r.branch)}: ${r.remarks}`)
          .join('\n')
      )

      setLevels(await loadLowLevels(supabase))
      return
    }

    const { data, error } = await supabase.rpc('inventory_report', {
      p_branch: branch,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    })
    if (error) setMessage(error.message)
    else setRows(data)

    if (SHOW_EMPTIES) {
      const emptiesResult = await supabase.rpc('empties_report', {
        p_branch: branch,
        p_day: shownDate,
      })
      if (emptiesResult.error) setMessage(emptiesResult.error.message)
      else setEmptyRows(emptiesResult.data)
    }

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
  }, [branch, shownDate, overall])

  const emptyBySize = Object.fromEntries(emptyRows.map((e) => [e.size, e]))

  const textOf = (value) => (value === null || value === undefined ? '' : String(value))

  const startEdit = () => {
    setDrafts({
      filled: Object.fromEntries(
        rows.map((r) => [
          r.size,
          {
            beginning: String(r.beginning),
            incoming: String(r.incoming),
            refill: String(r.refill ?? 0),
            sales: String(r.sold),
          },
        ])
      ),
      empties: Object.fromEntries(
        emptyRows.map((e) => [
          e.size,
          {
            beginning: String(e.beginning),
            incoming: textOf(e.incoming), // empty = nothing typed
            total: textOf(e.total),
          },
        ])
      ),
    })
    setRemarksDraft(remarks)
    setMessage('')
    setEditing(true)
  }

  // only digits are allowed: no minus sign, decimal point, or letters
  const setDraft = (group, size, field) => (e) => {
    const value = e.target.value.replace(/\D/g, '')
    setDrafts((current) => ({
      ...current,
      [group]: { ...current[group], [size]: { ...current[group][size], [field]: value } },
    }))
  }

  // FILLED: only the typed numbers that differ from what is saved (empty text = unchanged)
  const collectFilledChanges = () =>
    rows.flatMap((item) => {
      const d = drafts.filled?.[item.size]
      if (!d) return []
      const saved = filledSaved(item)
      const row = { size: item.size, beginning: '', incoming: '', refill: '', sales: '', variance: '' }
      let changed = false
      ;['beginning', 'incoming', 'refill', 'sales'].forEach((field) => {
        if (d[field] !== '' && Number(d[field]) !== saved[field]) {
          row[field] = d[field]
          changed = true
        }
      })
      return changed ? [row] : []
    })

  // EMPTIES: Beginning (empty = unchanged), Incoming/Refill and Total ('clear' = back to empty)
  const collectEmptiesChanges = () =>
    emptyRows.flatMap((e) => {
      const d = drafts.empties?.[e.size]
      if (!d) return []
      const row = { size: e.size, beginning: '', incoming: '', total: '' }
      let changed = false
      if (d.beginning !== '' && Number(d.beginning) !== e.beginning) {
        row.beginning = d.beginning
        changed = true
      }
      ;['incoming', 'total'].forEach((field) => {
        const saved = textOf(e[field])
        const same = d[field] === saved || (d[field] !== '' && saved !== '' && Number(d[field]) === Number(saved))
        if (!same) {
          row[field] = d[field] === '' ? 'clear' : d[field]
          changed = true
        }
      })
      return changed ? [row] : []
    })

  const save = async () => {
    setMessage('')

    // check the numbers first, before anything is saved
    const problems = []
    rows.forEach((r) => {
      const p = filledProblem(
        `${sizeLabel(r.size)} filled`,
        calcFilled(filledSaved(r), drafts.filled[r.size]),
        r.orders_sold
      )
      if (p) problems.push(p)
    })
    // a refill can never be more than the empties the branch has
    if (SHOW_EMPTIES) {
      emptyRows.forEach((e) => {
        const v = liveEmpties(e)
        if (v.refill > v.beforeRefill) {
          problems.push(
            `${sizeLabel(e.size)}: Refill (${v.refill}) cannot be more than the empties of the branch (${v.beforeRefill}). Put the rest in Incoming.`
          )
        }
      })
    }
    if (problems.length > 0) {
      setMessage(problems[0])
      return
    }

    const filledChanges = collectFilledChanges()
    const emptiesChanges = SHOW_EMPTIES ? collectEmptiesChanges() : []
    const remarksChanged = remarksDraft.trim() !== remarks

    if (filledChanges.length === 0 && emptiesChanges.length === 0 && !remarksChanged) {
      setMessage('Nothing was changed')
      return
    }

    const stockNote =
      filledChanges.length > 0 ? ' This changes the real stock of the filled cylinders.' : ''
    if (
      !(await confirmDialog(
        `Are you sure you want to save these changes for ${shownDate}?${stockNote}`
      ))
    ) {
      return
    }

    setSaving(true)
    const fail = async (text) => {
      setSaving(false)
      setEditing(false)
      await load()
      setMessage(text)
    }

    const { from, to } = dayRange()
    let savedFilled = false

    if (filledChanges.length > 0) {
      const { error } = await supabase.rpc('save_inventory_day', {
        p_branch: branch,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_rows: filledChanges,
      })
      if (error) return fail(error.message)
      savedFilled = true
    }

    if (emptiesChanges.length > 0) {
      const { error } = await supabase.rpc('save_empties_day', {
        p_branch: branch,
        p_day: shownDate,
        p_rows: emptiesChanges,
      })
      if (error) {
        return fail(
          (savedFilled ? 'The filled numbers were saved, but the empties were not: ' : '') +
            error.message
        )
      }
    }

    if (remarksChanged) {
      const { error } = await supabase.rpc('save_inventory_remarks', {
        p_branch: branch,
        p_day: shownDate,
        p_remarks: remarksDraft.trim(),
      })
      if (error) return fail(`The numbers were saved, but the remarks were not: ${error.message}`)
    }

    setSaving(false)
    setEditing(false)
    await load()
    setMessage('Saved')
  }

  const sizeCount = rows.length
  const columns = SHOW_EMPTIES ? sizeCount * 2 : sizeCount

  const liveFilled = (r) => calcFilled(filledSaved(r), drafts.filled[r.size])
  // the FILLED Sales of a size, also while typing
  const filledSalesOf = (e) => {
    const filledRow = rows.find((r) => r.size === e.size)
    return filledRow ? liveFilled(filledRow).sales : 0
  }
  // the FILLED Refill of a size, also while typing
  const refillOf = (e) => {
    const filledRow = rows.find((r) => r.size === e.size)
    return filledRow ? liveFilled(filledRow).refill : 0
  }
  const liveEmpties = (e) =>
    calcEmpties(emptiesSaved(e), drafts.empties[e.size], filledSalesOf(e), refillOf(e))

  // a box to type a number in
  const box = (group, size, field) => (
    <input
      className={NUMBER_INPUT}
      inputMode="numeric"
      maxLength={6}
      value={drafts[group]?.[size]?.[field] ?? ''}
      onChange={setDraft(group, size, field)}
    />
  )

  // one row of the table: a label, then the FILLED cells, then the EMPTIES cells
  const bodyRow = (label, filled, empties, options = {}) => (
    <tr key={label}>
      <th scope="row" className={`${LABEL} ${options.bold ? 'font-bold' : 'font-medium'}`}>
        {label}
      </th>
      {rows.map((r) => (
        <td key={r.size} className={CELL}>{filled(r)}</td>
      ))}
      {SHOW_EMPTIES &&
        rows.map((r) => {
          const e = emptyBySize[r.size]
          return (
            <td key={`empty-${r.size}`} className={`${CELL} ${e ? '' : 'text-gray-400'}`}>
              {e ? empties(e) : '-'}
            </td>
          )
        })}
      {options.remarks && (
        <td rowSpan={8} className="border border-(color:--border) p-3 text-left align-top">
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
              <DateButton
                value={date || todayString()}
                onChange={(v) => setDate(!v || v === todayString() ? '' : v)}
              />
              <button className={OUTLINE} onClick={() => setDate('')}>Today</button>
              <button className={OUTLINE} onClick={load}>Refresh</button>
              {canEdit && <button className={OUTLINE} onClick={startEdit}>Edit</button>}
            </>
          )}
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      {editing && (
        <p className="mt-0 mb-4 max-w-200 text-[14px]">
          FILLED: type Beginning, Incoming (new filled cylinders), Refill (the branch&apos;s empties
          exchanged for filled ones, never more than the empties), and Sales (the orders in the Daily
          Sales Report are already counted, shown as &quot;min&quot;). This changes the real stock. EMPTIES: type
          the Beginning, and the Incoming/Refill and Total if you want to record them (they are not
          calculated and change nothing else). The EMPTIES Ending Inventory is the Beginning plus the
          FILLED Sales, and updates by itself.
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
                (r) => (editing ? box('filled', r.size, 'beginning') : r.beginning),
                (e) => (editing ? box('empties', e.size, 'beginning') : e.beginning),
                { remarks: true }
              )}

              {bodyRow(
                'Incoming',
                (r) => (editing ? box('filled', r.size, 'incoming') : r.incoming),
                (e) => (editing ? box('empties', e.size, 'incoming') : (e.incoming ?? ''))
              )}

              {/* Refill: typed in FILLED; the same number goes out of the EMPTIES */}
              {bodyRow(
                'Refill',
                (r) => (editing ? box('filled', r.size, 'refill') : (r.refill ?? 0)),
                (e) => {
                  const value = editing ? liveEmpties(e).refill : Number(e.refill) || 0
                  return value > 0 ? <span title="Empties sent to be refilled">−{value}</span> : 0
                }
              )}

              {bodyRow(
                'Total',
                (r) => (editing ? liveFilled(r).total : r.total),
                (e) => (editing ? box('empties', e.size, 'total') : (e.total ?? '')),
                { bold: true }
              )}

              {bodyRow(
                'Sales',
                (r) =>
                  editing ? (
                    <div>
                      {box('filled', r.size, 'sales')}
                      <div className="text-[11px] text-gray-400">min {r.orders_sold}</div>
                    </div>
                  ) : (
                    r.sold
                  ),
                () => <span className="text-gray-400">-</span>
              )}

              {bodyRow(
                'Ending Inventory',
                (r) => {
                  const value = editing ? liveFilled(r).ending : r.ending
                  const status = overall
                    ? 'In stock'
                    : stockStatus('LPG Cylinder ' + r.size, value, levels)
                  return status === 'In stock' ? (
                    value
                  ) : (
                    <span
                      className="font-semibold"
                      style={{ color: statusColor(status) }}
                      title={status}
                    >
                      {value}
                    </span>
                  )
                },
                (e) => (editing ? liveEmpties(e).ending : e.ending)
              )}

              {/* for now the Actual Count is the same as the Ending Inventory */}
              {bodyRow(
                'Actual Count',
                (r) => (editing ? liveFilled(r).ending : r.ending),
                (e) => (editing ? liveEmpties(e).ending : e.ending)
              )}

              {bodyRow(
                'Variance',
                () => 0,
                (e) =>
                  e.variance === 0 ? (
                    0
                  ) : (
                    <span className="font-semibold text-brand-red">{e.variance}</span>
                  )
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 mb-0 max-w-200 text-[14px] text-gray-600">
        FILLED: Total = Beginning + Incoming + Refill, and Ending Inventory = Total − Sales (orange or
        red when the stock is low). EMPTIES: Ending Inventory = Beginning + the FILLED Sales − the
        Refill (those empties were exchanged for filled ones); the
        Incoming/Refill and Total are only what you type and are not calculated. For now the Actual
        Count is the same as the Ending Inventory, so the Variance is 0. Tomorrow&apos;s Beginning is
        today&apos;s Ending Inventory.
      </p>
    </div>
  )
}