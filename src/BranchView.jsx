import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { BRANCHES, branchName } from './branches'
import { loadLowLevels, stockStatus, statusColor } from './stockStatus'
import { todayString, localDateString } from './dateUtils'

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
  const [stock, setStock] = useState([])
  const [orders, setOrders] = useState([])
  const [levels, setLevels] = useState({})
  const [reportDate, setReportDate] = useState('') // '' means today
  const [message, setMessage] = useState('')

  const load = async () => {
    setMessage('')
    const ordersResult = await supabase
      .from('orders')
      .select('*')
      .eq('branch', branch)
      .order('created_at', { ascending: false })
    const stockResult = await supabase
      .from('stock')
      .select('*')
      .eq('branch', branch)
      .order('item_name')
    if (ordersResult.error) setMessage(ordersResult.error.message)
    else setOrders(ordersResult.data)
    if (stockResult.error) setMessage(stockResult.error.message)
    else setStock(stockResult.data)
    setLevels(await loadLowLevels(supabase))
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

  const viewStyle = (v) => ({
    fontWeight: view === v ? 'bold' : 'normal',
    marginRight: 8,
  })

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

      <nav style={{ margin: '24px 0' }}>
        <button style={viewStyle('inventory')} onClick={() => setView('inventory')}>Inventory</button>
        <button style={viewStyle('report')} onClick={() => setView('report')}>Daily Sales Report</button>
      </nav>

      {message && <p>{message}</p>}

      {view === 'inventory' && (
        <div>
          <h3>{branchName(branch)} Inventory</h3>
          <table style={{ margin: '16px auto' }} cellPadding="8">
            <thead>
              <tr><th>Item</th><th>In stock</th><th>Price</th><th>Status</th></tr>
            </thead>
            <tbody>
              {stock.map((s) => (
                <tr key={s.id}>
                  <td>{s.item_name}</td>
                  <td>{s.quantity}</td>
                  <td>{Number(s.price).toFixed(2)}</td>
                  <td
                    style={{
                      color: statusColor(stockStatus(s.item_name, s.quantity, levels)),
                      fontWeight: 600,
                    }}
                  >
                    {stockStatus(s.item_name, s.quantity, levels)}
                  </td>
                </tr>
              ))}
              {stock.length === 0 && (
                <tr><td colSpan="4">No stock in this branch</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === 'report' && (
        <div>
          <h3>{branchName(branch)} Daily Sales Report</h3>

          <div style={{ marginBottom: 12 }}>
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

          <p style={{ fontSize: 14 }}>
            Orders waiting to be accepted are shown first (highlighted), whatever the date.
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ margin: '16px auto' }} cellPadding="8">
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
                  <tr key={o.id} style={o.status === 'pending' ? { background: '#fff7e0' } : undefined}>
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