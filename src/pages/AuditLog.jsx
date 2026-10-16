import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'
import { todayString } from '../lib/dateUtils'
import DateButton from '../components/DateButton'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const PANEL =
  'h-[calc(100vh-260px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'
const TABLE =
  'w-full min-w-[900px] table-fixed border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-2 [&_td]:py-2 [&_td]:align-top [&_td]:[overflow-wrap:anywhere] [&_th]:px-2 [&_th]:py-2 [&_th]:text-left'

const OVERALL = 0

// what each table holds, in plain words
const THINGS = {
  orders: 'order',
  stock: 'stock',
  ledger_entries: 'ledger row',
  profiles: 'account',
  lpg_prices: 'price',
  branch_prices: 'branch price',
  inventory_remarks: 'inventory remarks',
}

// column names in plain words
const FIELDS = {
  customer_name: 'customer name',
  customer_contact: 'contact no.',
  customer_address: 'address',
  customer_type: 'type',
  remarks: 'expenses',
  utang_status: 'remark',
  delivery_status: 'delivery',
  total_price: 'amount',
  unit_price: 'unit cost',
  full_name: 'name',
  contact_number: 'contact no.',
  entry_time: 'date/time',
  quantities: 'quantities',
}

const ACTIONS = { insert: 'Added', update: 'Changed', delete: 'Deleted' }
const ROLES = { admin: 'Admin', staff: 'Staff', customer: 'Customer' }

const timeText = (value) =>
  new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
const dateText = (value) =>
  new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

// a value from the database as short text
const valueText = (v) => {
  if (v === null || v === undefined || v === '') return '(empty)'
  const text = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return text.length > 60 ? `${text.slice(0, 60)}...` : text
}

// "Accepted order", "Changed order", ... and who or what it was about
const describe = (log) => {
  const row = log.new_data || log.old_data || {}
  const thing = THINGS[log.table_name] || log.table_name.replace(/_/g, ' ')
  let verb = ACTIONS[log.action] || log.action
  if (
    log.table_name === 'orders' &&
    log.action === 'update' &&
    log.changed_columns?.includes('status') &&
    log.new_data?.status === 'accepted'
  ) {
    verb = 'Accepted'
  }

  const about = [
    row.customer_name || row.full_name,
    row.item_name ? `${row.item_name.replace('LPG Cylinder ', '')} x ${row.quantity}` : null,
    !row.item_name && row.size ? row.size : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return { title: `${verb} ${thing}${row.id ? ` #${row.id}` : ''}`, about }
}

// for a change: "discount: 0 → 20" for every changed column (times are left out)
const changesOf = (log) =>
  log.action !== 'update'
    ? []
    : (log.changed_columns || [])
        .filter((c) => !c.endsWith('_at'))
        .map(
          (c) =>
            `${FIELDS[c] || c.replace(/_/g, ' ')}: ${valueText(log.old_data?.[c])} → ${valueText(log.new_data?.[c])}`
        )

// Audit Log (admin): every change made in the portal and the website, with who did it.
export default function AuditLog() {
  const [date, setDate] = useState('') // '' means today
  const [branch, setBranch] = useState(OVERALL) // 0 = all branches
  const [logs, setLogs] = useState([])
  const [message, setMessage] = useState('')

  const shownDate = date || todayString()

  const load = async () => {
    setMessage('')
    // the day runs from midnight to midnight in this device's local time
    const from = new Date(`${shownDate}T00:00:00`)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)

    let query = supabase
      .from('audit_log')
      .select('*')
      .gte('created_at', from.toISOString())
      .lt('created_at', to.toISOString())
      .order('created_at', { ascending: false })
      .limit(1000)
    if (branch !== OVERALL) query = query.eq('branch', branch)
    const { data, error } = await query
    if (error) setMessage(error.message)
    else setLogs(data)
  }

  useEffect(() => {
    load()
  }, [shownDate, branch])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Audit Log</h1>
          <p className="m-0 text-[14px] text-gray-500">
            {branch === OVERALL ? 'All branches' : branchName(branch)} · who did what
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={branch} onChange={(e) => setBranch(Number(e.target.value))}>
            <option value={OVERALL}>All branches</option>
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <DateButton
            value={shownDate}
            onChange={(v) => setDate(!v || v === todayString() ? '' : v)}
          />
          <button className={OUTLINE} onClick={() => setDate('')}>Today</button>
          <button className={OUTLINE} onClick={load}>Refresh</button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <div className={PANEL}>
        <table className={TABLE}>
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '54%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Date/Time</th>
              <th>Name</th>
              <th>Branch</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const { title, about } = describe(log)
              const changes = changesOf(log)
              return (
                <tr key={log.id}>
                  <td>
                    {dateText(log.created_at)}
                    <div className="text-gray-500">{timeText(log.created_at)}</div>
                  </td>
                  <td>
                    {log.actor_name || (log.actor_id ? '(no name)' : 'System')}
                    {log.actor_role && (
                      <div className="text-[12px] text-gray-500">
                        {ROLES[log.actor_role] || log.actor_role}
                      </div>
                    )}
                  </td>
                  <td>{log.branch ? branchName(log.branch) : ''}</td>
                  <td>
                    <span className="font-semibold">{title}</span>
                    {about && <span className="text-gray-600"> · {about}</span>}
                    {changes.map((c) => (
                      <div key={c} className="text-[12px] text-gray-500">{c}</div>
                    ))}
                  </td>
                </tr>
              )
            })}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4}>Nothing was done on this date</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
