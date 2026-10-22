import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'
import { confirmDialog } from '../components/Confirm'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const PANEL =
  'h-[calc(100vh-280px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'
// fixed-size grid with lines like a spreadsheet
const TABLE =
  'w-full min-w-[1080px] table-fixed border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-1.5 [&_td]:py-2 [&_td]:align-top [&_td]:[overflow-wrap:anywhere] [&_th]:px-1.5 [&_th]:py-2'
const MINI = 'px-2.5 py-1 text-[12px]'
const MINI_CANCEL = `${MINI} border border-(color:--border) bg-white text-(color:--text)`
const QTY_INPUT = 'box-border block w-full min-w-0 p-1 text-center text-[13px]'

const OVERALL = 0

const dateText = (value) =>
  new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const timeText = (value) =>
  new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
const sizeOf = (itemName) => itemName.replace('LPG Cylinder ', '')
const digits = (text) => String(text || '').replace(/\D/g, '')

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

// Borrowed: the orders with the Remark "Borrowed" (the customer kept the tank) in the Daily
// Sales Report. When the customer gives the tanks back, the staff find the customer and click
// Return: the tanks go under Returned and, on that day, the EMPTIES of the branch go up.
// Staff pass their own branch (fixed); the admin picks a branch or all branches (view only).
export default function TankBorrowed({ branch: ownBranch }) {
  const [chosenBranch, setBranch] = useState(OVERALL) // 0 = all branches
  const branch = ownBranch ?? chosenBranch
  const canReturn = ownBranch !== undefined // the staff of the branch record the returns
  const [sizes, setSizes] = useState([])
  const [orders, setOrders] = useState([])
  const [returns, setReturns] = useState([]) // { id, order_id, quantity, returned_at }
  const [search, setSearch] = useState('')
  const [returning, setReturning] = useState(null) // { key, qtys: { orderId: text } }
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    setMessage('')
    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    let ordersQuery = supabase
      .from('orders')
      .select(
        'id, group_id, branch, item_name, quantity, customer_name, customer_contact, customer_address, borrowed_tank, created_at, accepted_at'
      )
      .eq('borrowed_tank', true)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false })
    let returnsQuery = supabase.from('tank_returns').select('id, order_id, quantity, returned_at')
    if (branch !== OVERALL) {
      ordersQuery = ordersQuery.eq('branch', branch)
      returnsQuery = returnsQuery.eq('branch', branch)
    }
    const [ordersResult, returnsResult] = await Promise.all([ordersQuery, returnsQuery])

    const error = sizesResult.error || ordersResult.error || returnsResult.error
    if (error) {
      setMessage(error.message)
      return
    }
    setSizes(sizesResult.data.map((p) => p.size))
    setOrders(ordersResult.data)
    setReturns(returnsResult.data)
  }

  useEffect(() => {
    setReturning(null)
    load()
  }, [branch])

  // the tanks given back so far, and still borrowed, of one order
  const givenBack = (o) => returns.filter((t) => t.order_id === o.id).reduce((sum, t) => sum + t.quantity, 0)
  const stillOut = (o) => Math.max(o.quantity - givenBack(o), 0)
  const rowOut = (row) => row.orders.reduce((sum, o) => sum + stillOut(o), 0)
  // the latest return of a row (for the date shown, and for Undo)
  const latestReturn = (row) =>
    returns
      .filter((t) => row.orders.some((o) => o.id === t.order_id))
      .sort((a, b) => a.returned_at.localeCompare(b.returned_at) || a.id - b.id)
      .at(-1)
  const lastReturn = (row) => latestReturn(row)?.returned_at

  // ---- Undo: the latest return recorded by mistake (the tanks are borrowed again) ----
  const undoReturn = async (row) => {
    const t = latestReturn(row)
    if (!t) return
    const o = row.orders.find((x) => x.id === t.order_id)
    if (
      !(await confirmDialog(
        `Undo the return of ${t.quantity} x ${sizeOf(o.item_name)} recorded on ${dateText(t.returned_at)} for ${o.customer_name}? The tanks count as borrowed again, and the empties of that day go back down.`
      ))
    ) {
      return
    }
    setMessage('')
    const { error } = await supabase.rpc('undo_tank_return', { p_return_id: t.id })
    if (error) setMessage(error.message)
    await load()
  }

  // search by name or contact; the rows with tanks still out come first
  const term = search.trim().toLowerCase()
  const termDigits = digits(search)
  const rows = toRows(orders)
    .filter((row) => {
      if (!term) return true
      const o = row.orders[0]
      return (
        String(o.customer_name || '').toLowerCase().includes(term) ||
        (termDigits.length >= 3 && digits(o.customer_contact).includes(termDigits))
      )
    })
    .sort((a, b) => (rowOut(b) > 0) - (rowOut(a) > 0))

  const sizeCols = Math.max(sizes.length, 1)
  const sizeWidth = 44 / (sizeCols * 2) // the size columns share 44% of the table

  // ---- Return: type how many came back (starts at all that is still out) ----
  const startReturn = (row) => {
    setMessage('')
    setReturning({
      key: row.key,
      qtys: Object.fromEntries(row.orders.map((o) => [o.id, stillOut(o) > 0 ? String(stillOut(o)) : ''])),
    })
  }

  const saveReturn = async (row) => {
    setMessage('')
    const items = row.orders
      .map((o) => ({ o, qty: Number(returning.qtys[o.id]) || 0 }))
      .filter((x) => x.qty > 0)
    if (items.length === 0) {
      setMessage('Type how many tanks came back')
      return
    }
    const tooMany = items.find((x) => x.qty > stillOut(x.o))
    if (tooMany) {
      setMessage(`Only ${stillOut(tooMany.o)} of ${sizeOf(tooMany.o.item_name)} is still borrowed`)
      return
    }
    const what = items.map((x) => `${x.qty} x ${sizeOf(x.o.item_name)}`).join(', ')
    if (
      !(await confirmDialog(
        `Record the return of ${what} from ${row.orders[0].customer_name}? The empties of today go up by the same number.`
      ))
    ) {
      return
    }

    setSaving(true)
    let failed = null
    for (const x of items) {
      const { error } = await supabase.rpc('record_tank_return', { p_order_id: x.o.id, p_quantity: x.qty })
      if (error) {
        failed = error
        break
      }
    }
    setSaving(false)
    await load()
    if (failed) setMessage(failed.message)
    else setReturning(null)
  }

  // the size cells of a row: Returned = given back so far, Borrowed = still out
  const sizeCells = (row, kind) =>
    (sizes.length > 0 ? sizes : ['']).map((s) => {
      const list = row.orders.filter((o) => o.item_name === 'LPG Cylinder ' + s)
      if (kind === 'returned' && returning?.key === row.key && list.some((o) => stillOut(o) > 0)) {
        const o = list.find((x) => stillOut(x) > 0)
        return (
          <td key={`${kind}-${s}`} className="text-center">
            <input
              className={QTY_INPUT}
              inputMode="numeric"
              maxLength={4}
              placeholder="0"
              value={returning.qtys[o.id] ?? ''}
              onChange={(e) =>
                setReturning((r) => ({ ...r, qtys: { ...r.qtys, [o.id]: digits(e.target.value) } }))
              }
            />
            <div className="text-[11px] text-gray-500">max {stillOut(o)}</div>
          </td>
        )
      }
      const qty = list.reduce((sum, o) => sum + (kind === 'returned' ? givenBack(o) : stillOut(o)), 0)
      const original = list.reduce((sum, o) => sum + o.quantity, 0)
      return (
        <td key={`${kind}-${s}`} className="text-center">
          {qty > 0 ? qty : ''}
          {kind === 'borrowed' && original > 0 && qty !== original && (
            <div className="text-[11px] text-gray-400">of {original}</div>
          )}
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Borrowed</h1>
          <p className="m-0 text-[14px] text-gray-500">
            {branch === OVERALL ? 'All branches' : branchName(branch)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="w-64"
            placeholder="Search customer name or contact"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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

      {message && <p className="mt-0 text-brand-red">{message}</p>}

      <div className={PANEL}>
        <table className={TABLE}>
          <colgroup>
            <col style={{ width: '11%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '13%' }} />
            {Array.from({ length: sizeCols * 2 }, (_, i) => (
              <col key={i} style={{ width: `${sizeWidth}%` }} />
            ))}
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Date/Time</th>
              <th rowSpan={2}>Customer Name</th>
              <th rowSpan={2}>Contact Number</th>
              <th rowSpan={2}>Address</th>
              <th colSpan={sizeCols} className="text-center">Returned</th>
              <th colSpan={sizeCols} className="text-center">Borrowed</th>
              <th rowSpan={2}>Action</th>
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
              const out = rowOut(row)
              const isReturning = returning?.key === row.key
              return (
                <tr key={row.key} className={out === 0 ? 'bg-gray-50 text-gray-500' : ''}>
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
                  {sizeCells(row, 'returned')}
                  {sizeCells(row, 'borrowed')}
                  <td>
                    {out === 0 ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">
                        Returned
                      </span>
                    ) : isReturning ? (
                      <div className="flex flex-wrap gap-1">
                        <button className={MINI} disabled={saving} onClick={() => saveReturn(row)}>
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button className={MINI_CANCEL} disabled={saving} onClick={() => setReturning(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : canReturn ? (
                      <button className={MINI} onClick={() => startReturn(row)}>Return</button>
                    ) : null}
                    {lastReturn(row) && (
                      <div className="mt-1 text-[11px] text-gray-500">last on {dateText(lastReturn(row))}</div>
                    )}
                    {canReturn && lastReturn(row) && !isReturning && (
                      <button
                        className="mt-1 bg-transparent p-0 text-[11px] text-brand-red underline hover:opacity-80"
                        onClick={() => undoReturn(row)}
                      >
                        Undo last return
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5 + sizeCols * 2}>
                  {term ? 'No customer found' : 'No borrowed tanks yet'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 mb-0 max-w-200 text-[13px] text-gray-600">
        Orders marked &quot;Borrowed&quot; in the Daily Sales Report (the customer kept the tank).
        Borrowed = the tanks still with the customer; Returned = the tanks given back. When a customer
        returns tanks, search the name and click Return: on that day the branch&apos;s EMPTIES go up by
        the same number.
      </p>
    </div>
  )
}
