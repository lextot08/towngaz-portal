import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { confirmDialog } from '../components/Confirm'
import { branchName } from '../lib/branches'
import { todayString, localDateString } from '../lib/dateUtils'
import { peso } from '../lib/money'
import { REMARKS, remarksOf } from '../lib/utang'
import { expenseOf, expensesOfOrders } from '../lib/expenses'
import DateButton from '../components/DateButton'

// shown after the customer name: Juan (H)
const TYPE_SHORT = {
  household: 'H',
  commercial: 'C',
  rto: 'RTO',
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

// "2026-10-16T06:35:00Z" -> "2:35 PM" (this device's time)
const timeText = (value) =>
  value
    ? new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
    : ''

// digits and one decimal point, with at most 2 digits after it (for example 15.50)
const cleanMoney = (text) => {
  let value = text.replace(/[^0-9.]/g, '')
  const firstDot = value.indexOf('.')
  if (firstDot !== -1) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '').slice(0, 2)
  }
  return value
}

// Orders that were added together (several sizes for one customer) share a group_id.
// They are shown as ONE row; every other order is a row of its own.
const toDisplayRows = (list) => {
  const result = []
  const byGroup = new Map()
  list.forEach((o) => {
    if (o.group_id) {
      if (byGroup.has(o.group_id)) {
        byGroup.get(o.group_id).orders.push(o)
        return
      }
      const group = { key: o.group_id, orders: [o] }
      byGroup.set(o.group_id, group)
      result.push(group)
      return
    }
    result.push({ key: String(o.id), orders: [o] })
  })
  return result
}

// the delivery status sent unchanged when editing ("not started" becomes "preparing")
const deliveryOf = (o) => (o.delivery_status === 'not_started' ? 'preparing' : o.delivery_status)

// amount before the discount, and the discount, of a row (one order or a multiple order)
const grossOf = (list) => list.reduce((sum, x) => sum + Number(x.total_price), 0)
const discountOf = (list) => list.reduce((sum, x) => sum + Number(x.discount || 0), 0)

// Tailwind class groups used in several places
const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'

// The table always fits the page (fixed column widths) and has grid lines like a spreadsheet.
// Long text wraps and makes the row taller.
const TABLE =
  'w-full min-w-[900px] table-fixed border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-1.5 [&_td]:py-2 [&_td]:align-top [&_td]:[overflow-wrap:anywhere] [&_th]:px-1.5 [&_th]:py-2 [&_th]:[overflow-wrap:anywhere]'

// boxes for inside the table
const DANGER = 'rounded-lg bg-brand-red px-4 py-2 text-white'

// red line around a new order's row (drawn inside the cells, since table rows cannot have a border)
const NEW_ORDER_OUTLINE =
  '[&>td]:shadow-[inset_0_2px_0_#a80202,inset_0_-2px_0_#a80202] [&>td:first-child]:shadow-[inset_2px_2px_0_#a80202,inset_0_-2px_0_#a80202] [&>td:last-child]:shadow-[inset_-2px_2px_0_#a80202,inset_0_-2px_0_#a80202]'
const ROW_INPUT = 'box-border block w-full min-w-0 p-1.5 text-[13px]'

// Share of the table width for each column, in percent (they add up to 100).
// The size columns (2.7kg, 11kg, 22kg, 50kg) share 20% between them.
// WIDTHS_SELECT is used while choosing orders to delete (a small box column at the end).
// (remarks = the Expenses column, utang = the Remark column)
const WIDTHS_VIEW = { time: 7, name: 16, contact: 10, address: 12, unit: 8, amount: 10, remarks: 9, utang: 8 }
const WIDTHS_SELECT = { time: 7, name: 14, contact: 9, address: 11, unit: 8, amount: 9, remarks: 9, utang: 8, select: 5 }
const SIZES_SHARE = 20

// A text box that gets taller when the text is long, so the table keeps its size
function GrowBox({ value, onChange, placeholder, onKeyDown, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      className="box-border block w-full min-w-0 resize-none overflow-hidden rounded-md border border-(color:--border) bg-white p-1.5 text-[13px] leading-snug"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault() // the text only wraps, there is no new line
        onKeyDown?.(e)
      }}
      {...rest}
    />
  )
}

