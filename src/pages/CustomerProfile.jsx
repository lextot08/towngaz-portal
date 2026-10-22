import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'
import { filterContact, contactError, filterName, nameError } from '../lib/accountRules'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'
const CARD = 'rounded-xl border border-(color:--border) bg-white'
const FIELD = 'grid gap-1 text-[14px]'
const TABLE =
  'w-full min-w-[560px] table-fixed border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2 [&_td]:text-center [&_th]:text-center'

const OVERALL = 0

// only the digits of a contact number, to match "0917 123 4567" with "09171234567"
const digits = (text) => String(text || '').replace(/\D/g, '')

const dateText = (value) =>
  new Date(value).toLocaleDateString('en-PH', { month: '2-digit', day: '2-digit', year: 'numeric' })

const emptyForm = { fullName: '', address: '', contact: '', branch: '' }

// Customer Profile: the order history of every customer, one table each.
//   * Website customers: from their own orders (each order is linked to their account).
//   * Walk-in / phone customers: a profile added here; their orders are found by contact number.
// Staff pass their own branch (fixed); the admin sees all branches or picks one.
export default function CustomerProfile({ branch: ownBranch }) {
  const [chosenBranch, setChosenBranch] = useState(OVERALL)
  const branch = ownBranch ?? chosenBranch
  const [sizes, setSizes] = useState([])
  const [orders, setOrders] = useState([])
  const [profiles, setProfiles] = useState([])
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    setMessage('')
    const sizesResult = await supabase.from('lpg_prices').select('size').order('sort_order')
    let ordersQuery = supabase
      .from('orders')
      .select(
        'id, group_id, branch, item_name, quantity, utang_status, status, customer_id, customer_name, customer_address, customer_contact, created_at, accepted_at'
      )
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: true })
    let profilesQuery = supabase.from('customer_profiles').select('*').order('full_name')
    if (branch !== OVERALL) {
      ordersQuery = ordersQuery.eq('branch', branch)
      profilesQuery = profilesQuery.eq('branch', branch)
    }
    const [ordersResult, profilesResult] = await Promise.all([ordersQuery, profilesQuery])

    const error = sizesResult.error || ordersResult.error || profilesResult.error
    if (error) {
      setMessage(error.message)
      return
    }
    setSizes(sizesResult.data.map((p) => p.size))
    setOrders(ordersResult.data)
    setProfiles(profilesResult.data)
  }

  useEffect(() => {
    setSelectedKey(null)
    load()
  }, [branch])

  // ---- the customers and their orders ----
  const customers = []

  // website customers: grouped by their account, with the details of their latest order
  const byAccount = new Map()
  orders
    .filter((o) => o.customer_id)
    .forEach((o) => {
      if (!byAccount.has(o.customer_id)) byAccount.set(o.customer_id, [])
      byAccount.get(o.customer_id).push(o)
    })
  byAccount.forEach((list, id) => {
    const latest = list[list.length - 1]
    customers.push({
      key: `web-${id}`,
      kind: 'web',
      name: latest.customer_name || 'Customer',
      address: latest.customer_address || '',
      contact: latest.customer_contact || '',
      branches: [...new Set(list.map((o) => o.branch))],
      orders: list,
    })
  })

  // walk-in / phone customers: a profile, with the orders that have the same contact number
  profiles.forEach((p) => {
    const contact = digits(p.contact)
    const list = contact
      ? orders.filter((o) => !o.customer_id && digits(o.customer_contact) === contact)
      : []
    customers.push({
      key: `profile-${p.id}`,
      kind: 'walkin',
      name: p.full_name,
      address: p.address || '',
      contact: p.contact || '',
      branches: [p.branch],
      orders: list,
    })
  })

  const lastAt = (c) => {
    const o = c.orders[c.orders.length - 1]
    return o ? new Date(o.accepted_at || o.created_at).getTime() : 0
  }

  const term = search.trim().toLowerCase()
  const termDigits = digits(search)
  const found = customers
    .filter(
      (c) =>
        !term ||
        c.name.toLowerCase().includes(term) ||
        c.address.toLowerCase().includes(term) ||
        (termDigits.length >= 3 && digits(c.contact).includes(termDigits))
    )
    .sort((a, b) => lastAt(b) - lastAt(a) || a.name.localeCompare(b.name))

  const selected = customers.find((c) => c.key === selectedKey) || null

  // one row per order (an order of several sizes is one row)
  const historyRows = (c) => {
    const rows = []
    const byKey = new Map()
    c.orders.forEach((o) => {
      const key = o.group_id || `order-${o.id}`
      if (!byKey.has(key)) {
        const row = { key, when: o.accepted_at || o.created_at, branch: o.branch, pending: false, qty: {}, borrowed: 0 }
        byKey.set(key, row)
        rows.push(row)
      }
      const row = byKey.get(key)
      const size = o.item_name.replace('LPG Cylinder ', '')
      row.qty[size] = (row.qty[size] || 0) + o.quantity
      if (o.utang_status === 'utang') row.borrowed += o.quantity
      if (o.status === 'pending') row.pending = true
    })
    return rows
  }

  // ---- add a profile (walk-in / phone customer) ----
  const startAdd = () => {
    setMessage('')
    setForm({ ...emptyForm, branch: ownBranch ? String(ownBranch) : branch ? String(branch) : '' })
    setAdding(true)
  }

  const saveProfile = async (e) => {
    e.preventDefault()
    setMessage('')
    const nameProblem = nameError(form.fullName)
    if (nameProblem) return setMessage(nameProblem)
    const contactProblem = contactError(form.contact)
    if (contactProblem) return setMessage(contactProblem)
    const profileBranch = Number(ownBranch ?? form.branch)
    if (!profileBranch) return setMessage('Please choose a branch')
    if (profiles.some((p) => digits(p.contact) === digits(form.contact))) {
      return setMessage('A profile with this contact number already exists')
    }

    setSaving(true)
    const { data, error } = await supabase
      .from('customer_profiles')
      .insert({
        branch: profileBranch,
        full_name: form.fullName.trim(),
        address: form.address.trim(),
        contact: form.contact,
      })
      .select()
      .single()
    setSaving(false)
    if (error) return setMessage(error.message)
    setAdding(false)
    await load()
    setSelectedKey(`profile-${data.id}`)
  }

  const sizeList = sizes.length > 0 ? sizes : ['']

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Customer Profile</h1>
          <p className="m-0 text-[14px] text-gray-500">
            {branch === OVERALL ? 'All branches' : branchName(branch)} · order history of every customer
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ownBranch === undefined && (
            <select value={chosenBranch} onChange={(e) => setChosenBranch(Number(e.target.value))}>
              <option value={OVERALL}>All branches</option>
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <button className={OUTLINE} onClick={load}>Refresh</button>
          <button className={SOLID} disabled={adding} onClick={startAdd}>Add profile</button>
        </div>
      </div>

      {message && <p className="mt-0 text-brand-red">{message}</p>}

      {adding && (
        <form onSubmit={saveProfile} className={`${CARD} mb-4 grid max-w-120 gap-2.5 p-4`}>
          <h3 className="m-0">New customer profile</h3>
          <p className="m-0 text-[13px] text-gray-500">
            For customers who do not use the website. Their orders are found by the contact number.
          </p>
          <label className={FIELD}>
            Name
            <input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: filterName(e.target.value) })}
              required
            />
          </label>
          <label className={FIELD}>
            Address
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>
          <label className={FIELD}>
            Contact No. (11 digits)
            <input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: filterContact(e.target.value) })}
              required
            />
          </label>
          {ownBranch === undefined && (
            <label className={FIELD}>
              Branch
              <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} required>
                <option value="" disabled>Select branch</option>
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="flex gap-2">
            <button type="submit" className={`${SOLID} flex-1`} disabled={saving}>
              {saving ? 'Saving...' : 'Save profile'}
            </button>
            <button type="button" className={`${OUTLINE} flex-1`} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ---- search and the list of customers ---- */}
        <div className={`${CARD} p-3`}>
          <input
            type="search"
            className="box-border w-full"
            placeholder="Search name, contact, or address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="mt-3 grid max-h-[calc(100vh-320px)] min-h-40 gap-1 overflow-y-auto">
            {found.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSelectedKey(c.key)}
                className={`rounded-lg px-3 py-2 text-left ${
                  c.key === selectedKey
                    ? 'bg-brand-pine text-white'
                    : 'bg-transparent text-(color:--text) hover:bg-brand-light hover:opacity-100'
                }`}
              >
                <span className="block font-semibold">{c.name}</span>
                <span className={`block text-[12px] ${c.key === selectedKey ? 'text-white/80' : 'text-gray-500'}`}>
                  {c.contact || 'no contact'} · {c.kind === 'web' ? 'Website' : 'Walk-in'} ·{' '}
                  {c.orders.length} order{c.orders.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
            {found.length === 0 && (
              <p className="m-2 text-[14px] text-gray-500">
                {term ? 'No customer found' : 'No customers yet'}
              </p>
            )}
          </div>
        </div>

        {/* ---- the chosen customer's profile and history ---- */}
        {selected ? (
          <div className={`${CARD} overflow-hidden`}>
            <div className="grid gap-1 border-b border-(color:--border) p-4 text-[14px] sm:grid-cols-2">
              <div><span className="text-gray-500">Name:</span> <strong>{selected.name}</strong></div>
              <div><span className="text-gray-500">Contact:</span> {selected.contact || '-'}</div>
              <div><span className="text-gray-500">Address:</span> {selected.address || '-'}</div>
              <div>
                <span className="text-gray-500">Branch:</span>{' '}
                {selected.branches.map((b) => branchName(b)).join(', ') || '-'}
                <span className="ml-2 rounded-full bg-brand-light px-2 py-0.5 text-[11px]">
                  {selected.kind === 'web' ? 'Website' : 'Walk-in'}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className="w-[26%]">Date</th>
                    {sizeList.map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                    <th>Borrowed</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows(selected).map((r) => (
                    <tr key={r.key}>
                      <td>
                        {dateText(r.when)}
                        {r.pending && <div className="text-[11px] text-orange-700">waiting</div>}
                        {branch === OVERALL && selected.branches.length > 1 && (
                          <div className="text-[11px] text-gray-500">{branchName(r.branch)}</div>
                        )}
                      </td>
                      {sizeList.map((s) => (
                        <td key={s}>{r.qty[s] || ''}</td>
                      ))}
                      <td className={r.borrowed > 0 ? 'font-semibold text-brand-red' : ''}>
                        {r.borrowed || ''}
                      </td>
                    </tr>
                  ))}
                  {selected.orders.length === 0 && (
                    <tr>
                      <td colSpan={sizeList.length + 2}>
                        No orders yet
                        {selected.kind === 'walkin' && ' (orders with this contact number show here)'}
                      </td>
                    </tr>
                  )}
                </tbody>
                {selected.orders.length > 0 && (
                  <tfoot>
                    <tr className="font-bold">
                      <td>Total</td>
                      {sizeList.map((s) => (
                        <td key={s}>
                          {historyRows(selected).reduce((sum, r) => sum + (r.qty[s] || 0), 0) || ''}
                        </td>
                      ))}
                      <td>{historyRows(selected).reduce((sum, r) => sum + r.borrowed, 0) || ''}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        ) : (
          <div className={`${CARD} p-6 text-[14px] text-gray-500`}>
            Search and choose a customer to see their order history.
          </div>
        )}
      </div>
    </div>
  )
}
