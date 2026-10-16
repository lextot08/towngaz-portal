import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'
import { todayString, localDateString } from './dateUtils'
import { peso } from './money'
import DateButton from './DateButton'

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

const DELIVERY_OPTIONS = ['preparing', 'out_for_delivery', 'delivered']

// the delivery status shown and sent when editing ("not started" becomes "preparing")
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

// small buttons and boxes for inside the table
const MINI = 'px-2.5 py-1 text-[12px]'
const MINI_CANCEL = `${MINI} border border-(color:--border) bg-white text-(color:--text)`
const ROW_INPUT = 'box-border block w-full min-w-0 p-1.5 text-[13px]'

// Share of the table width for each column, in percent (they add up to 100).
// The size columns (2.7kg, 11kg, 22kg, 50kg) share 20% between them.
const WIDTHS_EDIT = { time: 7, name: 13, address: 14, type: 9, unit: 8, amount: 9, remarks: 11, action: 9 }
const WIDTHS_VIEW = { time: 7, name: 15, address: 16, type: 9, unit: 8, amount: 11, remarks: 14 }
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
  // the cell being edited: { key: row key, field: 'name' | 'remarks' | 'discount' | 'delivery', value }
  const [cell, setCell] = useState(null)
  const savingCell = useRef(false) // stops Enter and clicking away from saving twice
  const cancelledCell = useRef(false) // Esc was pressed: do not save when the box closes
  const [newRow, setNewRow] = useState(null) // the empty row of "Add order"
  const [savingNew, setSavingNew] = useState(false)
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

  // close the edited cell and the new row when another branch is chosen
  useEffect(() => {
    setCell(null)
    setNewRow(null)
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

  const stockOf = (size) => extra.stock.find((x) => x.item_name === 'LPG Cylinder ' + size)

  const sizeList = extra.sizes
  const sizeCols = Math.max(sizeList.length, 1)
  const totalCols = 4 + sizeCols + 3 + (canEdit ? 1 : 0)
  const W = canEdit ? WIDTHS_EDIT : WIDTHS_VIEW
  // a cell that opens for editing on double-click
  const EDITABLE = canEdit ? 'cursor-cell hover:bg-black/[0.03]' : ''

  const pendingOrders = orders.filter((o) => o.status === 'pending')
  const acceptedOrders = orders.filter((o) => o.status === 'accepted')

  // Daily Sales Report: orders waiting for acceptance (any date) + accepted orders of the chosen day
  const shownDate = reportDate || todayString()
  const dayOrders = acceptedOrders.filter((o) => localDateString(o.accepted_at) === shownDate)
  const reportRows = [...pendingOrders, ...dayOrders]
  const displayRows = toDisplayRows(reportRows)
  // total sales of the day, after the discounts
  const dayTotal = grossOf(dayOrders) - discountOf(dayOrders)

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

  const acceptOrder = async (o) => {
    if (!(await confirmDialog('Are you sure you want to accept this order?'))) return
    await callFunction('accept_order', { p_order_id: o.id })
  }

  // ---- Add order: an empty row at the top of the table ----
  const startNewRow = () => {
    setMessage('')
    setCell(null)
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
        ? o.customer_name || ''
        : field === 'remarks'
          ? o.remarks || ''
          : field === 'discount'
            ? discount > 0
              ? discount.toFixed(2)
              : ''
            : deliveryOf(o)
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

    if (cell.field === 'name') {
      if (!value.trim()) {
        setMessage('Customer name is required')
        return
      }
      next.name = value.trim()
    } else if (cell.field === 'remarks') {
      next.remarks = value.trim()
    } else if (cell.field === 'delivery') {
      next.delivery = value
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

    const unchanged =
      next.name === (o.customer_name || '') &&
      next.remarks === (o.remarks || '') &&
      next.delivery === deliveryOf(o) &&
      Math.abs(next.discount - oldDiscount) < 0.005
    if (unchanged) {
      setCell(null)
      return
    }

    savingCell.current = true
    const ok = await callFunction('edit_orders', {
      p_order_ids: list.map((x) => x.id),
      p_name: next.name,
      p_remarks: next.remarks,
      p_delivery_status: next.delivery,
      p_discount: next.discount,
    })
    savingCell.current = false
    if (ok) setCell(null)
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

  // delete a row: one order, or all sizes of a multiple order
  const deleteOrders = async (key, list) => {
    const returnsStock = list.some((x) => x.status === 'accepted' && x.delivery_status !== 'delivered')
    const what = list.map((x) => `${sizeOf(x.item_name)} x ${x.quantity}`).join(', ')
    const text =
      `Are you sure you want to delete this order (${what} for ${list[0].customer_name})?` +
      (returnsStock ? ' The cylinders will be returned to stock.' : '')
    if (!(await confirmDialog(text))) return
    if (cell && cell.key === key) setCell(null)
    await callFunction('delete_orders', { p_order_ids: list.map((x) => x.id) })
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
          {canEdit && (
            <button className={SOLID} disabled={Boolean(newRow)} onClick={startNewRow}>
              Add order
            </button>
          )}
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <p className="mt-0 text-[14px]">
        Orders waiting to be accepted are shown first (highlighted), whatever the date.
        {canEdit && (
          <>
            {' '}
            Double-click a Customer name, delivery status, Amount (for the discount), or Expenses
            cell to edit it. Press Enter to save or Esc to cancel.
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
            <col style={{ width: `${W.address}%` }} />
            <col style={{ width: `${W.type}%` }} />
            {Array.from({ length: sizeCols }, (_, i) => (
              <col key={i} style={{ width: `${SIZES_SHARE / sizeCols}%` }} />
            ))}
            <col style={{ width: `${W.unit}%` }} />
            <col style={{ width: `${W.amount}%` }} />
            <col style={{ width: `${W.remarks}%` }} />
            {canEdit && <col style={{ width: `${W.action}%` }} />}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Time</th>
              <th rowSpan={2}>Customer name</th>
              <th rowSpan={2}>Address</th>
              <th rowSpan={2}>Type</th>
              <th colSpan={sizeCols} className="text-center">Size</th>
              <th rowSpan={2}>Unit cost</th>
              <th rowSpan={2}>Amount</th>
              <th rowSpan={2}>Expenses</th>
              {canEdit && <th rowSpan={2}>Action</th>}
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
                </td>
                <td>
                  <GrowBox
                    placeholder="Address"
                    value={newRow.address}
                    onChange={setNew('address')}
                  />
                  <input
                    className={`${ROW_INPUT} mt-1`}
                    type="tel"
                    placeholder="Contact no."
                    value={newRow.contact}
                    onChange={setNew('contact')}
                  />
                </td>
                <td>
                  <select className={ROW_INPUT} value={newRow.type} onChange={setNew('type')}>
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
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
                <td>
                  <div className="flex flex-wrap gap-1">
                    <button className={MINI} disabled={savingNew} onClick={saveNewRow}>
                      {savingNew ? 'Saving...' : 'Save'}
                    </button>
                    <button className={MINI_CANCEL} disabled={savingNew} onClick={() => setNewRow(null)}>
                      Cancel
                    </button>
                  </div>
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
                <tr key={g.key} className={o.status === 'pending' ? 'bg-[#fff7e0]' : ''}>
                  <td>{timeText(o.status === 'pending' ? o.created_at : o.accepted_at)}</td>
                  <td className={EDITABLE} onDoubleClick={() => startCell(g, 'name')}>
                    {isEditing(g, 'name') ? (
                      <GrowBox
                        autoFocus
                        onFocus={cursorToEnd}
                        value={cell.value}
                        onChange={(e) => setCellValue(e.target.value)}
                        onKeyDown={cellKeys}
                        onBlur={() => saveCell(g)}
                      />
                    ) : (
                      <>
                        {o.customer_name}
                        {SOURCE_LABELS[o.source] || ''}
                      </>
                    )}
                    {o.status === 'pending' && (
                      <div className="text-[12px] text-orange-700">Waiting for acceptance</div>
                    )}
                    {o.status === 'accepted' &&
                      (isEditing(g, 'delivery') ? (
                        <select
                          autoFocus
                          className={`${ROW_INPUT} mt-1`}
                          value={cell.value}
                          onChange={(e) => saveCell(g, e.target.value)}
                          onKeyDown={(e) => e.key === 'Escape' && cancelCell()}
                          onBlur={cancelCell}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          {DELIVERY_OPTIONS.map((s) => (
                            <option key={s} value={s}>{DELIVERY_LABELS[s]}</option>
                          ))}
                        </select>
                      ) : (
                        <div
                          className="text-[12px] text-gray-500"
                          onDoubleClick={(e) => {
                            e.stopPropagation() // edit the delivery status, not the name
                            startCell(g, 'delivery')
                          }}
                        >
                          {DELIVERY_LABELS[o.delivery_status] || ''}
                        </div>
                      ))}
                  </td>
                  <td>{o.customer_address || ''}</td>
                  <td>{TYPE_LABELS[o.customer_type] || 'Household'}</td>
                  {(sizeList.length > 0 ? sizeList : ['']).map((s) => {
                    const qty = g.orders
                      .filter((x) => x.item_name === 'LPG Cylinder ' + s)
                      .reduce((sum, x) => sum + x.quantity, 0)
                    return (
                      <td key={s || 'none'} className="text-center">
                        {qty > 0 ? qty : ''}
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
                      o.remarks || ''
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {!many && o.status === 'pending' && (
                          <button className={MINI} onClick={() => acceptOrder(o)}>Accept</button>
                        )}
                        <button className={MINI} onClick={() => deleteOrders(g.key, g.orders)}>
                          Delete
                        </button>
                      </div>
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
              <td colSpan={canEdit ? 2 : 1}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}