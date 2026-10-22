import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const PANEL =
  'h-[calc(100vh-260px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'
// fixed-size grid with lines like a spreadsheet
const TABLE =
  'w-full min-w-[1000px] table-fixed border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-1.5 [&_td]:py-2 [&_td]:align-top [&_td]:[overflow-wrap:anywhere] [&_th]:px-1.5 [&_th]:py-2'

const OVERALL = 0

const dateText = (value) =>
  new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const timeText = (value) =>
  new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

// Orders added together (several sizes for one customer) share a group_id: one row for them
const toRows = (list) => {
  const rows = []
  const byGroup = new Map()
  list.forEach((o) => {
    const key = o.group_id || `order-${o.id}`
    if (byGroup.has(key)) {
      byGroup.get(key).orders.push(o)
      return
    }
    const row = { key, orders: [o] }
    byGroup.set(key, row)
    rows.push(row)
  })
  return rows
}

// Tank Count > Borrowed: the orders with the Remark "Utang" (under Borrowed) or
// "Bayad Utang" (under Returned) in the Daily Sales Report, with the same quantities.
// Staff pass their own branch (fixed); the admin picks a branch or all branches.
export default function TankBorrowed({ branch: ownBranch }) {
  const [chosenBranch, setBranch] = useState(OVERALL) // 0 = all branches
  const branch = ownBranch ?? chosenBranch
  const [sizes, setSizes] = useState([])
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')

  const load = async () => {
    setMessage('')
    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    let ordersQuery = supabase
      .from('orders')
      .select(
        'id, group_id, branch, item_name, quantity, customer_name, customer_contact, customer_address, utang_status, created_at, accepted_at'
      )
      .in('utang_status', ['utang', 'bayad_utang'])
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false })
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
  }, [branch])

  const rows = toRows(orders)
  const sizeCols = Math.max(sizes.length, 1)
  const sizeWidth = 48 / (sizeCols * 2) // the size columns share 48% of the table

  // the quantities of one row: shown under Borrowed (Utang) or under Returned (Bayad Utang)
  const sizeCells = (row, kind) =>
    (sizes.length > 0 ? sizes : ['']).map((s) => {
      const qty = row.orders
        .filter((x) => x.utang_status === kind && x.item_name === 'LPG Cylinder ' + s)
        .reduce((sum, x) => sum + x.quantity, 0)
      return (
        <td key={`${kind}-${s}`} className="text-center">
          {qty > 0 ? qty : ''}
        </td>
      )
    })

  const sizeHeads = (kind) =>
    sizes.length === 0 ? (
      <th key={kind}></th>
    ) : (
      sizes.map((s) => (
        <th key={`${kind}-${s}`} className="text-center">{s}</th>
      ))
    )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Borrowed</h1>
          <p className="m-0 text-[14px] text-gray-500">
            {branch === OVERALL ? 'All branches' : branchName(branch)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ownBranch === undefined && (
            <select value={branch} onChange={(e) => setBranch(Number(e.target.value))}>
              <option value={OVERALL}>All branches</option>
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <button className={OUTLINE} onClick={load}>Refresh</button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <div className={PANEL}>
        <table className={TABLE}>
          <colgroup>
            <col style={{ width: '12%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '15%' }} />
            {Array.from({ length: sizeCols * 2 }, (_, i) => (
              <col key={i} style={{ width: `${sizeWidth}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Date/Time</th>
              <th rowSpan={2}>Customer Name</th>
              <th rowSpan={2}>Contact Number</th>
              <th rowSpan={2}>Address</th>
              <th colSpan={sizeCols} className="text-center">Returned</th>
              <th colSpan={sizeCols} className="text-center">Borrowed</th>
            </tr>
            <tr>
              {sizeHeads('returned')}
              {sizeHeads('borrowed')}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const o = row.orders[0]
              const when = o.accepted_at || o.created_at
              return (
                <tr key={row.key}>
                  <td>
                    {dateText(when)}
                    <div className="text-gray-500">{timeText(when)}</div>
                    {branch === OVERALL && (
                      <div className="text-[12px] text-gray-500">{branchName(o.branch)}</div>
                    )}
                  </td>
                  <td>{o.customer_name}</td>
                  <td>{o.customer_contact || ''}</td>
                  <td>{o.customer_address || ''}</td>
                  {sizeCells(row, 'bayad_utang')}
                  {sizeCells(row, 'utang')}
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4 + sizeCols * 2}>No Utang orders yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 mb-0 max-w-200 text-[13px] text-gray-600">
        Orders marked &quot;Utang&quot; in the Daily Sales Report are listed here with the same
        quantities under Borrowed. When the Remark is changed to &quot;Bayad Utang&quot;, the
        quantities move to Returned.
      </p>
    </div>
  )
}
