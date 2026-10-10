import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'
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

// Tailwind class groups used in several places
const FIELD = 'grid gap-1 text-[14px]'
const CANCEL_BTN = 'flex-1 border border-(color:--border) bg-white text-(color:--text)'
const TABLE = 'mx-auto [&_td]:p-2 [&_th]:p-2'

export default function Staff({ user, branch }) {
  const [view, setView] = useState('main')
  const [tab, setTab] = useState('home')
  const [orders, setOrders] = useState([])
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
    if (ordersResult.error) setMessage(ordersResult.error.message)
    else setOrders(ordersResult.data)
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

  const tabClass = (t) => `mr-2 ${tab === t ? 'font-bold' : 'font-normal'}`

  return (
    <div className="mt-10 text-center">
      <nav className="mb-6">
        <button className={tabClass('home')} onClick={() => setTab('home')}>Home</button>
        <button className={tabClass('inventory')} onClick={() => setTab('inventory')}>Inventory</button>
        <button className={tabClass('report')} onClick={() => setTab('report')}>
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
          <div className="mt-6 flex flex-wrap justify-center gap-2">
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

          {editing && (
            <form
              onSubmit={saveEdit}
              className="mx-auto mb-6 grid max-w-90 gap-2.5 rounded-xl border border-(color:--border) bg-white p-5 text-left"
            >
              <h3 className="m-0">Edit order #{editing.id}</h3>
              <p className="m-0 text-[14px]">
                {editing.item_name} x {editing.quantity}
              </p>

              <label className={FIELD}>
                Customer name
                <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </label>

              <label className={FIELD}>
                Remarks
                <input
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  placeholder="For example: paid, call before delivery"
                />
              </label>

              {editing.status === 'accepted' && (
                <label className={FIELD}>
                  Delivery status
                  <select value={editDelivery} onChange={(e) => setEditDelivery(e.target.value)}>
                    {['preparing', 'out_for_delivery', 'delivered'].map((s) => (
                      <option key={s} value={s}>{DELIVERY_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="flex gap-2">
                <button type="submit" className="flex-1">Save changes</button>
                <button type="button" onClick={() => setEditing(null)} className={CANCEL_BTN}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className={TABLE}>
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