import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'
import { todayString } from '../lib/dateUtils'
import { peso } from '../lib/money'
import { expensesOfOrders } from '../lib/expenses'
import { IncomeSummary, VolumeTarget, TanksVolume } from './MonthlySheets'

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

// a cell that has no data yet
const blank = (key) => (
  <td key={key} className={`${CELL} text-gray-400`}>-</td>
)

// Monthly Sales Report: one row per branch for the chosen month (admin: all branches,
// staff: only their own branch, passed as the branch prop).
// Gross Sale = the amounts (after discount) of the accepted orders from the 1st to the last day.
// The other columns are blank for now.
export default function MonthlySales({ branch }) {
  const shownBranches = branch ? BRANCHES.filter((b) => b.id === branch) : BRANCHES
  const [month, setMonth] = useState(thisMonth()) // 'YYYY-MM'
  const [sheet, setSheet] = useState('branches') // the page shown (admin): branches | income | target | volume
  const [sizes, setSizes] = useState([])
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')

  const load = async () => {
    setMessage('')
    // the month runs from midnight of the 1st to midnight of the 1st of the next month (local time)
    const from = new Date(`${month}-01T00:00:00`)
    const to = new Date(from)
    to.setMonth(to.getMonth() + 1)

    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    let ordersQuery = supabase
      .from('orders')
      .select('id, group_id, branch, item_name, quantity, total_price, discount, remarks, utang_status, paid_gcash')
      .eq('status', 'accepted')
      .gte('accepted_at', from.toISOString())
      .lt('accepted_at', to.toISOString())
    if (branch) ordersQuery = ordersQuery.eq('branch', branch)
    const ordersResult = await ordersQuery

    const error = sizesResult.error || ordersResult.error
    if (error) {
      setMessage(error.message)
      return
    }
    setSizes(sizesResult.data.map((p) => p.size))
    setOrders(ordersResult.data)
  }

  useEffect(() => {
    load()
  }, [month, branch])

  // the amount of one order after its discount, like the Daily Sales Report
  const amountOf = (o) => Number(o.total_price) - Number(o.discount || 0)

  const sizeCols = Math.max(sizes.length, 1)

  // the orders paid through Gcash (Remark "Thru Gcash"); an Utang (money lent) is not paid yet
  const isGcash = (o) => o.paid_gcash && o.utang_status !== 'utang'
  // the orders in the Gross Sale: not Utang (money lent) and not paid through Gcash
  const isGross = (o) => o.utang_status !== 'utang' && !o.paid_gcash

  // Gross Sale, Expenses (the numbers typed in the Daily Sales Report), and Net = Gross - Expenses
  const moneyCells = (list) => {
    const gross = list.filter(isGross).reduce((sum, o) => sum + amountOf(o), 0)
    const expenses = expensesOfOrders(list)
    return [
      <td key="gross" className={MONEY}>{peso(gross)}</td>,
      <td key="expenses" className={MONEY}>{peso(expenses)}</td>,
      <td key="net" className={MONEY}>{peso(gross - expenses)}</td>,
    ]
  }

  // after Net: Deposit (blank for now), Gcash, Benta Tanke and Add Tanke (blank for now)
  const middleCells = (list) => [
    blank('deposit'),
    <td key="gcash" className={MONEY}>
      {peso(list.filter(isGcash).reduce((sum, o) => sum + amountOf(o), 0))}
    </td>,
    blank('benta'),
    blank('add'),
  ]

  // Tanks Count: the cylinders sold in the month, per size
  const tankCells = (list) =>
    sizes.length === 0
      ? [blank('tank')]
      : sizes.map((size) => {
          const sold = list
            .filter((o) => o.item_name === 'LPG Cylinder ' + size)
            .reduce((sum, o) => sum + Number(o.quantity || 0), 0)
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
          <label className={`${OUTLINE} flex items-center gap-2`}>
            Month:
            <input
              type="month"
              className="border-0 p-0 text-brand-pine"
              value={month}
              max={thisMonth()}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </label>
          <button className={OUTLINE} onClick={() => setMonth(thisMonth())}>This month</button>
          <button className={OUTLINE} onClick={load}>Refresh</button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      {/* the pages of the report (admin): the branches, then the pages of the paper report */}
      {!branch && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: 'branches', label: 'Sales per Branch' },
            { key: 'volume', label: 'Tanks Volume' },
            { key: 'target', label: 'Volume vs Target' },
            { key: 'income', label: 'Income Summary' },
          ].map((p) => (
            <button
              key={p.key}
              className={sheet === p.key ? SOLID : OUTLINE}
              onClick={() => setSheet(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {sheet === 'income' && <IncomeSummary />}
      {sheet === 'target' && <VolumeTarget />}
      {sheet === 'volume' && <TanksVolume sizes={sizes} />}

      {(branch || sheet === 'branches') && (
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
                  {middleCells(orders.filter((o) => o.branch === b.id))}
                  {tankCells(orders.filter((o) => o.branch === b.id))}
                </tr>
              ))}
            </tbody>
            {/* one branch only (staff): its row is already the total */}
            {!branch && (
              <tfoot>
                <tr className="font-bold">
                  <td className={LABEL}>Total</td>
                  {moneyCells(orders)}
                  {middleCells(orders)}
                  {tankCells(orders)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="mt-4 mb-0 text-[14px] text-gray-600">
          Gross Sale is the total amount (after discounts) of the orders from the 1st to the last day of
          {monthText(month)}, without the ones marked Utang (money lent) or Thru Gcash. Gcash is the
          total of the orders marked Thru Gcash. Expenses is the sum of the numbers typed in the Expenses
          column of the Daily Sales Report (for example &quot;gas 70 others 30&quot; = ₱100). Net =
          Gross Sale - Expenses. Tanks Count is the number of cylinders sold in the month, per size.
        </p>
        </>
      )}
    </div>
  )
}
