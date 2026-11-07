import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import usePopupMessage from '../lib/usePopupMessage'
import { BRANCHES, branchName } from '../lib/branches'
import { dateString, todayString } from '../lib/dateUtils'
import { peso } from '../lib/money'
import { expensesOfOrders, otherIncomeOfOrders } from '../lib/expenses'
import { IncomeSummary, VolumeTarget, TanksVolume } from './MonthlySheets'
import DateButton from '../components/DateButton'
import DownloadButtons from '../components/DownloadButtons'
import { entryOf, isGross, isGcash, sumAmount, soldOf } from '../lib/monthly'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'
const CELL = 'border border-(color:--border) px-3 py-2 text-center'
const LABEL = 'border border-(color:--border) px-3 py-2 text-left'
const MONEY = 'border border-(color:--border) px-3 py-2 text-right whitespace-nowrap'
const PANEL =
  'h-[calc(100vh-260px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'

// "2026-10" -> "October 2026"
const monthText = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
}

const thisMonth = () => todayString().slice(0, 7)

// typed day by day in the Daily Sales Report, added up here
const DAILY_KEYS = ['deposit', 'benta', 'add', 'gcash']

// the pages of the report
const SHEETS = [
  { key: 'branches', label: 'Sales per Branch' },
  { key: 'volume', label: 'Tanks Volume' },
  { key: 'target', label: 'Volume vs Target' },
  { key: 'income', label: 'Income Summary' },
]

