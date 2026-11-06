import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import usePopupMessage from '../lib/usePopupMessage'
import { branchName } from '../lib/branches'
import { dateString, localDateString, todayString } from '../lib/dateUtils'
import { peso } from '../lib/money'
import { expensesOfOrders, otherIncomeOfOrders } from '../lib/expenses'
import { isGcash, isGross, soldOf, sumAmount } from '../lib/monthly'
import { Entry } from './MonthlySheets'
import DateButton from '../components/DateButton'
import DownloadButtons from '../components/DownloadButtons'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const CELL = 'border border-(color:--border) px-2 py-1.5 text-center'
const LABEL = 'border border-(color:--border) px-3 py-1.5 text-left whitespace-nowrap'
const MONEY = 'border border-(color:--border) px-2 py-1.5 text-right whitespace-nowrap'
const PANEL = 'overflow-auto rounded-xl border border-(color:--border) bg-white'

// "2026-10" -> "October 2026"
const monthText = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
}
// "2026-10-05" -> "Oct 5"
const dayText = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

// Daily Sales Report: one row per day of the chosen month.
// From the Daily Sales Log (automatic): Gross (without Utang and Gcash), Expenses, Gcash,
// Net = Gross - Expenses, and the tanks sold per size.
// Typed by the staff (double-click): Benta Tanke, DF (delivery fee), Deposit and Add Tanke.
// branch = one branch; no branch = all branches added up (view only).
export default function DailySalesReport({ branch, canEdit = false, headerLeft = null, tableClass }) {
  const thisMonth = todayString().slice(0, 7)
  const [month, setMonth] = useState(thisMonth) // 'YYYY-MM'
  const [sizes, setSizes] = useState([])
  const [orders, setOrders] = useState([])
  const [entries, setEntries] = useState({}) // { "day:key": amount }, all branches added up
  const [message, setMessage] = useState('')
  usePopupMessage(message) // a problem also pops up, so it is noticed right away
  const tableRef = useRef(null) // for the download

  const load = async () => {
    setMessage('')
    const from = new Date(`${month}-01T00:00:00`)
    const to = new Date(from)
    to.setMonth(to.getMonth() + 1)

    let ordersQuery = supabase
      .from('orders')
      .select('*')
      .eq('status', 'accepted')
      .gte('accepted_at', from.toISOString())
      .lt('accepted_at', to.toISOString())
    let entriesQuery = supabase
      .from('daily_entries')
      .select('day, branch, key, amount')
      .gte('day', `${month}-01`)
      .lt('day', dateString(to))
    if (branch) {
      ordersQuery = ordersQuery.eq('branch', branch)
      entriesQuery = entriesQuery.eq('branch', branch)
    }
    const [sizesResult, ordersResult, entriesResult] = await Promise.all([
      supabase.from('lpg_prices').select('size').order('sort_order'),
      ordersQuery,
      entriesQuery,
    ])

    const error = sizesResult.error || ordersResult.error
    if (error) {
      setMessage(error.message)
      return
    }
    setSizes([...new Set(sizesResult.data.map((p) => p.size))])
    setOrders(ordersResult.data)
    if (entriesResult.error) {
      setMessage(`The typed numbers could not be loaded: ${entriesResult.error.message}`)
    }
    const sums = {}
    for (const e of entriesResult.data || []) {
      const k = `${e.day}:${e.key}`
      sums[k] = (sums[k] || 0) + Number(e.amount)
    }
    setEntries(sums)
  }

  useEffect(() => {
    load()
  }, [month, branch])

  // save a typed number of a day, then show it right away
  const saveEntry = async (day, key, amount) => {
    setMessage('')
    const { error } = await supabase.rpc('set_daily_entry', {
      p_day: day,
      p_branch: branch,
      p_key: key,
      p_amount: amount,
    })
    if (error) {
      setMessage(error.message)
      return
    }
    setEntries((all) => {
      const next = { ...all }
      if (amount === null) delete next[`${day}:${key}`]
      else next[`${day}:${key}`] = amount
      return next
    })
  }

  // every day of the month, up to today
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const today = todayString()
  const days = Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter(
    (d) => d <= today
  )

  const ordersOn = (day) => orders.filter((o) => localDateString(o.accepted_at) === day)
  const typedOf = (day, key) => entries[`${day}:${key}`] ?? null
  const typedTotal = (key, list) => list.reduce((sum, d) => sum + (typedOf(d, key) || 0), 0)
  // the first half of the month (the 1st to the 15th), for the subtotal row
  const firstHalf = days.filter((d) => Number(d.slice(8)) <= 15)
  const ordersOfDays = (list) => orders.filter((o) => list.includes(localDateString(o.accepted_at)))

  const sizeCols = Math.max(sizes.length, 1)
  const editable = canEdit && Boolean(branch)

  // Gcash: from the log (Thru Gcash orders, Gcash Other Income), plus the amount typed for the day
  // (for example a debt from before the system paid through Gcash)
  const gcashCell = (list, day, dayList) => {
    const fromLog = sumAmount(list.filter(isGcash)) + otherIncomeOfOrders(list, true)
    if (!day) {
      return <td key="gcash" className={MONEY}>{peso(fromLog + typedTotal('gcash', dayList))}</td>
    }
    return (
      <Entry
        key="gcash"
        as="td"
        className={MONEY}
        value={typedOf(day, 'gcash')}
        canEdit={editable}
        onSave={(v) => saveEntry(day, 'gcash', v)}
        empty={peso(fromLog)}
        format={(v) => (
          <span className="grid">
            <span>{peso(fromLog + v)}</span>
            <span className="text-[10px] leading-3 text-violet-700">incl. {peso(v)} typed</span>
          </span>
        )}
      />
    )
  }

  // the cells of one day, or the totals of several days (dayList: the subtotal and total rows)
  const cells = (list, day, dayList = days) => {
    // Gross: the sales without Utang and Gcash, plus the Cash Other Income of the log
    const gross = sumAmount(list.filter(isGross)) + otherIncomeOfOrders(list, false)
    const expenses = expensesOfOrders(list)
    const typed = (key) =>
      day ? (
        <Entry
          key={key}
          as="td"
          className={MONEY}
          value={typedOf(day, key)}
          canEdit={editable}
          onSave={(v) => saveEntry(day, key, v)}
        />
      ) : (
        <td key={key} className={MONEY}>{peso(typedTotal(key, dayList))}</td>
      )
    return [
      <td key="gross" className={MONEY}>{peso(gross)}</td>,
      typed('benta'),
      <td key="expenses" className={MONEY}>{peso(expenses)}</td>,
      gcashCell(list, day, dayList),
      <td key="net" className={`${MONEY} font-semibold`}>{peso(gross - expenses)}</td>,
      typed('df'),
      typed('deposit'),
      ...(sizes.length === 0
        ? [<td key="tank" className={`${CELL} text-gray-400`}>-</td>]
        : sizes.map((s) => {
            const sold = soldOf(list, s)
            return (
              <td key={`tank-${s}`} className={CELL}>
                {sold > 0 ? sold.toLocaleString('en-PH') : '-'}
              </td>
            )
          })),
      typed('add'),
    ]
  }

  const place = branch ? branchName(branch) : 'All branches'

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {headerLeft ?? (
          <div>
            <h1 className="m-0 text-2xl">Daily Sales Report</h1>
            <p className="m-0 text-[14px] text-gray-500">{place} · {monthText(month)}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <DateButton type="month" value={month} onChange={(v) => v && setMonth(v)} />
          <button className={OUTLINE} onClick={() => setMonth(thisMonth)}>This month</button>
          <button className={OUTLINE} onClick={load}>Refresh</button>
          <DownloadButtons
            getTable={() => tableRef.current}
            title="Daily Sales Report"
            subtitle={`${place} · ${monthText(month)}`}
            filename={`Daily Sales Report - ${place} - ${month}`}
          />
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <div className={tableClass ?? PANEL}>
        <table ref={tableRef} className="w-full min-w-[980px] text-[14px]">
          <thead>
            <tr>
              <th rowSpan={2} className={LABEL}>Date</th>
              <th rowSpan={2} className={CELL}>Gross</th>
              <th rowSpan={2} className={CELL}>Benta Tanke</th>
              <th rowSpan={2} className={CELL}>Expenses</th>
              <th rowSpan={2} className={CELL}>Gcash</th>
              <th rowSpan={2} className={CELL}>Net</th>
              <th rowSpan={2} className={CELL}>DF</th>
              <th rowSpan={2} className={CELL}>Deposit</th>
              <th colSpan={sizeCols} className={CELL}>Total Tanks Sales</th>
              <th rowSpan={2} className={CELL}>Add Tanke</th>
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
            {days.map((d) => (
              <Fragment key={d}>
                <tr>
                  <td className={LABEL}>{dayText(d)}</td>
                  {cells(ordersOn(d), d)}
                </tr>
                {/* the subtotal of the 1st to the 15th, between the 15th and the 16th */}
                {d.endsWith('-15') && (
                  <tr className="bg-[#eef6f3] font-semibold">
                    <td className={LABEL}>Subtotal (1–15)</td>
                    {cells(ordersOfDays(firstHalf), null, firstHalf)}
                  </tr>
                )}
              </Fragment>
            ))}
            {days.length === 0 && (
              <tr>
                <td colSpan={9 + sizeCols} className={CELL}>No days yet in {monthText(month)}</td>
              </tr>
            )}
          </tbody>
          {days.length > 0 && (
            <tfoot>
              <tr className="font-bold">
                <td className={LABEL}>Total</td>
                {cells(orders, null)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-4 mb-0 max-w-200 text-[13px] text-gray-600">
        Gross, Expenses, Gcash and the tanks sold come from the Daily Sales Log of each day (Gross
        leaves out Utang and Thru Gcash, and adds the Cash Other Income; the Gcash Other Income is in Gcash). Net = Gross − Expenses.
        {editable
          ? ' Double-click Benta Tanke, DF (delivery fee), Deposit or Add Tanke to type the amount of that day, or Gcash to add Gcash received that is not in the log (for example an old debt paid through Gcash).'
          : ' Benta Tanke, DF (delivery fee), Deposit and Add Tanke are typed by the staff of each branch.'}{' '}
        The Monthly Sales Report adds up these days.
      </p>
    </div>
  )
}
