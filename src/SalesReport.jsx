import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'
import { todayString, localDateString } from './dateUtils'
import { peso } from './money'

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

const TYPE_OPTIONS = [
  { value: 'household', label: 'Household' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'rto', label: 'Retail Outlet' },
]

const SOURCE_LABELS = {
  phone: ' (phone)',
  walkin: ' (walk-in)',
}

// "LPG Cylinder 11kg" -> "11kg"
const sizeOf = (itemName) => itemName.replace('LPG Cylinder ', '')

// Tailwind class groups used in several places
const FIELD = 'grid gap-1 text-[14px]'
const CANCEL_BTN = 'flex-1 border border-(color:--border) bg-white text-(color:--text)'
const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const TABLE = 'w-full min-w-[900px] [&_td]:p-2 [&_th]:p-2'

// The Daily Sales Report, used by the staff page and by the admin's Branches page.
// canEdit = true shows Accept / Edit / Delete (staff, and the admin on Caloocan).
export default function SalesReport({
  branch,
  orders,
  reload, // reloads the orders in the page that owns them
  canEdit = false,
  headerLeft = null, // replaces the title on the left of the top row
  showRefresh = false,
  date: dateProp, // the admin page controls the date, the staff page does not
  onDateChange,
  tableClass, // lets the admin page give the table a fixed size
}) {
  const [ownDate, setOwnDate] = useState('')
  const reportDate = dateProp ?? ownDate // '' means today
  const setReportDate = onDateChange ?? setOwnDate

  const [extra, setExtra] = useState({ sizes: [], stock: [] })
  const [editing, setEditing] = useState(null) // the order being edited
  const [editName, setEditName] = useState('')
  const [editRemarks, setEditRemarks] = useState('')
  const [editDiscount, setEditDiscount] = useState('') // total discount in pesos, empty = none
  const [editDelivery, setEditDelivery] = useState('preparing')
  const [addNew, setAddNew] = useState(false) // also add a new order for this customer
  const [newSize, setNewSize] = useState('')
  const [newQty, setNewQty] = useState('')
  const [newType, setNewType] = useState('household')
  const [newSource, setNewSource] = useState('walkin')
  const [message, setMessage] = useState('')

  // sizes and stock, used by "add a new order" in the Edit form
  const loadExtra = async () => {
    if (!canEdit) return
    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    const stockResult = await supabase
      .from('stock')
      .select('item_name, quantity')
      .eq('branch', branch)
    setExtra({
      sizes: sizesResult.data ? sizesResult.data.map((p) => p.size) : [],
      stock: stockResult.data || [],
    })
  }

  useEffect(() => {
    loadExtra()
  }, [branch, canEdit])

  // close the edit form when another branch is chosen
  useEffect(() => {
    setEditing(null)
    setMessage('')
  }, [branch])

  const callFunction = async (name, args) => {
    setMessage('')
    const { error } = await supabase.rpc(name, args)
    if (error) setMessage(error.message)
    await reload()
    await loadExtra()
    return !error
  }

  const pendingOrders = orders.filter((o) => o.status === 'pending')
  const acceptedOrders = orders.filter((o) => o.status === 'accepted')

  // Daily Sales Report: orders waiting for acceptance (any date) + accepted orders of the chosen day
  const shownDate = reportDate || todayString()
  const dayOrders = acceptedOrders.filter((o) => localDateString(o.accepted_at) === shownDate)
  const reportRows = [...pendingOrders, ...dayOrders]
  const dayTotal = dayOrders.reduce((sum, o) => sum + Number(o.total_price), 0)

  // numbers for the "add a new order" part of the Edit form
  const newStockRow = extra.stock.find((s) => s.item_name === 'LPG Cylinder ' + newSize)
  const newAvailable = newStockRow ? newStockRow.quantity : 0

  // numbers for the discount box
  const editAmount = editing ? editing.quantity * Number(editing.unit_price) : 0
  const typedDiscount = Number(editDiscount)
  const discountIsValid =
    editDiscount !== '' && Number.isFinite(typedDiscount) && typedDiscount > 0 && typedDiscount < editAmount

  const acceptOrder = async (o) => {
    if (!(await confirmDialog('Are you sure you want to accept this order?'))) return
    await callFunction('accept_order', { p_order_id: o.id })
  }

  const startEdit = (o) => {
    setMessage('')
    setEditing(o)
    setEditName(o.customer_name || '')
    setEditRemarks(o.remarks || '')
    setEditDiscount(Number(o.discount) > 0 ? Number(o.discount).toFixed(2) : '')
    setEditDelivery(o.delivery_status === 'not_started' ? 'preparing' : o.delivery_status)
    setAddNew(false)
    setNewSize(extra.sizes[0] || '')
    setNewQty('')
    setNewType(o.customer_type || 'household')
    setNewSource('walkin')
  }

  // only digits are allowed: no minus sign, decimal point, or letters
  const handleNewQty = (e) => setNewQty(e.target.value.replace(/\D/g, ''))

  // digits and one decimal point, with at most 2 digits after it (for example 15.50)
  const handleDiscount = (e) => {
    let value = e.target.value.replace(/[^0-9.]/g, '')
    const firstDot = value.indexOf('.')
    if (firstDot !== -1) {
      value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '').slice(0, 2)
    }
    setEditDiscount(value)
  }

  const saveEdit = async (e) => {
    e.preventDefault()
    setMessage('')

    // discount: empty means no discount; otherwise it must be more than 0 and less than the amount
    let discountToSend = 0
    if (editDiscount !== '') {
      if (!Number.isFinite(typedDiscount) || typedDiscount <= 0) {
        setMessage('Discount must be more than ₱0. Leave it empty for no discount.')
        return
      }
      if (typedDiscount >= editAmount) {
        setMessage(`Discount must be less than the order amount (${peso(editAmount)})`)
        return
      }
      discountToSend = typedDiscount
    }

    const qty = Number(newQty)
    if (addNew) {
      if (!newSize) {
        setMessage('Please select a size for the new order')
        return
      }
      if (!Number.isInteger(qty) || qty < 1) {
        setMessage('Quantity of the new order must be a whole number of at least 1')
        return
      }
      if (qty > newAvailable) {
        setMessage(`Only ${newAvailable} in stock for this size`)
        return
      }
    }

    const discountText =
      discountToSend > 0
        ? ` A discount of ${peso(discountToSend)} will be applied.`
        : Number(editing.discount) > 0
          ? ' The discount will be removed.'
          : ''
    const question = addNew
      ? `Are you sure you want to save these changes and add a new ${TYPE_LABELS[newType]} order (${newSize} x ${qty}) for this customer?${discountText}`
      : `Are you sure you want to save these changes?${discountText}`
    if (!(await confirmDialog(question))) return

    const ok = await callFunction('edit_order', {
      p_order_id: editing.id,
      p_name: editName,
      p_remarks: editRemarks,
      p_delivery_status: editDelivery,
      p_discount: discountToSend,
    })
    if (!ok) return

    if (addNew) {
      const added = await callFunction('add_additional_order', {
        p_from_order_id: editing.id,
        p_size: newSize,
        p_quantity: qty,
        p_customer_type: newType,
        p_source: newSource,
      })
      if (!added) return
    }
    setEditing(null)
  }

  const deleteOrder = async (o) => {
    const returnsStock = o.status === 'accepted' && o.delivery_status !== 'delivered'
    const text =
      `Are you sure you want to delete this order (${sizeOf(o.item_name)} x ${o.quantity} for ${o.customer_name})?` +
      (returnsStock ? ' The cylinders will be returned to stock.' : '')
    if (!(await confirmDialog(text))) return
    if (editing && editing.id === o.id) setEditing(null)
    await callFunction('delete_order', { p_order_id: o.id })
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {headerLeft ?? (
          <div>
            <h1 className="m-0 text-2xl">Daily Sales Report</h1>
            <p className="m-0 text-[14px] text-gray-500">{branchName(branch)}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${OUTLINE} flex items-center gap-2`}>
            Date
            <input
              type="date"
              className="border-0 bg-transparent p-0"
              value={shownDate}
              max={todayString()}
              onChange={(e) =>
                setReportDate(
                  !e.target.value || e.target.value === todayString() ? '' : e.target.value
                )
              }
            />
          </label>
          <button className={OUTLINE} onClick={() => setReportDate('')}>Today</button>
          {showRefresh && <button className={OUTLINE} onClick={reload}>Refresh</button>}
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <p className="mt-0 text-[14px]">
        Orders waiting to be accepted are shown first (highlighted), whatever the date.
      </p>

      {canEdit && editing && (
        <form
          onSubmit={saveEdit}
          className="mb-6 grid max-w-90 gap-2.5 rounded-xl border border-(color:--border) bg-white p-5 text-left"
        >
          <h3 className="m-0">Edit order #{editing.id}</h3>
          <p className="m-0 text-[14px]">
            {sizeOf(editing.item_name)} x {editing.quantity} · {peso(editAmount)}
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

          <label className={FIELD}>
            Discount (total for this order)
            <div className="flex overflow-hidden rounded-md border border-(color:--border) bg-white">
              <span className="flex items-center bg-brand-light px-3">₱</span>
              <input
                className="min-w-0 flex-1 rounded-none border-0 p-2"
                type="text"
                inputMode="decimal"
                placeholder="For example: 15.50"
                value={editDiscount}
                onChange={handleDiscount}
              />
            </div>
            <span className="text-[12px] text-gray-500">
              {discountIsValid
                ? `Amount after discount: ${peso(editAmount - typedDiscount)}`
                : 'Leave empty for no discount. More than ₱0, up to 2 decimals.'}
            </span>
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

          <label className="flex items-center gap-2 text-[14px] font-semibold">
            <input
              type="checkbox"
              className="size-4 p-0"
              checked={addNew}
              onChange={(e) => setAddNew(e.target.checked)}
            />
            Also add a new order for this customer
          </label>

          {addNew && (
            <div className="grid gap-2.5 rounded-lg bg-brand-light p-3">
              <label className={FIELD}>
                Size
                <select value={newSize} onChange={(e) => setNewSize(e.target.value)}>
                  {extra.sizes.map((s) => {
                    const row = extra.stock.find((x) => x.item_name === 'LPG Cylinder ' + s)
                    const qty = row ? row.quantity : 0
                    return (
                      <option key={s} value={s} disabled={qty < 1}>
                        {s} ({qty < 1 ? 'out of stock' : `${qty} in stock`})
                      </option>
                    )
                  })}
                </select>
              </label>

              <label className={FIELD}>
                Customer type for this order
                <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>

              <label className={FIELD}>
                Quantity (max {newAvailable})
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="Whole number, 1 or more"
                  value={newQty}
                  onChange={handleNewQty}
                />
              </label>

              <label className={FIELD}>
                Order via
                <select value={newSource} onChange={(e) => setNewSource(e.target.value)}>
                  <option value="walkin">Walk-in</option>
                  <option value="phone">Phone</option>
                </select>
              </label>

              <p className="m-0 text-[13px]">
                It is saved as a new row named &quot;
                {editName.replace(/\s*\(additional\)$/, '')} (additional)&quot;. To give it a
                discount, edit that row afterwards.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" className="flex-1">Save changes</button>
            <button type="button" onClick={() => setEditing(null)} className={CANCEL_BTN}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div
        className={
          tableClass ?? 'overflow-x-auto rounded-xl border border-(color:--border) bg-white'
        }
      >
        <table className={TABLE}>
          <thead>
            <tr>
              <th>Customer name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Unit cost</th>
              <th>Amount</th>
              <th>Remarks</th>
              <th>Delivery status</th>
              {canEdit && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {reportRows.map((o) => (
              <tr key={o.id} className={o.status === 'pending' ? 'bg-[#fff7e0]' : ''}>
                <td>
                  {o.customer_name}
                  {SOURCE_LABELS[o.source] || ''}
                </td>
                <td>{TYPE_LABELS[o.customer_type] || 'Household'}</td>
                <td>{sizeOf(o.item_name)} x {o.quantity}</td>
                <td>{peso(o.unit_price)}</td>
                <td>
                  {peso(o.total_price)}
                  {Number(o.discount) > 0 && (
                    <div className="text-[12px] text-gray-500">
                      Discount {peso(o.discount)}
                    </div>
                  )}
                </td>
                <td>{o.remarks || ''}</td>
                <td>
                  {o.status === 'pending'
                    ? 'Waiting for acceptance'
                    : DELIVERY_LABELS[o.delivery_status]}
                </td>
                {canEdit && (
                  <td>
                    {o.status === 'pending' && (
                      <>
                        <button onClick={() => acceptOrder(o)}>Accept</button>{' '}
                      </>
                    )}
                    <button onClick={() => startEdit(o)}>Edit</button>{' '}
                    <button onClick={() => deleteOrder(o)}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
            {reportRows.length === 0 && (
              <tr><td colSpan={canEdit ? 8 : 7}>No sales on this date</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="4"><strong>Total sales on {shownDate}</strong></td>
              <td><strong>{peso(dayTotal)}</strong></td>
              <td colSpan={canEdit ? 3 : 2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}