// Monthly Sales Report: one row per branch for the chosen month (admin: all branches,
// staff: only their own branch, passed as the branch prop).
// Gross Sale = the amounts (after discount) of the accepted orders from the 1st to the last day.
// Deposit, Benta Tanke and Add Tanke add up the days of the Daily Sales Report (typed by the staff).
export default function MonthlySales({ branch }) {
  const isAdmin = !branch
  const shownBranches = branch ? BRANCHES.filter((b) => b.id === branch) : BRANCHES
  const [month, setMonth] = useState(thisMonth()) // 'YYYY-MM'
  const [sheet, setSheet] = useState('branches') // the page shown (admin): branches | income | target | volume
  const [sizes, setSizes] = useState([])
  const [orders, setOrders] = useState([])
  const [entries, setEntries] = useState({}) // the typed numbers, { "branch:key": amount }
  const [receipts, setReceipts] = useState([]) // filled tanks received (admin), [{ branch, size, quantity }]
  const [message, setMessage] = useState('')
  usePopupMessage(message) // a problem also pops up, so it is noticed right away
  const tableArea = useRef(null) // the table shown, for the download

  const load = async () => {
    setMessage('')
    // the month runs from midnight of the 1st to midnight of the 1st of the next month (local time)
    const from = new Date(`${month}-01T00:00:00`)
    const to = new Date(from)
    to.setMonth(to.getMonth() + 1)

    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    const ordersResult = await fetchAll(() => {
      let q = supabase
        .from('orders')
        .select('*')
        .eq('status', 'accepted')
        .gte('accepted_at', from.toISOString())
        .lt('accepted_at', to.toISOString())
        .order('id')
      if (branch) q = q.eq('branch', branch)
      return q
    })

    const error = sizesResult.error || ordersResult.error
    if (error) {
      setMessage(error.message)
      return
    }
    setSizes([...new Set(sizesResult.data.map((p) => p.size))])
    setOrders(ordersResult.data)

    // the typed numbers and the tanks received (these need supabase/monthly_report.sql), and the
    // days of the Daily Sales Report (supabase/daily_report.sql)
    const entriesResult = await supabase
      .from('monthly_entries')
      .select('branch, key, amount')
      .eq('month', `${month}-01`)
    const dailyResult = await fetchAll(() => {
      let q = supabase
        .from('daily_entries')
        .select('branch, key, amount')
        .in('key', DAILY_KEYS)
        .gte('day', `${month}-01`)
        .lt('day', dateString(to))
        .order('day')
        .order('branch')
        .order('key')
      if (branch) q = q.eq('branch', branch)
      return q
    })
    // the filled tanks received (the staff: their own branch; needs supabase/staff_monthly_receipts.sql)
    const receiptsResult = await supabase.rpc('monthly_receipts', { p_from: from.toISOString(), p_to: to.toISOString() })
    const failed = entriesResult.error || receiptsResult.error || dailyResult.error
    if (failed) setMessage(`Some numbers could not be loaded: ${failed.message}`)
    // the admin's typed numbers, then Deposit, Benta Tanke and Add Tanke from the days
    const next = Object.fromEntries(
      (entriesResult.data || [])
        .filter((e) => !DAILY_KEYS.includes(e.key))
        .map((e) => [`${e.branch}:${e.key}`, Number(e.amount)])
    )
    for (const e of dailyResult.data || []) {
      const k = `${e.branch}:${e.key}`
      next[k] = (next[k] || 0) + Number(e.amount)
    }
    setEntries(next)
    setReceipts(receiptsResult.data || [])
  }

  useEffect(() => {
    load()
  }, [month, branch])

  // save a typed number (admin), then show it right away
  const saveEntry = async (entryBranch, key, amount) => {
    setMessage('')
    const { error } = await supabase.rpc('set_monthly_entry', {
      p_month: `${month}-01`,
      p_branch: entryBranch,
      p_key: key,
      p_amount: amount,
    })
    if (error) {
      setMessage(error.message)
      return
    }
    setEntries((all) => {
      const next = { ...all }
      if (amount === null) delete next[`${entryBranch}:${key}`]
      else next[`${entryBranch}:${key}`] = amount
      return next
    })
  }

  const sizeCols = Math.max(sizes.length, 1)

  // Gross Sale, Expenses (the numbers typed in the Daily Sales Log), and Net = Gross - Expenses
  const moneyCells = (list) => {
    // the sales without Utang and Gcash, plus the Cash Other Income of the Daily Sales Log
    const gross = sumAmount(list.filter(isGross)) + otherIncomeOfOrders(list, false)
    const expenses = expensesOfOrders(list)
    return [
      <td key="gross" className={MONEY}>{peso(gross)}</td>,
      <td key="expenses" className={MONEY}>{peso(expenses)}</td>,
      <td key="net" className={MONEY}>{peso(gross - expenses)}</td>,
    ]
  }

  // after Net: Deposit, Gcash, Benta Tanke and Add Tanke (the days of the Daily Sales Report added
  // up); the total row adds up the branches.
  const middleCells = (list, rowBranch) => {
    const typed = (key) => (
      <td key={key} className={MONEY}>
        {peso(
          rowBranch
            ? entryOf(entries, rowBranch, key) || 0
            : BRANCHES.reduce((sum, b) => sum + (entryOf(entries, b.id, key) || 0), 0)
        )}
      </td>
    )
    return [
      typed('deposit'),
      <td key="gcash" className={MONEY}>
        {peso(
          sumAmount(list.filter(isGcash)) +
            otherIncomeOfOrders(list, true) +
            (rowBranch
              ? entryOf(entries, rowBranch, 'gcash') || 0
              : BRANCHES.reduce((sum, b) => sum + (entryOf(entries, b.id, 'gcash') || 0), 0))
        )}
      </td>,
      typed('benta'),
      typed('add'),
    ]
  }

  // Tanks Count: the cylinders sold in the month, per size
  const tankCells = (list) =>
    sizes.length === 0
      ? [<td key="tank" className={`${CELL} text-gray-400`}>-</td>]
      : sizes.map((size) => {
          const sold = soldOf(list, size)
          return (
            <td key={`tank-${size}`} className={CELL}>
              {sold > 0 ? sold.toLocaleString('en-PH') : '-'}
            </td>
          )
        })

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Monthly Sales Report</h1>
          <p className="m-0 text-[14px] text-gray-500">{branch ? branchName(branch) : 'All branches'} · {monthText(month)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateButton type="month" value={month} onChange={(v) => v && setMonth(v)} />
          <button className={OUTLINE} onClick={() => setMonth(thisMonth())}>This month</button>
          <button className={OUTLINE} onClick={load}>Refresh</button>
          <DownloadButtons
            getTable={() => tableArea.current?.querySelector('table')}
            title={`Monthly Sales Report - ${SHEETS.find((p) => p.key === sheet).label}`}
            subtitle={`${branch ? branchName(branch) : 'All branches'} · ${monthText(month)}`}
            filename={`Monthly Sales Report - ${SHEETS.find((p) => p.key === sheet).label} - ${branch ? branchName(branch) + ' - ' : ''}${month}`}
          />
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      {/* the pages of the report: the branches, then the pages of the paper report */}
      <div className="mb-4 flex flex-wrap gap-2">
        {SHEETS.map((p) => (
          <button
            key={p.key}
            className={sheet === p.key ? SOLID : OUTLINE}
            onClick={() => setSheet(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div ref={tableArea}>
      {sheet === 'income' && (
        <IncomeSummary orders={orders} entries={entries} canEdit={isAdmin} onSave={saveEntry} company={isAdmin} />
      )}
      {sheet === 'target' && (
        <VolumeTarget
          branches={shownBranches}
          company={isAdmin}
          orders={orders}
          sizes={sizes}
          receipts={receipts}
          entries={entries}
          canEdit={isAdmin}
          onSave={saveEntry}
        />
      )}
      {sheet === 'volume' && <TanksVolume orders={orders} sizes={sizes} branches={shownBranches} />}

      {sheet === 'branches' && (
        <>
        <div className={PANEL}>
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr>
                <th rowSpan={2} className={LABEL}>Branch</th>
                <th rowSpan={2} className={CELL}>Gross Sale</th>
                <th rowSpan={2} className={CELL}>Expenses</th>
                <th rowSpan={2} className={CELL}>Net</th>
                <th rowSpan={2} className={CELL}>Deposit</th>
                <th rowSpan={2} className={CELL}>Gcash</th>
                <th rowSpan={2} className={CELL}>Benta Tanke</th>
                <th rowSpan={2} className={CELL}>Add Tanke</th>
                <th colSpan={sizeCols} className={CELL}>Tanks Count</th>
              </tr>
              <tr>
                {sizes.length === 0 ? (
                  <th className={CELL}></th>
                ) : (
                  sizes.map((s) => (
                    <th key={s} className={CELL}>{s}</th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {shownBranches.map((b) => (
                <tr key={b.id}>
                  <td className={LABEL}>{b.name}</td>
                  {moneyCells(orders.filter((o) => o.branch === b.id))}
                  {middleCells(orders.filter((o) => o.branch === b.id), b.id)}
                  {tankCells(orders.filter((o) => o.branch === b.id))}
                </tr>
              ))}
            </tbody>
            {/* one branch only (staff): its row is already the total */}
            {isAdmin && (
              <tfoot>
                <tr className="font-bold">
                  <td className={LABEL}>Total</td>
                  {moneyCells(orders)}
                  {middleCells(orders, null)}
                  {tankCells(orders)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        </>
      )}
      </div>
    </div>
  )
}
