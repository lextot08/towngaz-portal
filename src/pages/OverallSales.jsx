import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES } from '../lib/branches'
import { todayString } from '../lib/dateUtils'
import DateButton from '../components/DateButton'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const CELL = 'border border-(color:--border) px-3 py-2 text-center'
const LABEL = 'border border-(color:--border) px-3 py-2 text-left'

// Overall Daily Sales Report (view only): the cylinders sold on the chosen day,
// one row per branch and one column per size, with the total of all branches at the bottom.
export default function OverallSales({ headerLeft, date, onDateChange, tableClass }) {
  const [sizes, setSizes] = useState([])
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')

  const shownDate = date || todayString()

  const load = async () => {
    setMessage('')
    // the day runs from midnight to midnight in this device's local time
    const from = new Date(`${shownDate}T00:00:00`)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)

    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    const ordersResult = await supabase
      .from('orders')
      .select('branch, item_name, quantity')
      .eq('status', 'accepted')
      .gte('accepted_at', from.toISOString())
      .lt('accepted_at', to.toISOString())

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
  }, [shownDate])

  // cylinders sold for one branch and size
  const sold = (branchId, size) =>
    orders
      .filter((o) => o.branch === branchId && o.item_name === 'LPG Cylinder ' + size)
      .reduce((sum, o) => sum + o.quantity, 0)

  const totalOf = (size) => BRANCHES.reduce((sum, b) => sum + sold(b.id, size), 0)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {headerLeft}
        <div className="flex flex-wrap items-center gap-2">
          <DateButton
            value={shownDate}
            onChange={(v) => onDateChange(!v || v === todayString() ? '' : v)}
          />
          <button className={OUTLINE} onClick={() => onDateChange('')}>Today</button>
          <button className={OUTLINE} onClick={load}>Refresh</button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <div className={tableClass}>
        <table className="w-full min-w-[600px]">
          <thead>
            <tr>
              <th className={LABEL}>Branch</th>
              {sizes.map((s) => (
                <th key={s} className={CELL}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BRANCHES.map((b) => (
              <tr key={b.id}>
                <td className={LABEL}>{b.name}</td>
                {sizes.map((s) => (
                  <td key={s} className={CELL}>{sold(b.id, s)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className={LABEL}>Total</td>
              {sizes.map((s) => (
                <td key={s} className={CELL}>{totalOf(s)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-4 mb-0 text-[14px] text-gray-600">
        Cylinders sold on {shownDate} (accepted orders), by branch and size.
      </p>
    </div>
  )
}