// The Daily Sales Report, used by the staff page and by the admin's Branches page.
// canEdit = true shows Add order / Accept / Edit / Delete (staff, and the admin on Caloocan).
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
  // the cell being edited: { key: row key, field: 'name' | 'remarks' | 'discount' | 'utang' | 'size:<size>', value }
  // (for 'name' the value is { name, type }: the customer type is chosen in the name cell)
  const [cell, setCell] = useState(null)
  const savingCell = useRef(false) // stops Enter and clicking away from saving twice
  const cancelledCell = useRef(false) // Esc was pressed: do not save when the box closes
  const [newRow, setNewRow] = useState(null) // the empty row of "Add order"
  const [savingNew, setSavingNew] = useState(false)
  const [selecting, setSelecting] = useState(false) // choosing orders to delete
  const [selected, setSelected] = useState([]) // the keys of the rows ticked for deletion
  const [acceptingKeys, setAcceptingKeys] = useState([]) // new orders clicked just now (being accepted)
  const [message, setMessage] = useState('')

  // The sizes are needed for the columns. The stock (with the price) is only needed for editing.
  const loadExtra = async () => {
    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    let stock = []
    if (canEdit) {
      const stockResult = await supabase
        .from('stock')
        .select('item_name, quantity, price')
        .eq('branch', branch)
      stock = stockResult.data || []
    }
    setExtra({
      sizes: sizesResult.data ? sizesResult.data.map((p) => p.size) : [],
      stock,
    })
  }

  useEffect(() => {
    loadExtra()
  }, [branch, canEdit])

  // close the edited cell, the new row, and the delete boxes when another branch is chosen
  useEffect(() => {
    setCell(null)
    setNewRow(null)
    setSelecting(false)
    setSelected([])
    setMessage('')
  }, [branch])

  // new and changed orders (for example from the customer website) show up without pressing Refresh
  useEffect(() => {
    const channel = supabase
      .channel(`sales-report-${branch}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `branch=eq.${branch}` },
        () => reload()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [branch])

  const callFunction = async (name, args) => {
    setMessage('')
    const { error } = await supabase.rpc(name, args)
    if (error) setMessage(error.message)
    await reload()
    await loadExtra()
    return !error
  }

  const stockOf = (size) => extra.stock.find((x) => x.item_name === 'LPG Cylinder ' + size)

  const sizeList = extra.sizes
  const sizeCols = Math.max(sizeList.length, 1)
  const totalCols = 4 + sizeCols + 4 + (selecting ? 1 : 0)
  const W = selecting ? WIDTHS_SELECT : WIDTHS_VIEW
  // a cell that opens for editing on double-click
  const EDITABLE = canEdit ? 'cursor-cell hover:bg-black/[0.03]' : ''

  const pendingOrders = orders.filter((o) => o.status === 'pending')
  const acceptedOrders = orders.filter((o) => o.status === 'accepted')

  // Daily Sales Report: website orders not delivered yet (any date, on top) + the orders of the
  // chosen day. (Orders still "pending" are from before website orders were accepted at once.)
  const shownDate = reportDate || todayString()
  const dayOrders = acceptedOrders.filter((o) => localDateString(o.accepted_at) === shownDate)
  const toDeliver = acceptedOrders.filter(
    (o) =>
      o.customer_id &&
      o.delivery_status === 'out_for_delivery' &&
      localDateString(o.accepted_at) !== shownDate
  )
  const reportRows = [...pendingOrders, ...toDeliver, ...dayOrders]
  const displayRows = toDisplayRows(reportRows)
  // total sales of the day, after the discounts
  const dayTotal = grossOf(dayOrders) - discountOf(dayOrders)
  // total expenses of the day (the numbers typed in the Expenses column)
  const dayExpenses = expensesOfOrders(dayOrders)
  // the ticked rows that are on the page now
  const selectedRows = displayRows.filter((g) => selected.includes(g.key))

  // numbers for the new row ("Add order"): the sizes that have a quantity
  const nItems = newRow
    ? sizeList
        .map((s) => ({
          size: s,
          qty: Number(newRow.qtys[s]) || 0,
          price: Number(stockOf(s)?.price ?? 0),
        }))
        .filter((i) => i.qty > 0)
    : []
  const nAmount = nItems.reduce((sum, i) => sum + i.price * i.qty, 0)
  const nDiscount = newRow && newRow.discount !== '' ? Number(newRow.discount) : 0
  const nDiscountOk = Number.isFinite(nDiscount) && nDiscount > 0 && nDiscount < nAmount

  // ---- Website orders are accepted at once and go out for delivery: red outline and (!) until
  // the Remark "Delivered" is set. (An old order still waiting is accepted by clicking its row.) ----
  const isNewOrder = (g) =>
    g.orders.some(
      (x) => x.status === 'pending' || (x.customer_id && x.delivery_status === 'out_for_delivery')
    ) && !acceptingKeys.includes(g.key)

  const acceptRow = async (g) => {
    if (!canEdit || !g.orders.some((x) => x.status === 'pending') || acceptingKeys.includes(g.key)) {
      return
    }
    setAcceptingKeys((keys) => [...keys, g.key]) // hide the outline right away
    setMessage('')
    let failed = null
    for (const x of g.orders.filter((y) => y.status === 'pending')) {
      const { error } = await supabase.rpc('accept_order', { p_order_id: x.id })
      if (error) {
        failed = error
        break
      }
    }
    await reload()
    await loadExtra()
    setAcceptingKeys((keys) => keys.filter((k) => k !== g.key))
    if (failed) setMessage(`The order could not be accepted: ${failed.message}`)
  }

  // ---- Add order: an empty row at the top of the table ----
  const startNewRow = () => {
    setMessage('')
    setCell(null)
    stopDelete()
    setReportDate('') // a new order is always for today
    setNewRow({
      time: new Date(), // filled in automatically
      name: '',
      source: 'walkin',
      address: '',
      contact: '',
      type: 'household',
      qtys: Object.fromEntries(sizeList.map((s) => [s, ''])), // every size starts at zero
      discount: '',
      remarks: '',
    })
  }

  const setNew = (field) => (e) => setNewRow((row) => ({ ...row, [field]: e.target.value }))
  const setSizeQty = (size) => (e) =>
    setNewRow((row) => ({
      ...row,
      qtys: { ...row.qtys, [size]: e.target.value.replace(/\D/g, '') },
    }))
  const setNewMoney = (e) => setNewRow((row) => ({ ...row, discount: cleanMoney(e.target.value) }))

  const saveNewRow = async () => {
    setMessage('')
    const r = newRow

    if (!r.name.trim()) {
      setMessage('Customer name is required')
      return
    }
    if (!r.address.trim()) {
      setMessage('Address is required')
      return
    }
    if (!r.contact.trim()) {
      setMessage('Contact number is required')
      return
    }
    if (nItems.length === 0) {
      setMessage('Please enter a quantity for at least one size')
      return
    }
    const tooMany = nItems.find((i) => i.qty > (stockOf(i.size)?.quantity ?? 0))
    if (tooMany) {
      setMessage(`Only ${stockOf(tooMany.size)?.quantity ?? 0} in stock for ${tooMany.size}`)
      return
    }
    if (r.discount !== '' && !(nDiscount > 0)) {
      setMessage('Discount must be more than ₱0. Leave it empty for no discount.')
      return
    }
    if (r.discount !== '' && nDiscount >= nAmount) {
      setMessage(`Discount must be less than the order amount (${peso(nAmount)})`)
      return
    }

    const what = nItems.map((i) => `${i.qty} x ${i.size}`).join(', ')
    const discountText = r.discount !== '' ? ` A discount of ${peso(nDiscount)} will be applied.` : ''
    if (
      !(await confirmDialog(
        `Are you sure you want to add this order for ${r.name.trim()}: ${what}?${discountText}`
      ))
    ) {
      return
    }

    setSavingNew(true)
    const ok = await callFunction('add_manual_orders', {
      p_items: nItems.map((i) => ({ size: i.size, quantity: i.qty })),
      p_name: r.name.trim(),
      p_address: r.address.trim(),
      p_contact: r.contact.trim(),
      p_customer_type: r.type,
      p_source: r.source,
      p_remarks: r.remarks,
      p_discount: r.discount === '' ? 0 : nDiscount,
      p_time: r.time.toISOString(),
    })
    setSavingNew(false)
    if (ok) setNewRow(null)
  }

  // ---- Edit like a spreadsheet: double-click a cell, Enter (or clicking away) saves, Esc cancels ----
  const startCell = (g, field) => {
    if (!canEdit || savingCell.current || isEditing(g, field)) return
    const o = g.orders[0]
    const discount = discountOf(g.orders)
    const value =
      field === 'name'
        ? { name: o.customer_name || '', type: o.customer_type || 'household' }
        : field === 'remarks'
          ? o.remarks || ''
          : field === 'utang'
            ? {
                utang: o.utang_status || null,
                delivered: o.delivery_status === 'delivered',
                gcash: Boolean(o.paid_gcash),
              }
            : field.startsWith('size:')
              ? String(qtyOf(g, field.slice(5)) || '')
              : discount > 0
                ? discount.toFixed(2)
                : ''
    cancelledCell.current = false
    setMessage('')
    setCell({ key: g.key, field, value })
  }

  const setCellValue = (value) => setCell((c) => ({ ...c, value }))

  const cancelCell = () => {
    cancelledCell.current = true
    setCell(null)
  }

  // Saves the edited cell. The other values of the row are sent unchanged.
  const saveCell = async (g, value = cell?.value) => {
    if (!cell || cancelledCell.current || savingCell.current) return
    const list = g.orders
    const o = list[0]
    const amount = grossOf(list)
    const oldDiscount = discountOf(list)
    const next = {
      name: o.customer_name || '',
      remarks: o.remarks || '',
      delivery: deliveryOf(o),
      discount: oldDiscount,
    }

    let newType = null // set when the customer type was changed
    if (cell.field === 'name') {
      if (!value.name.trim()) {
        setMessage('Customer name is required')
        return
      }
      next.name = value.name.trim()
      if (value.type !== (o.customer_type || 'household')) newType = value.type
    } else if (cell.field === 'remarks') {
      next.remarks = value.trim()
    } else {
      // discount: empty or 0 means no discount, otherwise it must be less than the amount
      const discount = value === '' ? 0 : Number(value)
      if (!Number.isFinite(discount)) {
        setMessage('Please type a valid discount, for example 15.50')
        return
      }
      if (discount >= amount) {
        setMessage(`Discount must be less than the order amount (${peso(amount)})`)
        return
      }
      next.discount = discount
    }

    const detailsChanged =
      next.name !== (o.customer_name || '') ||
      next.remarks !== (o.remarks || '') ||
      Math.abs(next.discount - oldDiscount) >= 0.005
    if (!detailsChanged && !newType) {
      setCell(null)
      return
    }

    savingCell.current = true
    let ok = true
    if (detailsChanged) {
      ok = await callFunction('edit_orders', {
        p_order_ids: list.map((x) => x.id),
        p_name: next.name,
        p_remarks: next.remarks,
        p_delivery_status: next.delivery,
        p_discount: next.discount,
      })
    }
    if (ok && newType) ok = await saveType(list, newType)
    savingCell.current = false
    if (ok) setCell(null)
  }

  // changes the customer type of a row (one order, or all sizes of a multiple order)
  const saveType = async (list, type) => {
    const { data, error } = await supabase
      .from('orders')
      .update({ customer_type: type })
      .in('id', list.map((x) => x.id))
      .select('id')
    if (error) setMessage(error.message)
    else if (data.length === 0) setMessage('You are not allowed to change the customer type')
    await reload()
    return !error && data.length > 0
  }

  // the name cell holds the name box and the type list: save only when leaving both
  const leaveNameCell = (g) => (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) saveCell(g)
  }

  // keys for the text boxes inside a cell: Enter saves (by leaving the box), Esc cancels
  const cellKeys = (e) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') cancelCell()
  }

  // puts the cursor at the end of the text when the box opens
  const cursorToEnd = (e) => {
    const len = e.currentTarget.value.length
    e.currentTarget.setSelectionRange(len, len)
  }

  const isEditing = (g, field) => cell && cell.key === g.key && cell.field === field

  // Remark: Utang or Bayad Utang (one of them, or none), Delivered, Thru Gcash.
  // Each click turns one on or off and is saved at once; the cell stays open for more.
  const toggleRemark = async (g, key) => {
    if (savingCell.current) return
    const now = cell.value
    const next = { ...now }
    if (key === 'utang' || key === 'bayad_utang') next.utang = now.utang === key ? null : key
    else next[key] = !now[key]
    savingCell.current = true
    setCellValue(next)
    const ok = await callFunction('set_order_remarks', {
      p_order_ids: g.orders.map((x) => x.id),
      p_utang: next.utang,
      p_delivered: next.delivered,
      p_gcash: next.gcash,
    })
    savingCell.current = false
    if (!ok) setCellValue(now)
  }

  // the remark cell closes when the focus leaves it
  const leaveRemarkCell = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setCell(null)
  }

  // Size cells: how many cylinders of a size the row has. Typing a number in an empty size adds
  // that size to the order; 0 removes it. Accepted orders take it from (or give it back to) the stock.
  const qtyOf = (g, size) =>
    g.orders
      .filter((x) => x.item_name === 'LPG Cylinder ' + size)
      .reduce((sum, x) => sum + x.quantity, 0)

  const saveSize = async (g, size) => {
    if (!cell || cancelledCell.current || savingCell.current) return
    const qty = cell.value === '' ? 0 : Number(cell.value)
    if (qty === qtyOf(g, size)) {
      setCell(null)
      return
    }
    savingCell.current = true
    const ok = await callFunction('set_row_quantity', {
      p_order_ids: g.orders.map((x) => x.id),
      p_size: size,
      p_quantity: qty,
    })
    savingCell.current = false
    if (ok) setCell(null)
  }

  // ---- Delete: tick the small boxes at the end of the rows, then delete them together ----
  const startDelete = () => {
    setMessage('')
    setCell(null)
    setSelected([])
    setSelecting(true)
  }

  function stopDelete() {
    setSelecting(false)
    setSelected([])
  }

  const toggleSelected = (key) =>
    setSelected((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))

  // a row is one order, or all sizes of a multiple order
  const deleteSelected = async () => {
    if (selectedRows.length === 0) return
    const list = selectedRows.flatMap((g) => g.orders)
    const returnsStock = list.some((x) => x.status === 'accepted' && x.delivery_status !== 'delivered')
    const what = selectedRows
      .map(
        (g) =>
          `${g.orders.map((x) => `${sizeOf(x.item_name)} x ${x.quantity}`).join(', ')} for ${g.orders[0].customer_name}`
      )
      .join('; ')
    const text =
      `Are you sure you want to delete ${selectedRows.length === 1 ? 'this order' : `these ${selectedRows.length} orders`} (${what})?` +
      (returnsStock ? ' The cylinders will be returned to stock.' : '')
    if (!(await confirmDialog(text))) return
    setCell(null)
    const ok = await callFunction('delete_orders', { p_order_ids: list.map((x) => x.id) })
    if (ok) stopDelete()
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
          <DateButton
            value={shownDate}
            onChange={(v) => setReportDate(!v || v === todayString() ? '' : v)}
          />
          <button className={OUTLINE} onClick={() => setReportDate('')}>Today</button>
          {showRefresh && <button className={OUTLINE} onClick={reload}>Refresh</button>}
          {canEdit &&
            (newRow ? (
              <>
                <button className={SOLID} disabled={savingNew} onClick={saveNewRow}>
                  {savingNew ? 'Saving...' : 'Save order'}
                </button>
                <button className={OUTLINE} disabled={savingNew} onClick={() => setNewRow(null)}>
                  Cancel
                </button>
              </>
            ) : selecting ? (
              <>
                <button
                  className={DANGER}
                  disabled={selectedRows.length === 0}
                  onClick={deleteSelected}
                >
                  Delete selected ({selectedRows.length})
                </button>
                <button className={OUTLINE} onClick={stopDelete}>Cancel</button>
              </>
            ) : (
              <>
                <button className={SOLID} onClick={startNewRow}>Add order</button>
                <button className={OUTLINE} onClick={startDelete}>Delete</button>
              </>
            ))}
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <p className="mt-0 text-[14px]">
        Website orders go out for delivery at once and are shown first, with a red outline and (!),
        until their Remark is set to Delivered.
        {canEdit && (
          <>
            {' '}
            Double-click a Customer name (to change the name or the type), a size (to change the
            quantity or add a size to the order; 0 removes it), Amount (for the discount), Expenses,
            or Remark (Utang, Bayad Utang, Delivered, Thru Gcash) cell to edit it. H = Household,
            C = Commercial, RTO = Retail Outlet. Press Enter to save or Esc to cancel.
          </>
        )}
      </p>

      <div
        className={
          tableClass ?? 'overflow-x-auto rounded-xl border border-(color:--border) bg-white'
        }
      >
        <table className={TABLE}>
          <colgroup>
            <col style={{ width: `${W.time}%` }} />
            <col style={{ width: `${W.name}%` }} />
            <col style={{ width: `${W.contact}%` }} />
            <col style={{ width: `${W.address}%` }} />
            {Array.from({ length: sizeCols }, (_, i) => (
              <col key={i} style={{ width: `${SIZES_SHARE / sizeCols}%` }} />
            ))}
            <col style={{ width: `${W.unit}%` }} />
            <col style={{ width: `${W.amount}%` }} />
            <col style={{ width: `${W.remarks}%` }} />
            <col style={{ width: `${W.utang}%` }} />
            {selecting && <col style={{ width: `${W.select}%` }} />}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Time</th>
              <th rowSpan={2}>Customer name</th>
              <th rowSpan={2}>Contact no.</th>
              <th rowSpan={2}>Address</th>
              <th colSpan={sizeCols} className="text-center">Size</th>
              <th rowSpan={2}>Unit cost</th>
              <th rowSpan={2}>Amount</th>
              <th rowSpan={2}>Expenses</th>
              <th rowSpan={2}>Remark</th>
              {selecting && <th rowSpan={2} className="text-center">Delete</th>}
            </tr>
            <tr>
              {sizeList.length === 0 ? (
                <th></th>
              ) : (
                sizeList.map((s) => (
                  <th key={s} className="text-center">{s}</th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {/* The empty row of "Add order": the time is filled in, the rest is typed.
                Every size starts at 0; filling more than one size is a multiple order for 1 customer.
                Long text makes the boxes (and the row) taller, never wider. */}
            {canEdit && newRow && (
              <tr className="bg-brand-light">
                <td className="font-semibold">{timeText(newRow.time)}</td>
                <td>
                  <GrowBox
                    placeholder="Customer name"
                    value={newRow.name}
                    onChange={setNew('name')}
                  />
                  <select className={`${ROW_INPUT} mt-1`} value={newRow.source} onChange={setNew('source')}>
                    <option value="walkin">Walk-in</option>
                    <option value="phone">Phone</option>
                  </select>
                  <select className={`${ROW_INPUT} mt-1`} value={newRow.type} onChange={setNew('type')}>
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className={ROW_INPUT}
                    type="tel"
                    placeholder="Contact no."
                    value={newRow.contact}
                    onChange={setNew('contact')}
                  />
                </td>
                <td>
                  <GrowBox
                    placeholder="Address"
                    value={newRow.address}
                    onChange={setNew('address')}
                  />
                </td>
                {sizeList.map((s) => {
                  const avail = stockOf(s)?.quantity ?? 0
                  return (
                    <td key={s} className="text-center">
                      <input
                        className="box-border block w-full min-w-0 p-1 text-center text-[13px]"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="0"
                        disabled={avail < 1}
                        value={newRow.qtys[s] ?? ''}
                        onChange={setSizeQty(s)}
                      />
                      <div className="text-[11px] text-gray-500">
                        {avail < 1 ? 'out of stock' : `max ${avail}`}
                      </div>
                    </td>
                  )
                })}
                <td>
                  {nItems.length === 0 ? (
                    <span className="text-gray-400">-</span>
                  ) : (
                    nItems.map((i) => (
                      <div key={i.size}>{i.size}: {peso(i.price)}</div>
                    ))
                  )}
                </td>
                <td>
                  <div className="font-semibold">
                    {peso(nAmount - (nDiscountOk ? nDiscount : 0))}
                  </div>
                  <div className="mt-1 flex overflow-hidden rounded-md border border-(color:--border) bg-white">
                    <span className="flex items-center bg-white px-1.5 text-[12px]">₱</span>
                    <input
                      className="min-w-0 flex-1 rounded-none border-0 p-1.5 text-[13px]"
                      inputMode="decimal"
                      placeholder="Discount"
                      value={newRow.discount}
                      onChange={setNewMoney}
                    />
                  </div>
                </td>
                <td>
                  <GrowBox
                    placeholder="Expenses"
                    value={newRow.remarks}
                    onChange={setNew('remarks')}
                  />
                </td>
                <td className="text-[12px] text-gray-500">
                  Double-click after saving
                </td>
              </tr>
            )}

            {displayRows.map((g) => {
              const o = g.orders[0]
              const many = g.orders.length > 1
              const amount = grossOf(g.orders)
              const discount = discountOf(g.orders)
              // the discount being typed, and the amount after it (updates while typing)
              const typedDiscount = isEditing(g, 'discount') ? Number(cell.value) || 0 : discount
              const netAmount = amount - (typedDiscount < amount ? typedDiscount : 0)
              return (
                <tr
                  key={g.key}
                  onClick={() => acceptRow(g)}
                  className={`${selected.includes(g.key) && selecting ? 'bg-red-50' : ''} ${
                    isNewOrder(g) ? `${NEW_ORDER_OUTLINE} ${canEdit ? 'cursor-pointer' : ''}` : ''
                  }`}
                >
                  <td>{timeText(o.accepted_at || o.created_at)}</td>
                  <td className={EDITABLE} onDoubleClick={() => startCell(g, 'name')}>
                    {isEditing(g, 'name') ? (
                      <div onBlur={leaveNameCell(g)}>
                        <GrowBox
                          autoFocus
                          onFocus={cursorToEnd}
                          value={cell.value.name}
                          onChange={(e) => setCellValue({ ...cell.value, name: e.target.value })}
                          onKeyDown={cellKeys}
                        />
                        <select
                          className={`${ROW_INPUT} mt-1`}
                          value={cell.value.type}
                          onChange={(e) => setCellValue({ ...cell.value, type: e.target.value })}
                          onKeyDown={(e) => e.key === 'Escape' && cancelCell()}
                        >
                          {TYPE_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <>
                        {o.customer_name} ({TYPE_SHORT[o.customer_type] || 'H'})
                        {SOURCE_LABELS[o.source] || ''}
                      </>
                    )}
                  </td>
                  <td>{o.customer_contact || ''}</td>
                  <td>{o.customer_address || ''}</td>
                  {(sizeList.length > 0 ? sizeList : ['']).map((s) => {
                    const qty = qtyOf(g, s)
                    const field = `size:${s}`
                    return (
                      <td
                        key={s || 'none'}
                        className={`text-center ${s ? EDITABLE : ''}`}
                        onDoubleClick={() => s && startCell(g, field)}
                      >
                        {isEditing(g, field) ? (
                          <>
                            <input
                              autoFocus
                              className="box-border block w-full min-w-0 p-1 text-center text-[13px]"
                              inputMode="numeric"
                              maxLength={6}
                              placeholder="0"
                              value={cell.value}
                              onChange={(e) => setCellValue(e.target.value.replace(/\D/g, ''))}
                              onKeyDown={cellKeys}
                              onBlur={() => saveSize(g, s)}
                            />
                            <div className="text-[11px] text-gray-500">
                              {stockOf(s)?.quantity ?? 0} in stock
                            </div>
                          </>
                        ) : qty > 0 ? (
                          qty
                        ) : (
                          ''
                        )}
                      </td>
                    )
                  })}
                  <td>
                    {many
                      ? g.orders.map((x) => (
                          <div key={x.id}>{sizeOf(x.item_name)}: {peso(x.unit_price)}</div>
                        ))
                      : peso(o.unit_price)}
                  </td>
                  <td className={EDITABLE} onDoubleClick={() => startCell(g, 'discount')}>
                    <div className={typedDiscount > 0 ? 'font-semibold' : ''}>{peso(netAmount)}</div>
                    {isEditing(g, 'discount') ? (
                      <div className="mt-1 flex overflow-hidden rounded-md border border-(color:--border) bg-white">
                        <span className="flex items-center bg-white px-1.5 text-[12px]">₱</span>
                        <input
                          autoFocus
                          onFocus={cursorToEnd}
                          className="min-w-0 flex-1 rounded-none border-0 p-1.5 text-[13px]"
                          inputMode="decimal"
                          placeholder="Discount"
                          value={cell.value}
                          onChange={(e) => setCellValue(cleanMoney(e.target.value))}
                          onKeyDown={cellKeys}
                          onBlur={() => saveCell(g)}
                        />
                      </div>
                    ) : (
                      discount > 0 && (
                        <div className="text-[12px] text-gray-500">
                          {peso(amount)} less {peso(discount)} discount
                        </div>
                      )
                    )}
                  </td>
                  <td className={EDITABLE} onDoubleClick={() => startCell(g, 'remarks')}>
                    {isEditing(g, 'remarks') ? (
                      <GrowBox
                        autoFocus
                        onFocus={cursorToEnd}
                        placeholder="Expenses"
                        value={cell.value}
                        onChange={(e) => setCellValue(e.target.value)}
                        onKeyDown={cellKeys}
                        onBlur={() => saveCell(g)}
                      />
                    ) : (
                      <>
                        {o.remarks || ''}
                        {/* the value used in the reports: the sum of the numbers typed */}
                        {expenseOf(o.remarks) > 0 && (
                          <div className="text-[12px] text-gray-500">= {peso(expenseOf(o.remarks))}</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className={EDITABLE} onDoubleClick={() => startCell(g, 'utang')}>
                    {isNewOrder(g) && (
                      <span
                        className="float-right ml-1 flex size-5 items-center justify-center rounded-full bg-brand-red text-[12px] font-bold text-white"
                        title="New order from the website"
                      >
                        !
                      </span>
                    )}
                    {isEditing(g, 'utang') ? (
                      <div
                        className="grid gap-1"
                        onBlur={leaveRemarkCell}
                        onKeyDown={(e) => e.key === 'Escape' && cancelCell()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        {REMARKS.map((r, i) => {
                          const on =
                            r.key === 'utang' || r.key === 'bayad_utang'
                              ? cell.value.utang === r.key
                              : cell.value[r.key]
                          return (
                            <button
                              key={r.key}
                              type="button"
                              autoFocus={i === 0}
                              onClick={() => toggleRemark(g, r.key)}
                              className={`rounded-full px-2 py-0.5 text-left text-[11px] font-medium ${
                                on ? r.chip : 'border border-(color:--border) bg-white text-gray-500'
                              }`}
                            >
                              {on ? '✓ ' : ''}
                              {r.label}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {remarksOf(o).map((key) => {
                          const r = REMARKS.find((x) => x.key === key)
                          return (
                            <span key={key} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.chip}`}>
                              {r.label}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </td>
                  {selecting && (
                    <td className="text-center align-middle!">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer p-0"
                        aria-label={`Delete the order of ${o.customer_name}`}
                        checked={selected.includes(g.key)}
                        onChange={() => toggleSelected(g.key)}
                      />
                    </td>
                  )}
                </tr>
              )
            })}
            {displayRows.length === 0 && !newRow && (
              <tr><td colSpan={totalCols}>No sales on this date</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5 + sizeCols}><strong>Total sales on {shownDate}</strong></td>
              <td><strong>{peso(dayTotal)}</strong></td>
              <td>
                {dayExpenses > 0 && <strong>{peso(dayExpenses)}</strong>}
              </td>
              <td colSpan={selecting ? 2 : 1}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}