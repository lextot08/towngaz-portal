import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'
import { loadLowLevels, stockStatus, statusColor } from './stockStatus'
import { todayString, localDateString } from './dateUtils'
import AddStock from './AddStock'
import ManualOrder from './ManualOrder'
import UpdatePrice from './UpdatePrice'
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

const fieldStyle = { display: 'grid', gap: 4, fontSize: 14 }

export default function Staff({ user, branch }) {
  const [view, setView] = useState('main')
  const [tab, setTab] = useState('home')
  const [orders, setOrders] = useState([])
  const [stock, setStock] = useState([])
  const [levels, setLevels] = useState({})
  const [reportDate, setReportDate] = useState('') // '' means today
  const [editing, setEditing] = useState(null) // the order being edited
  const [editName, setEditName] = useState('')
  const [editRemarks, setEditRemarks] = useState('')
  const [editDelivery, setEditDelivery] = useState('preparing')
  const [message, setMessage] = useState('')

  const loadAll = async () => {
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
    loadAll()
  }, [])

  const callFunction = async (name, args) => {
    setMessage('')
    const { error } = await supabase.rpc(name, args)
    if (error) setMessage(error.message)
    await loadAll()
    return !error
  }

  if (view === 'addstock') {
    return (
      <AddStock
        branch={branch}
        onBack={() => {
          setView('main')
          loadAll()
        }}
      />
    )
  }

  if (view === 'manualorder') {
    return (
      <ManualOrder
        branch={branch}
        onBack={() => {
          setView('main')
          loadAll()
        }}
      />
    )
  }

  if (view === 'updateprice') {
    return (
      <UpdatePrice
        branch={branch}
        onBack={() => {
          setView('main')
          loadAll()
        }}
      />
    )
  }

  const pendingOrders = orders.filter((o) => o.status === 'pending')
  const acceptedOrders = orders.filter((o) => o.status === 'accepted')
  const toDeliver = acceptedOrders.filter((o) => o.delivery_status !== 'delivered')

  // Daily Sales Report: orders waiting for acceptance (any date) + accepted orders of the chosen day
  const shownDate = reportDate || todayString()
  const dayOrders = acceptedOrders.filter((o) => localDateString(o.accepted_at) === shownDate)
  const reportRows = [...pendingOrders, ...dayOrders]
  const dayTotal = dayOrders.reduce((sum, o) => sum + Number(o.total_price), 0)

  const acceptOrder = async (o) => {
    if (!(await confirmDialog('Are you sure you want to accept this order?'))) return
    await callFunction('accept_order', { p_order_id: o.id })
  }

  const startEdit = (o) => {
    setMessage('')
    setEditing(o)
    setEditName(o.customer_name || '')
    setEditRemarks(o.remarks || '')
    setEditDelivery(o.delivery_status === 'not_started' ? 'preparing' : o.delivery_status)
  }

  const saveEdit = async (e) => {
    e.preventDefault()
    if (!(await confirmDialog('Are you sure you want to save these changes?'))) return
    const ok = await callFunction('edit_order', {
      p_order_id: editing.id,
      p_name: editName,
      p_remarks: editRemarks,
      p_delivery_status: editDelivery,
    })
    if (ok) setEditing(null)
  }

  const deleteOrder = async (o) => {
    const returnsStock = o.status === 'accepted' && o.delivery_status !== 'delivered'
    const text =
      `Are you sure you want to delete this order (${o.item_name} x ${o.quantity} for ${o.customer_name})?` +
      (returnsStock ? ' The cylinders will be returned to stock.' : '')
    if (!(await confirmDialog(text))) return
    if (editing && editing.id === o.id) setEditing(null)
    await callFunction('delete_order', { p_order_id: o.id })
  }

  const tabStyle = (t) => ({
    fontWeight: tab === t ? 'bold' : 'normal',
    marginRight: 8,
  })

  return (
    <div style={{ textAlign: 'center', marginTop: 40 }}>
      <nav style={{ marginBottom: 24 }}>
        <button style={tabStyle('home')} onClick={() => setTab('home')}>Home</button>
        <button style={tabStyle('inventory')} onClick={() => setTab('inventory')}>Inventory</button>
        <button style={tabStyle('report')} onClick={() => setTab('report')}>
          Daily Sales Report{pendingOrders.length > 0 ? ` (${pendingOrders.length})` : ''}
        </button>
        <button
          onClick={async () => {
            if (await confirmDialog('Are you sure you want to log out?')) supabase.auth.signOut()
          }}
        >
          Log out
        </button>
      </nav>

      {message && <p>{message}</p>}

      {tab === 'home' && (
        <div>
          <h1>{branchName(branch)} Staff</h1>
          <p>Logged in as {user.email}</p>
          <p>Orders waiting to be accepted: {pendingOrders.length}</p>
          <p>Orders to deliver: {toDeliver.length}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
            <button onClick={() => setView('addstock')}>Add stock</button>
            <button onClick={() => setView('manualorder')}>Manual add order</button>
            <button onClick={() => setView('updateprice')}>Update price</button>
          </div>
        </div>
      )}

      {tab === 'inventory' && <InventoryTable branch={branch} />}

      {tab === 'report' && (
        <div>
          <h2>Daily Sales Report - {branchName(branch)}</h2>

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

          {editing && (
            <form
              onSubmit={saveEdit}
              style={{
                maxWidth: 360,
                margin: '0 auto 24px',
                display: 'grid',
                gap: 10,
                textAlign: 'left',
                background: '#ffffff',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 20,
              }}
            >
              <h3 style={{ margin: 0 }}>Edit order #{editing.id}</h3>
              <p style={{ margin: 0, fontSize: 14 }}>
                {editing.item_name} x {editing.quantity}
              </p>

              <label style={fieldStyle}>
                Customer name
                <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </label>

              <label style={fieldStyle}>
                Remarks
                <input
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  placeholder="For example: paid, call before delivery"
                />
              </label>

              {editing.status === 'accepted' && (
                <label style={fieldStyle}>
                  Delivery status
                  <select value={editDelivery} onChange={(e) => setEditDelivery(e.target.value)}>
                    {['preparing', 'out_for_delivery', 'delivered'].map((s) => (
                      <option key={s} value={s}>{DELIVERY_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" style={{ flex: 1 }}>Save changes</button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  style={{ flex: 1, background: '#ffffff', color: 'var(--text)', border: '1px solid var(--border)' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ margin: '0 auto' }} cellPadding="8">
              <thead>
                <tr>
                  <th>Customer name</th>
                  <th>Type</th>                  
                  <th>Product</th>
                  <th>Unit cost</th>
                  <th>Amount</th>
                  <th>Remarks</th>
                  <th>Delivery status</th>
                  <th>Action</th>
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
                    <td>
                      {o.status === 'pending' && (
                        <>
                          <button onClick={() => acceptOrder(o)}>Accept</button>{' '}
                        </>
                      )}
                      <button onClick={() => startEdit(o)}>Edit</button>{' '}
                      <button onClick={() => deleteOrder(o)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {reportRows.length === 0 && (
                  <tr><td colSpan="8">No sales on this date</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="4"><strong>Total sales on {shownDate}</strong></td>
                  <td><strong>{dayTotal.toFixed(2)}</strong></td>
                  <td colSpan="3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}