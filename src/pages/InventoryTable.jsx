import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { confirmDialog } from '../components/Confirm'
import { branchName, BRANCHES } from '../lib/branches'
import { loadLowLevels, stockStatus, statusColor } from '../lib/stockStatus'
import { todayString } from '../lib/dateUtils'
import DateButton from '../components/DateButton'

// Set to false to hide the EMPTIES columns.
const SHOW_EMPTIES = true

// the lines of the REMARKS column: a label, a total box, and a note
const REMARK_LINES = [
  { key: 'swap', label: 'Swap' },
  { key: 'reject', label: 'Reject' },
  { key: 'backload', label: 'Backload' },
  { key: 'borrowed', label: 'Borrowed' },
  { key: 'sell', label: 'Sell' },
  { key: 'buy', label: 'Buy' },
]

// The notes of the lines are saved together in the day's remarks, as
// {"lines": {"swap": "...", ...}}. A remark saved before (plain text) is kept as "old".
const parseRemarks = (text) => {
  if (!text) return { lines: {}, old: '' }
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object' && value.lines) {
      return { lines: value.lines, old: value.old || '' }
    }
  } catch {
    // plain text: a remark from before the lines
  }
  return { lines: {}, old: text }
}

const encodeRemarks = ({ lines, old }) => {
  const kept = Object.fromEntries(
    Object.entries(lines)
      .map(([key, note]) => [key, String(note || '').trim()])
      .filter(([, note]) => note !== '')
  )
  if (Object.keys(kept).length === 0 && !old) return ''
  return JSON.stringify(old ? { lines: kept, old } : { lines: kept })
}

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

// FILLED (the branch's own stock):
//   Total = Beginning + Incoming/Refill. Ending = Total - Sales.
//   Variance is typed by the staff (leaked tanks, swaps between branches): - takes out, + adds.
//   Actual Count = Ending + Variance, and the next day's Beginning is the Actual Count.
// ("refill" only has numbers for the days when Refill was a row of its own; it is counted in
// Incoming/Refill.) "saved" are the numbers from the database, "draft" is what is typed in Edit mode.
const calcFilled = (saved, draft) => {
  const beginning = pick(draft?.beginning ?? '', saved.beginning)
  const incoming = pick(draft?.incoming ?? '', saved.incoming)
  const refill = pick(draft?.refill ?? '', saved.refill)
  const sales = pick(draft?.sales ?? '', saved.sales)
  const variance = pickSigned(draft?.variance ?? '', saved.variance)
  const total = beginning + incoming + refill
  const ending = total - sales
  return { beginning, incoming, refill, sales, total, ending, variance, actual: ending + variance }
}

// EMPTIES (based on the customers):
//   Total = Beginning + Incoming (typed) - the restock (the FILLED Incoming/Refill takes empties).
//   Sales = the empties given back = FILLED Sales - the cylinders sold as Utang.
//   Ending = Total + Sales. Variance = the cylinders sold as Utang (the customer kept the tank).
//   Actual Count = Ending, and the next day's Beginning is the Actual Count.
const calcEmpties = (saved, draft, filledSales, savedFilledSales, restock) => {
  const beginning = pick(draft?.beginning ?? '', saved.beginning)
  const incoming =
    draft?.incoming === undefined ? saved.incoming : draft.incoming === '' ? 0 : Number(draft.incoming)
  const total = beginning + incoming - restock
  // extra FILLED sales typed here are normal exchanges: their empties come back
  const returned = saved.returned + (filledSales - savedFilledSales)
  const ending = total + returned
  // the empties the branch has before the restock: a restock can never be more
  const beforeRestock = beginning + incoming + returned
  return { beginning, incoming, restock, total, returned, ending, variance: saved.variance, actual: ending, beforeRestock }
}

const filledSaved = (r) => ({
  beginning: r.beginning,
  incoming: r.incoming,
  refill: Number(r.refill) || 0,
  sales: r.sold,
  variance: Number(r.variance) || 0,
})
const emptiesSaved = (e) => ({
  beginning: e.beginning,
  incoming: Number(e.incoming) || 0,
  returned: Number(e.sales) || 0,
  variance: Number(e.variance) || 0,
})

