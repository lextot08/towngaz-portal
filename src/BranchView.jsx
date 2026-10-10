import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { BRANCHES, branchName } from './branches'
import { todayString, localDateString } from './dateUtils'
import InventoryTable from './InventoryTable'

const DELIVERY_LABELS = {
  not_started: 'Not started',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
}

const TYPE_LABELS = {
  household: 'Household',
  commercial: 'Commercial',
  rto: 'Retail Outlet',
}

export default function BranchView() {
  const [branch, setBranch] = useState(1)
  const [view, setView] = useState('inventory')
  const [orders, setOrders] = useState([])
  const [reportDate, setReportDate] = useState('') // '' means today
  const [message, setMessage] = useState('')

  const load = async () => {
    setMessage('')
    const ordersResult = await supabase
      .from('orders')
      .select('*')
      .eq('branch', branch)
      .order('created_at', { ascending: false })
    if (ordersResult.error) setMessage(ordersResult.error.message)
    else setOrders(ordersResult.data)
  }

  useEffect(() => {
    load()
  }, [branch])

  const pendingOrders = orders.filter((o) => o.status === 'pending')
  const acceptedOrders = orders.filter((o) => o.status === 'accepted')

  // Daily Sales Report: orders waiting for acceptance (any date) + accepted orders of the chosen day
  const shownDate = reportDate || todayString()
  const dayOrders = acceptedOrders.filter((o) => localDateString(o.accepted_at) === shownDate)
  const reportRows = [...pendingOrders, ...dayOrders]
  const dayTotal = dayOrders.reduce((sum, o) => sum + Number(o.total_price), 0)

  const viewClass = (v) => `mr-2 ${view === v ? 'font-bold' : 'font-normal'}`

  return (
    <div>
      <h2>Branches</h2>

      <label>
        Select branch:{' '}
        <select value={branch} onChange={(e) => setBranch(Number(e.target.value))}>
          {BRANCHES.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>{' '}
      <button onClick={load}>Refresh</button>

      <nav className="my-6">
        <button className={viewClass('inventory')} onClick={() => setView('inventory')}>
          Inventory
        </button>
        <button className={viewClass('report')} onClick={() => setView('report')}>
          Daily Sales Report
        </button>
      </nav>

      {message && <p>{message}</p>}

      {view === 'inventory' && <InventoryTable branch={branch} />}

      {view === 'report' && (
        <div>
          <h3>{branchName(branch)} Daily Sales Report</h3>

          <div className="mb-3">
            <label>
              Date:{' '}
              <input
                type="date"
                value={shownDate}
                max={todayString()}
                onChange={(e) =>
                  setReportDate(
                    !e.target.value || e.target.value === todayString() ? '' : e.target.value
                  )
                }
              />
            </label>{' '}
            <button onClick={() => setReportDate('')}>Today</button>
          </div>

          <p className="text-[14px]">
            Orders waiting to be accepted are shown first (highlighted), whatever the date.
          </p>

          <div className="overflow-x-auto">
            <table className="mx-auto my-4 [&_td]:p-2 [&_th]:p-2">
              <thead>
                <tr>
                  <th>Customer name</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Unit cost</th>
                  <th>Amount</th>
                  <th>Remarks</th>
                  <th>Delivery status</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((o) => (
                  <tr key={o.id} className={o.status === 'pending' ? 'bg-[#fff7e0]' : ''}>
                    <td>
                      {o.customer_name}
                      {o.source === 'phone' ? ' (phone)' : ''}
                    </td>
                    <td>{TYPE_LABELS[o.customer_type] || 'Household'}</td>
                    <td>{o.item_name} x {o.quantity}</td>
                    <td>{Number(o.unit_price).toFixed(2)}</td>
                    <td>{Number(o.total_price).toFixed(2)}</td>
                    <td>{o.remarks || ''}</td>
                    <td>
                      {o.status === 'pending'
                        ? 'Waiting for acceptance'
                        : DELIVERY_LABELS[o.delivery_status]}
                    </td>
                  </tr>
                ))}
                {reportRows.length === 0 && (
                  <tr><td colSpan="7">No sales on this date</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="4"><strong>Total sales on {shownDate}</strong></td>
                  <td><strong>{dayTotal.toFixed(2)}</strong></td>
                  <td colSpan="2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}