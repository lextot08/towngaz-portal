import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { BRANCHES, branchName } from './branches'

// Shows the "Recommendation" column of the table (sample text for now).
// Set this to false when the AI recommendation is added.
const SHOW_RECOMMENDATION_COLUMN = true

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'
const TABLE = 'w-full min-w-[800px] [&_td]:p-2 [&_th]:p-2'

// Status of each branch and size. For now it is a simple rule based on the low stock
// level of the size; the AI will decide it later.
const STATUS = {
  out: {
    label: 'Out of stock',
    badge: 'bg-red-100 text-red-800',
    note: 'Sample: restock as soon as possible.',
  },
  low: {
    label: 'Low stock',
    badge: 'bg-orange-100 text-orange-800',
    note: 'Sample: plan a restock this week.',
  },
  available: {
    label: 'Available',
    badge: 'bg-green-100 text-green-800',
    note: 'Sample: no action needed.',
  },
}

const TITLES = {
  daily: 'Daily recommendation',
  weekly: 'Weekly recommendation',
}

// Sample reasons for the rectangle. The AI's text replaces these later.
const SAMPLE_REASON = {
  daily:
    "Sample reason (daily): today's sales are compared with the stock left in each branch. Sizes marked Out of stock should be restocked first, sizes marked Low stock are running down, and sizes marked Available have enough stock for the rest of the day.",
  weekly:
    'Sample reason (weekly): the past 7 days of sales are used to estimate what each branch will need next week. Sizes marked Out of stock need restocking first, sizes marked Low stock should be ordered early in the week, and sizes marked Available need no action for now.',
}

export default function Recommendations({ mode, branch }) {
  const isAdmin = mode === 'admin' // the admin sees all branches, others see their own
  const [data, setData] = useState({ sizes: [], stock: [], orders: [] })
  const [active, setActive] = useState(null) // null | 'daily' | 'weekly'
  const [phase, setPhase] = useState('idle') // idle | loading | done
  const [generatedAt, setGeneratedAt] = useState(null)
  const [message, setMessage] = useState('')
  const [branchFilter, setBranchFilter] = useState('') // '' means all branches (admin only)

  const load = async () => {
    setMessage('')

    // sales of the last 7 days (including today)
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 6)
    weekStart.setHours(0, 0, 0, 0)

    const sizesResult = await supabase.from('lpg_prices').select('*').order('sort_order')

    let stockQuery = supabase.from('stock').select('branch, item_name, quantity')
    let ordersQuery = supabase
      .from('orders')
      .select('branch, item_name, quantity, accepted_at')
      .eq('status', 'accepted')
      .gte('accepted_at', weekStart.toISOString())
    if (!isAdmin) {
      stockQuery = stockQuery.eq('branch', branch)
      ordersQuery = ordersQuery.eq('branch', branch)
    }
    const stockResult = await stockQuery
    const ordersResult = await ordersQuery

    const error = sizesResult.error || stockResult.error || ordersResult.error
    if (error) {
      setMessage(error.message)
      return
    }
    setData({
      sizes: sizesResult.data,
      stock: stockResult.data,
      orders: ordersResult.data,
    })
  }

  useEffect(() => {
    load()
  }, [])

  // Clicking Daily or Weekly: reload the numbers, then show the text in the rectangle
  const generate = async (kind) => {
    setActive(kind)
    setPhase('loading')
    await load()
    // pretend the AI is thinking. Remove this line when the AI is added.
    await new Promise((resolve) => setTimeout(resolve, 800))
    setGeneratedAt(new Date())
    setPhase('done')
  }

  // Table rows: every branch x every size
  const period = active === 'daily' ? 'daily' : 'weekly'
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const branchIds = isAdmin
    ? branchFilter
      ? [Number(branchFilter)]
      : BRANCHES.map((b) => b.id)
    : [branch]

  const rows = branchIds.flatMap((id) =>
    data.sizes.map((p) => {
      const item = 'LPG Cylinder ' + p.size
      const inStock =
        data.stock.find((s) => s.branch === id && s.item_name === item)?.quantity ?? 0
      const sold = data.orders
        .filter(
          (o) =>
            o.branch === id &&
            o.item_name === item &&
            (period === 'weekly' || new Date(o.accepted_at) >= todayStart)
        )
        .reduce((sum, o) => sum + o.quantity, 0)
      const low = Number(p.low_stock_level) || 0
      const status = inStock <= 0 ? 'out' : inStock <= low ? 'low' : 'available'
      return { key: `${id}-${p.size}`, branch: id, size: p.size, inStock, sold, status }
    })
  )

  const buttonClass = (kind) => `${active === kind ? SOLID : OUTLINE} max-[900px]:flex-1`

  return (
    <div>
      <h1 className="mt-0 mb-4 text-2xl">Recommendation</h1>

      {/* The rectangle where the recommendation text will appear, and the two buttons next to it */}
      <div className="mb-6 flex items-stretch gap-4 max-[900px]:flex-col">
        <div className="min-h-[150px] flex-1 rounded-xl border border-(color:--border) bg-white p-4">
          {phase === 'idle' && (
            <p className="m-0 text-[14px] text-gray-400">
              The recommendation will appear here.
            </p>
          )}
          {phase === 'loading' && (
            <p className="m-0 animate-pulse text-[14px] text-gray-500">Analyzing...</p>
          )}
          {phase === 'done' && (
            <div>
              <h3 className="mt-0 mb-1 text-lg text-brand-pine">{TITLES[active]}</h3>
              <p className="mt-0 mb-3 text-[12px] text-gray-500">
                Generated{' '}
                {generatedAt.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              <p className="m-0 text-[15px] leading-relaxed">{SAMPLE_REASON[active]}</p>
            </div>
          )}
        </div>

        <div className="flex w-56 shrink-0 flex-col gap-2 max-[900px]:w-full max-[900px]:flex-row">
          <button
            className={buttonClass('daily')}
            disabled={phase === 'loading'}
            onClick={() => generate('daily')}
          >
            Daily recommendation
          </button>
          <button
            className={buttonClass('weekly')}
            disabled={phase === 'loading'}
            onClick={() => generate('weekly')}
          >
            Weekly recommendation
          </button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        {isAdmin ? (
          <label className="flex items-center gap-2 text-[14px]">
            Branch
            <select
              className="rounded-lg py-2"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
            >
              <option value="">All branches</option>
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
        <p className="m-0 text-[13px] text-gray-500">
          Sold = units sold {period === 'daily' ? 'today' : 'in the last 7 days'}.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-(color:--border) bg-white">
        <table className={TABLE}>
          <thead>
            <tr>
              <th>Branch</th>
              <th>Size</th>
              <th>In stock</th>
              <th>Sold</th>
              <th>Status</th>
              {SHOW_RECOMMENDATION_COLUMN && <th>Recommendation</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{branchName(r.branch)}</td>
                <td>{r.size}</td>
                <td>{r.inStock}</td>
                <td>{r.sold}</td>
                <td>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap ${STATUS[r.status].badge}`}
                  >
                    {STATUS[r.status].label}
                  </span>
                </td>
                {SHOW_RECOMMENDATION_COLUMN && <td>{STATUS[r.status].note}</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={SHOW_RECOMMENDATION_COLUMN ? 6 : 5}>No data yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}