// a typed number that can be negative ("-2"); "-" alone or empty = unchanged
const pickSigned = (text, saved) => (text === '' || text === '-' ? saved : Number(text))

// the message for a number that cannot be saved, or ''
const filledProblem = (name, v, minSales) => {
  if (v.sales < minSales) {
    return `${name}: Sales cannot be lower than ${minSales} (the orders already in the Daily Sales Report)`
  }
  if (v.ending < 0) return `${name}: Sales (${v.sales}) cannot be more than the Total (${v.total})`
  if (v.actual < 0) return `${name}: the Actual Count cannot be below 0 (Ending ${v.ending}, Variance ${v.variance})`
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
  const [remarksDraft, setRemarksDraft] = useState({ lines: {}, old: '' }) // the notes while editing
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
            ['beginning', 'incoming', 'refill', 'total', 'sold', 'orders_sold', 'ending', 'actual', 'variance'],
            ['actual', 'variance']
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
              ['beginning', 'incoming', 'refill', 'total', 'sales', 'ending', 'actual', 'variance'],
              ['incoming', 'total']
            )
          )
        }
      }

      // the notes of every branch for that day: each line shows the notes of all branches
      const remarksResult = await supabase
        .from('inventory_remarks')
        .select('branch, remarks')
        .eq('day', shownDate)
        .order('branch')
      const parsed = (remarksResult.data || []).map((r) => ({
        name: branchName(r.branch),
        ...parseRemarks(r.remarks),
      }))
      const joinNotes = (pick) =>
        parsed
          .filter((p) => pick(p))
          .map((p) => `${p.name}: ${pick(p)}`)
          .join('\n')
      setRemarks(
        encodeRemarks({
          lines: Object.fromEntries(REMARK_LINES.map((l) => [l.key, joinNotes((p) => p.lines[l.key])])),
          old: joinNotes((p) => p.old),
        })
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
            variance: String(Number(r.variance) || 0),
          },
        ])
      ),
      empties: Object.fromEntries(
        emptyRows.map((e) => [
          e.size,
          {
            beginning: String(e.beginning),
            incoming: textOf(e.incoming), // empty = nothing typed
          },
        ])
      ),
    })
    setRemarksDraft(parseRemarks(remarks))
    setMessage('')
    setEditing(true)
  }

  // only digits are allowed (the FILLED Variance can also start with a minus sign)
  const setDraft = (group, size, field) => (e) => {
    const value =
      field === 'variance'
        ? e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '')
        : e.target.value.replace(/\D/g, '')
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
      ;['beginning', 'incoming', 'refill', 'sales', 'variance'].forEach((field) => {
        if (d[field] !== undefined && d[field] !== '' && d[field] !== '-' && Number(d[field]) !== saved[field]) {
          row[field] = d[field]
          changed = true
        }
      })
      return changed ? [row] : []
    })

  // EMPTIES: Beginning (empty = unchanged) and Incoming ('clear' = back to empty).
  // Everything else of the EMPTIES is calculated.
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
      const saved = textOf(e.incoming)
      const same =
        d.incoming === saved || (d.incoming !== '' && saved !== '' && Number(d.incoming) === Number(saved))
      if (!same) {
        row.incoming = d.incoming === '' ? 'clear' : d.incoming
        changed = true
      }
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
        if (v.restock > v.beforeRestock) {
          problems.push(
            `${sizeLabel(e.size)}: Incoming/Refill (${v.restock}) cannot be more than the empties of the branch (${v.beforeRestock})`
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
    const remarksChanged = encodeRemarks(remarksDraft) !== encodeRemarks(parseRemarks(remarks))

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
        p_remarks: encodeRemarks(remarksDraft),
      })
      if (error) return fail(`The numbers were saved, but the remarks were not: ${error.message}`)
    }

    setSaving(false)
    setEditing(false)
    await load()
    setMessage('Saved')
  }

  // the notes of the REMARKS lines, as saved
  const shownRemarks = parseRemarks(remarks)

  const sizeCount = rows.length
  const columns = SHOW_EMPTIES ? sizeCount * 2 : sizeCount

  const liveFilled = (r) => calcFilled(filledSaved(r), drafts.filled[r.size])
  // the FILLED Sales of a size, also while typing
  const filledSalesOf = (e) => {
    const filledRow = rows.find((r) => r.size === e.size)
    return filledRow ? liveFilled(filledRow).sales : 0
  }
  // the FILLED Incoming/Refill of a size (the restock), also while typing
  const restockOf = (e) => {
    const filledRow = rows.find((r) => r.size === e.size)
    if (!filledRow) return 0
    const v = liveFilled(filledRow)
    return v.incoming + v.refill
  }
  const savedFilledSalesOf = (e) => Number(rows.find((r) => r.size === e.size)?.sold) || 0
  const liveEmpties = (e) =>
    calcEmpties(emptiesSaved(e), drafts.empties[e.size], filledSalesOf(e), savedFilledSalesOf(e), restockOf(e))

  // REMARKS > Borrowed: the cylinders sold as Utang that day (the EMPTIES Variance of every size)
  const borrowedTotal = emptyRows.reduce((sum, e) => sum + (Number(e.variance) || 0), 0)

  // a box to type a number in
  const box = (group, size, field) => (
    <input
      className={NUMBER_INPUT}
      inputMode={field === 'variance' ? 'text' : 'numeric'}
      placeholder={field === 'variance' ? '0' : undefined}
      title={field === 'variance' ? 'Use a minus sign to take out, for example -2' : undefined}
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
        // h-px + min-h-full: the remark lines stretch over the whole height of the table
        <td rowSpan={7} className="h-px border border-(color:--border) p-0 text-left align-top">
          {/* the remark lines: label, total (filled in later), note.
              A grid with equal rows: every line is as tall as the tallest one, and together
              they fill at least the whole column (a long note makes all lines taller). */}
          <div className="box-border grid min-h-full auto-rows-fr grid-cols-[36%_14%_50%] text-[13px]">
            {REMARK_LINES.map((line, i) => {
              // the last line has no line under it (the table's own border is there)
              const under = i < REMARK_LINES.length - 1 || shownRemarks.old ? 'border-b' : ''
              return (
              <Fragment key={line.key}>
                <div className={`flex items-center ${under} border-(color:--border) px-3 py-1.5 font-medium uppercase`}>
                  {i + 1}. {line.label}
                </div>
                <div className={`flex items-center justify-center ${under} border-l border-(color:--border) px-2 py-1.5 font-semibold`}>
                  {/* total: Borrowed = the cylinders sold as Utang; the others are blank for now */}
                  {line.key === 'borrowed' && borrowedTotal > 0 ? borrowedTotal : ''}
                </div>
                <div className={`${under} border-l border-(color:--border) px-2 py-1 [overflow-wrap:anywhere]`}>
                  {editing ? (
                    <textarea
                      className="box-border block h-full min-h-10 w-full min-w-0 resize-none rounded-md border border-(color:--border) p-1 text-[13px]"
                      placeholder="Note"
                      value={remarksDraft.lines[line.key] ?? ''}
                      onChange={(e) =>
                        setRemarksDraft((d) => ({
                          ...d,
                          lines: { ...d.lines, [line.key]: e.target.value },
                        }))
                      }
                    />
                  ) : (
                    <span className="whitespace-pre-wrap">{shownRemarks.lines[line.key] || ''}</span>
                  )}
                </div>
              </Fragment>
              )
            })}
            {/* a remark saved before the lines existed (plain text): kept and shown here */}
            {shownRemarks.old && (
              <>
                <div className="col-span-2 flex items-center px-3 py-1.5 text-[12px] text-gray-500">
                  Earlier note
                </div>
                <div className="border-l border-(color:--border) px-2 py-1.5 whitespace-pre-wrap text-gray-600">
                  {shownRemarks.old}
                </div>
              </>
            )}
          </div>
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
          FILLED: type Beginning, Incoming/Refill (the restock: the same number is taken out of the
          EMPTIES, so it can never be more than the empties), Sales (the orders in the Daily Sales
          Report are already counted, shown as &quot;min&quot;), and Variance for the branch&apos;s own
          changes, for example -2 for leaked tanks, -3 when giving 3 to another branch, +3 when
          receiving 3. This changes the real stock. EMPTIES: type the Beginning and the Incoming;
          everything else updates by itself.
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
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr>
                <th rowSpan={3} className={`${CELL} min-w-40 text-left align-top`}>
                  DATE:
                  <div className="font-normal">{shownDate}</div>
                </th>
                <th colSpan={columns} className={CELL}>STOCK INVENTORY</th>
                <th rowSpan={3} className={`${CELL} w-[30%] min-w-80`}>REMARKS</th>
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

              {/* Incoming/Refill: typed in FILLED; the same number goes out of the EMPTIES */}
              {bodyRow(
                'Incoming/Refill',
                (r) => {
                  const oldRefill = Number(r.refill) || 0 // from the days when Refill had its own row
                  if (!editing) return (Number(r.incoming) || 0) + oldRefill
                  return (
                    <div>
                      {box('filled', r.size, 'incoming')}
                      {oldRefill > 0 && (
                        <div className="text-[11px] text-gray-400">+{oldRefill} refill</div>
                      )}
                    </div>
                  )
                },
                (e) => {
                  const taken = editing ? liveEmpties(e).restock : Number(e.refill) || 0
                  return (
                    <div>
                      {editing ? box('empties', e.size, 'incoming') : (e.incoming ?? '')}
                      {taken > 0 && (
                        <div className="text-[11px] text-brand-red" title="Empties taken by the restock">
                          −{taken}
                        </div>
                      )}
                    </div>
                  )
                }
              )}

              {bodyRow(
                'Total',
                (r) => (editing ? liveFilled(r).total : r.total),
                (e) => (editing ? liveEmpties(e).total : e.total),
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
                // EMPTIES: the empties given back (FILLED Sales - the ones sold as Utang)
                (e) => (
                  <span title="Empties given back by the customers">
                    {editing ? liveEmpties(e).returned : e.sales}
                  </span>
                )
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

              {/* FILLED: Actual Count = Ending + Variance. EMPTIES: Actual Count = Ending. */}
              {bodyRow(
                'Actual Count',
                (r) => (editing ? liveFilled(r).actual : (r.actual ?? r.ending)),
                (e) => (editing ? liveEmpties(e).actual : (e.actual ?? e.ending)),
                { bold: true }
              )}

              {/* FILLED: typed (leaks, swaps between branches). EMPTIES: the cylinders sold as Utang. */}
              {bodyRow(
                'Variance',
                (r) => {
                  if (editing) return box('filled', r.size, 'variance')
                  const value = Number(r.variance) || 0
                  if (value === 0) return 0
                  return (
                    <span className={`font-semibold ${value < 0 ? 'text-brand-red' : 'text-brand-pine'}`}>
                      {value > 0 ? `+${value}` : value}
                    </span>
                  )
                },
                (e) =>
                  e.variance === 0 ? (
                    0
                  ) : (
                    <span className="font-semibold text-brand-red" title="Sold as Utang (the customer kept the tank)">
                      {e.variance}
                    </span>
                  )
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 mb-0 max-w-200 text-[14px] text-gray-600">
        FILLED: Total = Beginning + Incoming/Refill, Ending Inventory = Total − Sales (orange or red
        when the stock is low), and Actual Count = Ending + Variance (the Variance is typed: leaks,
        swaps between branches). EMPTIES: Total = Beginning + Incoming − the restock (shown in red),
        Sales = the empties given back (FILLED Sales − the ones sold as Utang), Ending = Total +
        Sales, and the Variance is the cylinders sold as Utang (also in REMARKS, Borrowed).
        Tomorrow&apos;s Beginning is today&apos;s Actual Count.
      </p>
    </div>
  )
}