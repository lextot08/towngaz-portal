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

// The notes and totals of the lines are saved together in the day's remarks, as
// {"lines": {"swap": "...", ...}, "totals": {"swap": 3, ...}}. A remark saved before (plain text)
// is kept as "old". The totals are typed by the staff, except Borrowed (from the orders).
const parseRemarks = (text) => {
  if (!text) return { lines: {}, totals: {}, old: '' }
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object' && (value.lines || value.totals)) {
      return { lines: value.lines || {}, totals: value.totals || {}, old: value.old || '' }
    }
  } catch {
    // plain text: a remark from before the lines
  }
  return { lines: {}, totals: {}, old: text }
}

const encodeRemarks = ({ lines, totals = {}, old }) => {
  const kept = Object.fromEntries(
    Object.entries(lines)
      .map(([key, note]) => [key, String(note || '').trim()])
      .filter(([, note]) => note !== '')
  )
  const keptTotals = Object.fromEntries(
    Object.entries(totals)
      .map(([key, n]) => [key, Number(n) || 0])
      .filter(([key, n]) => key !== 'borrowed' && n > 0)
  )
  const hasTotals = Object.keys(keptTotals).length > 0
  if (Object.keys(kept).length === 0 && !hasTotals && !old) return ''
  return JSON.stringify({
    lines: kept,
    ...(hasTotals ? { totals: keptTotals } : {}),
    ...(old ? { old } : {}),
  })
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

// The Variance is always taken out of the Ending: Actual Count = Ending - Variance,
// and the next day's Beginning is the Actual Count.
// FILLED (the branch's own stock):
//   Total = Beginning + Incoming/Refill. Ending = Total - Sales.
//   Variance is typed by the staff (defective or leaked tanks, tanks given to another branch).
// ("refill" only has numbers for the days when Refill was a row of its own; it is counted in
// Incoming/Refill.) "saved" are the numbers from the database, "draft" is what is typed in Edit mode.
const calcFilled = (saved, draft) => {
  const beginning = pick(draft?.beginning ?? '', saved.beginning)
  const incoming = pick(draft?.incoming ?? '', saved.incoming)
  const refill = pick(draft?.refill ?? '', saved.refill)
  // tanks given by another branch: added to FILLED, no empties go out
  const swapIn = pick(draft?.swap_in ?? '', saved.swapIn)
  const sales = pick(draft?.sales ?? '', saved.sales)
  const variance = pick(draft?.variance ?? '', saved.variance)
  const total = beginning + incoming + refill + swapIn
  const ending = total - sales
  return { beginning, incoming, refill, swapIn, sales, total, ending, variance, actual: ending - variance }
}

// EMPTIES (based on the customers):
//   Total = Beginning - the restock (the FILLED Incoming/Refill takes empties; no empties come in).
//   Sales = the FILLED Sales (one empty for each) + borrowed tanks returned that day.
//   Ending = Total + Sales. Variance = the tanks marked Borrowed (the customer kept the tank).
// (The database gives the empties actually given back: "returned" = Sales - Variance.)
const calcEmpties = (saved, draft, filledSales, savedFilledSales, restock) => {
  const beginning = pick(draft?.beginning ?? '', saved.beginning)
  const incoming =
    draft?.incoming === undefined ? saved.incoming : draft.incoming === '' ? 0 : Number(draft.incoming)
  const total = beginning + incoming - restock
  // extra FILLED sales typed here are normal exchanges: their empties come back
  const returned = saved.returned + (filledSales - savedFilledSales)
  // typed by the staff: defective empties given by customers, and tanks sold outright (Sell: no
  // empty will come back)
  const reject = pick(draft?.reject ?? '', saved.reject)
  const variance = saved.borrowed + reject
  const sales = returned + saved.borrowed
  const ending = total + sales
  // the empties the branch has before the restock: a restock can never be more
  const beforeRestock = beginning + incoming + returned - reject
  return { beginning, incoming, restock, total, sales, ending, borrowed: saved.borrowed, reject, variance, actual: ending - variance, beforeRestock }
}

const filledSaved = (r) => ({
  beginning: r.beginning,
  incoming: r.incoming,
  refill: Number(r.refill) || 0,
  swapIn: Number(r.swap_in) || 0,
  sales: r.sold,
  // the database keeps the variance as a change of the stock (-2); here it is what is taken out (2)
  variance: r.variance ? -Number(r.variance) : 0,
})
const emptiesSaved = (e) => ({
  beginning: e.beginning,
  incoming: Number(e.incoming) || 0,
  returned: Number(e.sales) || 0, // the empties actually given back (Sales - Borrowed)
  // the Variance apart: Borrowed (automatic) and Reject (typed); older reports have only "variance"
  borrowed: Number(e.borrowed ?? e.variance) || 0,
  reject: Number(e.reject) || 0,
})


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
  const [remarksDraft, setRemarksDraft] = useState({ lines: {}, totals: {}, old: '' }) // the notes and totals while editing
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
            ['beginning', 'incoming', 'refill', 'swap_in', 'total', 'sold', 'orders_sold', 'ending', 'actual', 'variance'],
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
              ['beginning', 'incoming', 'refill', 'total', 'sales', 'ending', 'actual', 'variance', 'borrowed', 'reject'],
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
          // the typed totals of all branches, added up
          totals: Object.fromEntries(
            REMARK_LINES.map((l) => [l.key, parsed.reduce((sum, p) => sum + (Number(p.totals[l.key]) || 0), 0)])
          ),
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

  const startEdit = () => {
    setDrafts({
      filled: Object.fromEntries(
        rows.map((r) => [
          r.size,
          {
            beginning: String(r.beginning),
            incoming: String(r.incoming),
            refill: String(r.refill ?? 0),
            swap_in: String(r.swap_in ?? 0),
            sales: String(r.sold),
            variance: String(filledSaved(r).variance),
          },
        ])
      ),
      empties: Object.fromEntries(
        emptyRows.map((e) => [
          e.size,
          {
            beginning: String(e.beginning),
            reject: String(Number(e.reject) || 0),
          },
        ])
      ),
    })
    setRemarksDraft(parseRemarks(remarks))
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
      const row = { size: item.size, beginning: '', incoming: '', refill: '', swap_in: '', sales: '', variance: '' }
      let changed = false
      ;['beginning', 'incoming', 'refill', 'swap_in', 'sales', 'variance'].forEach((field) => {
        const savedValue = field === 'swap_in' ? saved.swapIn : saved[field]
        if (d[field] !== undefined && d[field] !== '' && Number(d[field]) !== savedValue) {
          // the variance is saved as a change of the stock: taking out 2 = -2
          row[field] = field === 'variance' ? String(-Number(d[field])) : d[field]
          changed = true
        }
      })
      return changed ? [row] : []
    })

  // EMPTIES: only the Beginning is typed (empty = unchanged); nothing comes in from outside,
  // and everything else of the EMPTIES is calculated.
  const collectEmptiesChanges = () =>
    emptyRows.flatMap((e) => {
      const d = drafts.empties?.[e.size]
      if (!d) return []
      const row = { size: e.size, beginning: '', incoming: '', total: '', reject: '' }
      let changed = false
      if (d.beginning !== '' && Number(d.beginning) !== e.beginning) {
        row.beginning = d.beginning
        changed = true
      }
      // Reject / Sell: defective empties, and tanks sold outright ('clear' = none)
      if (d.reject !== undefined && (Number(d.reject) || 0) !== (Number(e.reject) || 0)) {
        row.reject = (Number(d.reject) || 0) === 0 ? 'clear' : d.reject
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

  // REMARKS > Borrowed: the tanks marked Borrowed that day (the EMPTIES Variance of every size)
  const borrowedTotal = emptyRows.reduce((sum, e) => sum + emptiesSaved(e).borrowed, 0)

  // ---- Check: the REMARKS totals against what was typed in the table (a warning only) ----
  // Swap, Reject, Backload and Sell are the typed Variances (FILLED Variance, EMPTIES Reject / Sell)
  // and the Swap in; a Sell is always in the EMPTIES Reject / Sell; a Buy is part of Incoming/Refill.
  const sumOf = (list, value) => list.reduce((sum, x) => sum + (Number(value(x)) || 0), 0)
  const typedTotals = editing ? remarksDraft.totals : shownRemarks.totals
  const remarkTotal = (key) => Number(typedTotals[key]) || 0
  const filledVariance = sumOf(rows, (r) => (editing ? liveFilled(r).variance : filledSaved(r).variance))
  const swapInTotal = sumOf(rows, (r) => (editing ? liveFilled(r).swapIn : r.swap_in))
  const restockTotal = sumOf(rows, (r) =>
    editing ? liveFilled(r).incoming + liveFilled(r).refill : (Number(r.incoming) || 0) + (Number(r.refill) || 0)
  )
  const emptiesTyped = sumOf(emptyRows, (e) => (editing ? liveEmpties(e).reject : emptiesSaved(e).reject))
  const remarksSum = ['swap', 'reject', 'backload', 'sell'].reduce((sum, k) => sum + remarkTotal(k), 0)
  const typedSum = filledVariance + emptiesTyped + swapInTotal
  const mismatches = overall
    ? []
    : [
        remarksSum !== typedSum &&
          `REMARKS Swap + Reject + Backload + Sell = ${remarksSum}, but the table has ${typedSum} (FILLED Variance ${filledVariance} + EMPTIES Reject / Sell ${emptiesTyped} + Swap in ${swapInTotal}).`,
        remarkTotal('sell') > emptiesTyped &&
          `REMARKS Sell is ${remarkTotal('sell')}, but the EMPTIES Reject / Sell is only ${emptiesTyped}: a tank sold outright goes in the EMPTIES Reject / Sell.`,
        remarkTotal('buy') > restockTotal &&
          `REMARKS Buy is ${remarkTotal('buy')}, but the FILLED Incoming/Refill is only ${restockTotal}: a Buy is part of Incoming/Refill.`,
      ].filter(Boolean)

  // a box to type a number in
  const box = (group, size, field) => (
    <input
      className={NUMBER_INPUT}
      inputMode="numeric"
      placeholder={field === 'variance' ? '0' : undefined}
      title={field === 'variance' ? 'Taken out of the Ending, for example 2 defective tanks' : undefined}
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
                  {/* total: Borrowed = the tanks customers kept (from the orders); the others are typed */}
                  {line.key === 'borrowed' ? (
                    borrowedTotal > 0 ? borrowedTotal : ''
                  ) : editing ? (
                    <input
                      className="box-border w-full min-w-0 p-1 text-center text-[13px]"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="0"
                      aria-label={`${line.label} total`}
                      value={remarksDraft.totals[line.key] ?? ''}
                      onChange={(e) =>
                        setRemarksDraft((d) => ({
                          ...d,
                          totals: { ...d.totals, [line.key]: e.target.value.replace(/\D/g, '') },
                        }))
                      }
                    />
                  ) : (
                    shownRemarks.totals[line.key] || ''
                  )}
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
          EMPTIES, so it can never be more than the empties), Swap in (tanks given by another branch:
          the EMPTIES do not change), Sales (the orders in the Daily Sales
          Report are already counted, shown as &quot;min&quot;), and Variance: the tanks taken out of the
          Ending, for example 2 for 2 defective or leaked tanks, 3 when giving 3 to another branch. This
          changes the real stock. EMPTIES: type the Beginning and, in the Variance (Reject / Sell), the
          defective empties given by customers and the tanks sold outright (Sell: the sale is in Sales,
          but no empty will come back); the Borrowed tanks are added by themselves. REMARKS: type the
          totals of Swap, Reject, Backload, Sell and Buy (Borrowed is counted from the orders); a Buy
          (cylinders bought from another company) is typed in Incoming/Refill, with a note in Buy.
        </p>
      )}

      {/* the REMARKS totals do not match the table: a warning, saving is still allowed */}
      {rows.length > 0 && mismatches.length > 0 && (
        <div className="mb-4 max-w-200 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          <strong>Please check the REMARKS totals:</strong>
          <ul className="mt-1 mb-0 pl-5">
            {mismatches.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
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

              {/* Incoming/Refill: typed in FILLED; the same number goes out of the EMPTIES.
                  Swap in (tanks given by another branch) is added to FILLED without taking empties. */}
              {bodyRow(
                'Incoming/Refill',
                (r) => {
                  const oldRefill = Number(r.refill) || 0 // from the days when Refill had its own row
                  const swapIn = Number(r.swap_in) || 0
                  if (!editing) {
                    return (
                      <span className="grid">
                        <span>{(Number(r.incoming) || 0) + oldRefill}</span>
                        {swapIn > 0 && (
                          <span className="text-[11px] font-semibold text-brand-pine" title="Given by another branch">
                            +{swapIn} swap in
                          </span>
                        )}
                      </span>
                    )
                  }
                  return (
                    <div className="grid justify-items-center gap-1">
                      {box('filled', r.size, 'incoming')}
                      {oldRefill > 0 && (
                        <div className="text-[11px] text-gray-400">+{oldRefill} refill</div>
                      )}
                      <label className="grid justify-items-center text-[10px] text-gray-500">
                        Swap in
                        {box('filled', r.size, 'swap_in')}
                      </label>
                    </div>
                  )
                },
                // EMPTIES: nothing comes in; every restock takes the same number of empties out
                (e) => {
                  const taken = editing ? liveEmpties(e).restock : Number(e.refill) || 0
                  const old = Number(e.incoming) || 0 // only from days when empties could be typed in
                  if (taken === 0 && old === 0) return 0
                  return (
                    <span className="grid">
                      {taken > 0 && (
                        <span className="font-semibold text-brand-red" title="Empties taken by the restock">
                          −{taken}
                        </span>
                      )}
                      {old > 0 && <span className="text-[11px] text-gray-400">+{old} typed before</span>}
                    </span>
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
                // EMPTIES: one empty for each FILLED sale, + borrowed tanks returned
                (e) => (editing ? liveEmpties(e).sales : (Number(e.sales) || 0) + emptiesSaved(e).borrowed)
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
                (e) => (editing ? liveEmpties(e).ending : (Number(e.ending) || 0) + emptiesSaved(e).borrowed)
              )}

              {/* Actual Count = Ending - Variance (FILLED and EMPTIES) */}
              {bodyRow(
                'Actual Count',
                (r) => (editing ? liveFilled(r).actual : (r.actual ?? r.ending)),
                (e) => (editing ? liveEmpties(e).actual : (e.actual ?? e.ending)),
                { bold: true }
              )}

              {/* FILLED: typed (defects, swaps between branches).
                  EMPTIES: the tanks marked Borrowed (automatic) + Reject / Sell (typed). */}
              {bodyRow(
                'Variance',
                (r) => {
                  if (editing) return box('filled', r.size, 'variance')
                  const value = filledSaved(r).variance
                  if (value === 0) return 0
                  return <span className="font-semibold text-brand-red">{value}</span>
                },
                (e) => {
                  const { borrowed } = emptiesSaved(e)
                  if (editing) {
                    return (
                      <div className="grid justify-items-center gap-0.5">
                        <label className="grid justify-items-center text-[10px] text-gray-500">
                          Reject / Sell
                          {box('empties', e.size, 'reject')}
                        </label>
                        {borrowed > 0 && (
                          <span className="text-[11px] text-gray-500">+{borrowed} borrowed</span>
                        )}
                      </div>
                    )
                  }
                  const { reject } = emptiesSaved(e)
                  if (borrowed + reject === 0) return 0
                  return (
                    <span className="grid">
                      <span className="font-semibold text-brand-red">{borrowed + reject}</span>
                      <span className="text-[11px] text-gray-500">
                        {[borrowed > 0 && `${borrowed} borrowed`, reject > 0 && `${reject} reject/sell`]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </span>
                  )
                }
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 mb-0 max-w-200 text-[14px] text-gray-600">
        FILLED: Total = Beginning + Incoming/Refill + Swap in, Ending Inventory = Total − Sales (orange or red
        when the stock is low), and the Variance is typed (defective or leaked tanks, tanks given to
        another branch). EMPTIES: Total = Beginning − the restock (shown in red; no empties come in),
        Sales = one empty for each FILLED sale + borrowed tanks returned that day, Ending = Total +
        Sales, and the Variance is the tanks marked Borrowed (also in REMARKS, Borrowed) plus the
        the Reject / Sell typed by the staff (defective empties, tanks sold outright). In both,
        Actual Count = Ending − Variance, and tomorrow&apos;s Beginning is today&apos;s Actual Count.
      </p>
    </div>
  )
}