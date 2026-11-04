import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'
import { todayString } from '../lib/dateUtils'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'
const TABLE = 'w-full min-w-[800px] [&_td]:p-2 [&_th]:p-2'

// Status of each branch and size: a simple rule based on the low stock level of the size.
const STATUS = {
  out: { label: 'Out of stock', badge: 'bg-red-100 text-red-800' },
  low: { label: 'Low stock', badge: 'bg-orange-100 text-orange-800' },
  available: { label: 'Available', badge: 'bg-green-100 text-green-800' },
}

const TITLES = {
  daily: 'Daily recommendation',
  weekly: 'Weekly recommendation',
}

// the message of a failed call of the "recommend" Edge Function
const errorText = async (error) => {
  try {
    const body = await error.context.json()
    if (body?.error) return body.error
  } catch {
    // no readable answer from the function
  }
  return 'The recommendation could not be made. Please check the internet connection and try again.'
}

export default function Recommendations({ mode, branch }) {
  const isAdmin = mode === 'admin' // the admin sees all branches, others see their own
  const [data, setData] = useState({ sizes: [], stock: [], orders: [] })
  const [active, setActive] = useState(null) // null | 'daily' | 'weekly'
  const [phase, setPhase] = useState('idle') // idle | loading | done | failed
  const [result, setResult] = useState(null) // Claude's answer: { summary, branches: [{ branch, recommendation }] }
  const [generatedAt, setGeneratedAt] = useState(null)
  const [message, setMessage] = useState('')
  const [branchFilter, setBranchFilter] = useState('') // '' means all branches (admin only)

  // the sizes, the stock now, and the sales of the last 7 days (including today)
  const load = async () => {
    setMessage('')
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
      return null
    }
    const next = { sizes: sizesResult.data, stock: stockResult.data, orders: ordersResult.data }
    setData(next)
    return next
  }

  useEffect(() => {
    load()
  }, [])

  // Table rows: every branch x every size, with the sales of today and of the last 7 days
  const branchIds = isAdmin
    ? branchFilter
      ? [Number(branchFilter)]
      : BRANCHES.map((b) => b.id)
    : [branch]

  const rowsOf = (d) => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    return branchIds.flatMap((id) =>
      d.sizes.map((p) => {
        const item = 'LPG Cylinder ' + p.size
        const inStock = d.stock.find((s) => s.branch === id && s.item_name === item)?.quantity ?? 0
        const sales = d.orders.filter((o) => o.branch === id && o.item_name === item)
        const soldWeek = sales.reduce((sum, o) => sum + o.quantity, 0)
        const soldToday = sales
          .filter((o) => new Date(o.accepted_at) >= todayStart)
          .reduce((sum, o) => sum + o.quantity, 0)
        const low = Number(p.low_stock_level) || 0
        const status = inStock <= 0 ? 'out' : inStock <= low ? 'low' : 'available'
        return { key: `${id}-${p.size}`, branch: id, size: p.size, inStock, soldToday, soldWeek, low, status }
      })
    )
  }
  const rows = rowsOf(data)

  // Clicking Daily or Weekly: reload the numbers, then ask Claude (Edge Function "recommend")
  const generate = async (kind) => {
    setActive(kind)
    setPhase('loading')
    setResult(null)
    const fresh = await load()
    if (!fresh) {
      setPhase('failed')
      return
    }
    const asked = rowsOf(fresh)
    const { data: answer, error } = await supabase.functions.invoke('recommend', {
      body: {
        kind,
        date: todayString(),
        rows: asked.map((r) => ({
          branch: branchName(r.branch),
          size: r.size,
          in_stock: Math.max(r.inStock, 0),
          sold_today: r.soldToday,
          sold_7_days: r.soldWeek,
          low_level: r.low,
        })),
      },
    })
    if (error || typeof answer?.summary !== 'string') {
      setMessage(error ? await errorText(error) : 'The recommendation came back empty. Please try again.')
      setPhase('failed')
      return
    }
    setResult(answer)
    setGeneratedAt(new Date())
    setPhase('done')
  }

  const period = active === 'daily' ? 'daily' : 'weekly'
  const buttonClass = (kind) => `${active === kind ? SOLID : OUTLINE} max-[900px]:flex-1`

  return (
    <div>
      <h1 className="mt-0 mb-4 text-2xl">Recommendation</h1>

      {/* The rectangle where the recommendation text appears, and the two buttons next to it */}
      <div className="mb-6 flex items-stretch gap-4 max-[900px]:flex-col">
        <div className="min-h-[150px] flex-1 rounded-xl border border-(color:--border) bg-white p-4">
          {phase === 'idle' && (
            <p className="m-0 text-[14px] text-gray-400">
              Choose Daily or Weekly recommendation. The stock and sales of{' '}
              {isAdmin ? (branchFilter ? branchName(Number(branchFilter)) : 'every branch') : 'your branch'}{' '}
              are checked and the advice appears here.
            </p>
          )}
          {phase === 'loading' && (
            <p className="m-0 animate-pulse text-[14px] text-gray-500">
              Analyzing the stock and sales... this can take a few seconds.
            </p>
          )}
          {phase === 'failed' && (
            <p className="m-0 text-[14px] text-brand-red">{message || 'The recommendation could not be made.'}</p>
          )}
          {phase === 'done' && (
            <div>
              <h3 className="mt-0 mb-1 text-lg text-brand-pine">{TITLES[active]}</h3>
              <p className="mt-0 mb-3 text-[12px] text-gray-500">
                Generated{' '}
                {generatedAt.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              <p className="mt-0 mb-3 text-[15px] leading-relaxed whitespace-pre-line">{result.summary}</p>
              {(result.branches || []).length > 0 && (
                <ul className="m-0 grid gap-1.5 pl-0 text-[14px] leading-relaxed">
                  {result.branches.map((b) => (
                    <li key={b.branch} className="list-none">
                      <strong className="text-brand-pine">{b.branch}:</strong> {b.recommendation}
                    </li>
                  ))}
                </ul>
              )}
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

      {message && phase !== 'failed' && <p className="mt-0">{message}</p>}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        {isAdmin ? (
          <label className="flex items-center gap-2 text-[14px]">
            Branch
            <select
              className="rounded-lg py-2"
              value={branchFilter}
              onChange={(e) => {
                setBranchFilter(e.target.value)
                setResult(null) // a recommendation is for the branches it was made for
                if (phase === 'done') setPhase('idle')
              }}
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
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = r.status
              return (
                <tr key={r.key}>
                  <td>{branchName(r.branch)}</td>
                  <td>{r.size}</td>
                  <td>{r.inStock}</td>
                  <td>{period === 'daily' ? r.soldToday : r.soldWeek}</td>
                  <td>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap ${STATUS[status].badge}`}
                    >
                      {STATUS[status].label}
                    </span>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>No data yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
