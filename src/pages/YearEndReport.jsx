import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'
import { localDateString } from '../lib/dateUtils'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const CELL = 'border border-(color:--border) px-3 py-2 text-center whitespace-nowrap'
const LABEL = 'border border-(color:--border) px-3 py-2 text-left whitespace-nowrap'
const PANEL =
  'h-[calc(100vh-260px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'

const OVERALL = 0
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

// the customer types shown, in order
const TYPES = [
  { key: 'household', label: 'Household' },
  { key: 'commercial', label: 'Commercial' },
]

// "2.7kg" -> 2.7 (kilograms of LPG in one cylinder)
const kgOfSize = (size) => Number.parseFloat(size) || 0

// 27 -> "27 kg", 1234.5 -> "1,234.5 kg", 0 -> "-"
const kgText = (kg) =>
  kg === 0 ? '-' : `${kg.toLocaleString('en-PH', { maximumFractionDigits: 2 })} kg`

const thisYear = () => new Date().getFullYear()

// Year End Report: kilograms of LPG sold per month, by customer type and size.
// kg = cylinders sold x kg of the size (for example 10 x 2.7kg = 27 kg).
export default function YearEndReport() {
  const [year, setYear] = useState(thisYear())
  const [branch, setBranch] = useState(OVERALL) // 0 = all branches
  const [sizes, setSizes] = useState([])
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')

  const load = async () => {
    setMessage('')
    // the year runs from midnight of Jan 1 to midnight of Jan 1 of the next year (local time)
    const from = new Date(year, 0, 1)
    const to = new Date(year + 1, 0, 1)

    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    let ordersQuery = supabase
      .from('orders')
      .select('branch, item_name, quantity, customer_type, accepted_at')
      .eq('status', 'accepted')
      .gte('accepted_at', from.toISOString())
      .lt('accepted_at', to.toISOString())
    if (branch !== OVERALL) ordersQuery = ordersQuery.eq('branch', branch)
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
  }, [year, branch])

  // kg sold for a month (1-12, or null for the whole year), customer type, and size
  const kgSold = (month, type, size) =>
    orders
      .filter(
        (o) =>
          (o.customer_type || 'household') === type &&
          o.item_name === 'LPG Cylinder ' + size &&
          (month === null || Number(localDateString(o.accepted_at).slice(5, 7)) === month)
      )
      .reduce((sum, o) => sum + o.quantity * kgOfSize(size), 0)

  // all the household and commercial kg of a month (or of the year)
  const totalKg = (month) =>
    TYPES.reduce((sum, t) => sum + sizes.reduce((s, size) => s + kgSold(month, t.key, size), 0), 0)

  const sizeCols = Math.max(sizes.length, 1)

  // the cells of one row: every size under Household, then Commercial, then the total
  const rowCells = (month) => (
    <>
      {TYPES.map((t) =>
        sizes.length === 0 ? (
          <td key={t.key} className={CELL}></td>
        ) : (
          sizes.map((size) => (
            <td key={`${t.key}-${size}`} className={CELL}>
              {kgText(kgSold(month, t.key, size))}
            </td>
          ))
        )
      )}
      <td className={`${CELL} font-semibold`}>{kgText(totalKg(month))}</td>
    </>
  )

  const years = Array.from({ length: 6 }, (_, i) => thisYear() - i)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Year End Report</h1>
          <p className="m-0 text-[14px] text-gray-500">
            {branch === OVERALL ? 'All branches' : branchName(branch)} · {year} · kg of LPG sold
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={branch} onChange={(e) => setBranch(Number(e.target.value))}>
            <option value={OVERALL}>All branches</option>
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className={OUTLINE} onClick={load}>Refresh</button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <div className={PANEL}>
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr>
              <th rowSpan={2} className={LABEL}>Date</th>
              {TYPES.map((t) => (
                <th key={t.key} colSpan={sizeCols} className={CELL}>{t.label}</th>
              ))}
              <th rowSpan={2} className={CELL}>Total</th>
            </tr>
            <tr>
              {TYPES.map((t) =>
                sizes.length === 0 ? (
                  <th key={t.key} className={CELL}></th>
                ) : (
                  sizes.map((size) => (
                    <th key={`${t.key}-${size}`} className={CELL}>{size}</th>
                  ))
                )
              )}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((name, i) => (
              <tr key={name}>
                <td className={LABEL}>{name} - {year}</td>
                {rowCells(i + 1)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className={LABEL}>Total {year}</td>
              {rowCells(null)}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-4 mb-0 text-[14px] text-gray-600">
        Each number is the kg of LPG sold (accepted orders): cylinders sold x the kg of the size, for
        example 10 x 2.7kg = 27 kg. Total is Household + Commercial.
      </p>
    </div>
  )
}
