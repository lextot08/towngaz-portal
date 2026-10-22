import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { branchName } from '../lib/branches'
import { localDateString, todayString } from '../lib/dateUtils'
import { peso } from '../lib/money'
import { DEFAULT_LOW_LEVEL } from '../lib/stockStatus'
import { REMARKS, remarksOf } from '../lib/utang'

const GREEN = '#0b4436'
const CARD = 'rounded-2xl border border-(color:--border) bg-white shadow-sm'
const MINT = 'bg-[#eef6f3]'

const ICONS = {
  truck: 'M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  tank: 'M8 3h8M9 3v3M15 3v3M6 9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3zM6 12h12',
  peso: 'M7 20V4h6a4 4 0 0 1 0 8H7M4 8h14M4 11h14',
  alert: 'M12 3l10 18H2zM12 10v4M12 17h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  up: 'M7 17L17 7M9 7h8v8',
  down: 'M7 7l10 10M17 9v8H9',
  pin: 'M12 22s-7-7.5-7-12.5a7 7 0 0 1 14 0C19 14.5 12 22 12 22zM12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  chart: 'M5 20V12M10 20V8M15 20v-6M20 20V4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  chevron: 'M9 6l6 6-6 6',
}

function Icon({ name, className = 'size-5' }) {
  return (
    <svg
      className={`${className} shrink-0`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

const sizeOf = (itemName) => itemName.replace('LPG Cylinder ', '')
const timeText = (value) =>
  new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

// "6 more than yesterday" / "1 less than yesterday" / "same as yesterday"
function Trend({ today, yesterday, money = false }) {
  if (money && yesterday === 0) {
    return <span className="text-gray-500">{today > 0 ? 'no sales yesterday' : 'no sales yet'}</span>
  }
  const diff = today - yesterday
  if (diff === 0) return <span className="text-gray-500">same as yesterday</span>
  const up = diff > 0
  const amount = money
    ? `${Math.round((Math.abs(diff) / yesterday) * 100)}%`
    : Math.abs(diff).toLocaleString('en-PH')
  return (
    <span className={`inline-flex items-center gap-1 ${up ? 'text-brand-pine' : 'text-brand-red'}`}>
      <Icon name={up ? 'up' : 'down'} className="size-3.5" />
      {amount} {up ? 'more' : 'less'} than yesterday
    </span>
  )
}

// Staff Home: today's numbers of the branch, the latest orders, low stock, prices, shortcuts.
export default function StaffHome({ branch, fullName, orders, onOpen, onUpdatePrice }) {
  const [prices, setPrices] = useState([])
  const [stock, setStock] = useState([])
  const [levels, setLevels] = useState({})
  const [message, setMessage] = useState('')

  useEffect(() => {
    const load = async () => {
      const [sizesResult, branchResult, stockResult] = await Promise.all([
        supabase.from('lpg_prices').select('size, price, low_stock_level').order('sort_order'),
        supabase.from('branch_prices').select('size, price').eq('branch', branch),
        supabase.from('stock').select('item_name, quantity').eq('branch', branch),
      ])
      const error = sizesResult.error || stockResult.error
      if (error) {
        setMessage(error.message)
        return
      }
      const own = Object.fromEntries((branchResult.data || []).map((p) => [p.size, p.price]))
      setPrices(sizesResult.data.map((p) => ({ size: p.size, price: own[p.size] ?? p.price })))
      setLevels(Object.fromEntries(sizesResult.data.map((p) => [p.size, p.low_stock_level])))
      setStock(stockResult.data)
    }
    load()
  }, [branch])

  // ---- today's numbers (accepted orders of the day), compared with yesterday ----
  const today = todayString()
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = localDateString(yesterdayDate)

  const acceptedOn = (day) =>
    orders.filter((o) => o.status === 'accepted' && o.accepted_at && localDateString(o.accepted_at) === day)
  const cylinders = (list) => list.reduce((sum, o) => sum + o.quantity, 0)
  const amount = (list) =>
    list.reduce((sum, o) => sum + Number(o.total_price) - Number(o.discount || 0), 0)

  const todayOrders = acceptedOn(today)
  const yesterdayOrders = acceptedOn(yesterday)
  // website orders out for delivery (and any old order still waiting to be accepted)
  const waiting = orders.filter(
    (o) => o.status === 'pending' || (o.customer_id && o.delivery_status === 'out_for_delivery')
  )

  // ---- low stock: sizes at or below their low stock level ----
  const lowStock = prices
    .map((p) => {
      const left = stock.find((s) => s.item_name === 'LPG Cylinder ' + p.size)?.quantity ?? 0
      return { size: p.size, left, level: levels[p.size] ?? DEFAULT_LOW_LEVEL }
    })
    .filter((x) => x.left <= x.level)

  // ---- order activity: the latest orders of today (and the ones waiting), one row per order ----
  const activity = []
  const byKey = new Map()
  orders
    .filter((o) => o.status === 'pending' || (o.accepted_at && localDateString(o.accepted_at) === today))
    .forEach((o) => {
      const key = o.group_id || `order-${o.id}`
      if (!byKey.has(key)) {
        const row = {
          key,
          id: o.id,
          name: o.customer_name,
          when: o.accepted_at || o.created_at,
          sizes: [],
          remarks: remarksOf(o),
          outForDelivery: o.status === 'pending' || (o.customer_id && o.delivery_status === 'out_for_delivery'),
        }
        byKey.set(key, row)
        activity.push(row)
      }
      byKey.get(key).sizes.push(sizeOf(o.item_name))
    })
  activity.sort((a, b) => new Date(b.when) - new Date(a.when))

  const stats = [
    {
      label: 'Orders to Deliver',
      icon: 'truck',
      value: waiting.length,
      sub: <span className="text-gray-500">website orders out for delivery</span>,
      onClick: () => onOpen('report'),
    },
    {
      label: 'Sales Count',
      icon: 'tank',
      value: cylinders(todayOrders).toLocaleString('en-PH'),
      sub: <Trend today={cylinders(todayOrders)} yesterday={cylinders(yesterdayOrders)} />,
      onClick: () => onOpen('report'),
    },
    {
      label: "Today's Sales",
      icon: 'peso',
      value: peso(amount(todayOrders)).replace('.00', ''),
      sub: <Trend today={amount(todayOrders)} yesterday={amount(yesterdayOrders)} money />,
      onClick: () => onOpen('report'),
    },
    {
      label: 'Low Stock Items',
      icon: 'alert',
      value: lowStock.length,
      sub: <span className="text-gray-500">sizes at or below the low level</span>,
      onClick: () => onOpen('inventory'),
    },
  ]

  // Tanks Count: the numbers come later (blank for now)
  const tankNumbers = { total: null, revolving: null, borrowed: null }
  const shown = (value) => (value === null || value === undefined ? '—' : value.toLocaleString('en-PH'))

  const quick = [
    { key: 'monthly', label: 'Monthly Sales Report', text: "Check your branch's monthly sales performance.", icon: 'doc' },
    { key: 'yearend', label: 'Year End Report', text: "View your branch's annual sales summary.", icon: 'doc' },
  ]

  // "Juan Dela Cruz" -> "Juan" (the name typed when the account was made)
  const firstName = String(fullName || '').trim().split(/\s+/)[0] || `${branchName(branch)} Staff`

  return (
    <div className="grid gap-3">
      <div>
        <h1 className="m-0 text-[clamp(22px,2.2vw,30px)] leading-tight font-bold" style={{ color: GREEN }}>
          Welcome, {firstName}
        </h1>
        <p className="m-0 text-[13px] text-gray-500">
          Here&apos;s your {branchName(branch)} branch overview for today.
        </p>
        {message && <p className="m-0 text-[13px] text-brand-red">{message}</p>}
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid gap-3">
          {/* ---- today's numbers ---- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={s.onClick}
                className={`${CARD} grid gap-0.5 px-3 py-2.5 text-left hover:opacity-100 hover:shadow-md`}
                style={{ color: GREEN }}
              >
                <span className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-full text-white" style={{ background: GREEN }}>
                    <Icon name={s.icon} className="size-4" />
                  </span>
                  <span className="text-[13px] leading-tight font-semibold">{s.label}</span>
                </span>
                <span className="mt-1 text-[22px] leading-tight font-bold">{s.value}</span>
                <span className="text-[11px]">{s.sub}</span>
              </button>
            ))}
          </div>

          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_230px]">
            {/* ---- order activity ---- */}
            <div className={`${CARD} px-3 py-2.5`}>
              <div className="mb-1.5 flex items-center gap-2" style={{ color: GREEN }}>
                <Icon name="clock" />
                <h2 className="m-0 flex-1 text-[15px] font-bold">Order Activity</h2>
                <button
                  type="button"
                  onClick={() => onOpen('report')}
                  className="flex items-center gap-1 bg-transparent p-0 text-[12px]"
                  style={{ color: GREEN }}
                >
                  View All <Icon name="arrow" className="size-3.5" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-0 text-[12px] [&_td]:border-0 [&_td]:border-b [&_td]:border-(color:--border) [&_td]:px-2 [&_td]:py-1.5 [&_th]:border-0 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium">
                  <thead>
                    <tr className={MINT}>
                      <th className="bg-transparent">Order #</th>
                      <th className="bg-transparent">Customer</th>
                      <th className="bg-transparent">Type</th>
                      <th className="bg-transparent">Time</th>
                      <th className="bg-transparent">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.slice(0, 5).map((r) => (
                      <tr key={r.key}>
                        <td>#{r.id}</td>
                        <td>{r.name}</td>
                        <td>{r.sizes.join(', ')}</td>
                        <td>{timeText(r.when)}</td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {r.remarks.map((key) => {
                              const rm = REMARKS.find((x) => x.key === key)
                              return (
                                <span key={key} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${rm.chip}`}>
                                  {rm.label}
                                </span>
                              )
                            })}
                            {r.outForDelivery && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                                Out for delivery
                              </span>
                            )}
                            {r.remarks.length === 0 && !r.outForDelivery && (
                              <span className="text-gray-400">—</span>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {activity.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-gray-500">No orders yet today</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ---- low stock alerts (the first 3; the rest are counted) ---- */}
            <div className={`${CARD} grid gap-1.5 px-3 py-2.5`}>
              <div className="flex items-center gap-2" style={{ color: GREEN }}>
                <span className="flex size-5 items-center justify-center rounded-full bg-brand-red text-[12px] font-bold text-white">!</span>
                <h2 className="m-0 text-[15px] font-bold">Low Stock Alerts</h2>
              </div>
              {lowStock.slice(0, 3).map((x) => (
                <button
                  key={x.size}
                  type="button"
                  onClick={() => onOpen('inventory')}
                  className="flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-left text-[13px] text-gray-900 hover:bg-red-100 hover:opacity-100"
                >
                  <Icon name="tank" className="size-5 text-brand-red" />
                  <span className="flex-1">
                    <span className="font-semibold">{x.size} LPG</span>
                    <span className="block text-[12px] text-brand-red">
                      {x.left === 0 ? 'out of stock' : `${x.left} tank${x.left === 1 ? '' : 's'} left`}
                    </span>
                  </span>
                  <Icon name="chevron" className="size-3.5 text-brand-red" />
                </button>
              ))}
              {lowStock.length > 3 && (
                <button
                  type="button"
                  onClick={() => onOpen('inventory')}
                  className="bg-transparent p-0 text-left text-[12px] text-brand-red underline"
                >
                  +{lowStock.length - 3} more
                </button>
              )}
              {lowStock.length === 0 && (
                <p className="m-0 text-[13px] text-gray-500">Every size has enough stock.</p>
              )}
              {lowStock.length > 0 && (
                <p className="m-0 flex gap-1.5 text-[11px] text-gray-500">
                  <Icon name="info" className="size-3.5" />
                  Restock soon to avoid service interruption.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ---- current prices of this branch ---- */}
        <div className={`${CARD} overflow-hidden`}>
          <div className={`${MINT} flex items-center gap-2 px-3 py-2`} style={{ color: GREEN }}>
            <Icon name="pin" className="size-4" />
            <span className="flex-1">
              <span className="block text-[14px] font-bold">Current LPG Prices</span>
              <span className="block text-[11px] text-gray-500">{branchName(branch)} branch</span>
            </span>
          </div>
          <div className="grid px-3">
            {prices.map((p) => (
              <div
                key={p.size}
                className="flex items-center justify-between border-b border-(color:--border) py-1.5 text-[13px]"
                style={{ color: GREEN }}
              >
                <span className="font-medium">{p.size}</span>
                <span className="text-[15px] font-bold">{peso(p.price).replace('.00', '')}</span>
              </div>
            ))}
          </div>
          <div className="p-3">
            <button
              type="button"
              onClick={onUpdatePrice}
              className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-semibold text-white"
              style={{ background: GREEN }}
            >
              <Icon name="refresh" className="size-4" />
              Update Price
            </button>
          </div>
        </div>
      </div>

      {/* ---- quick actions ---- */}
      <div className={`${CARD} px-3 py-2.5`}>
        <div className="mb-2 flex items-center gap-2" style={{ color: GREEN }}>
          <Icon name="bolt" />
          <h2 className="m-0 text-[15px] font-bold">Quick Actions</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {/* Tanks Count: the total under the name, Revolving and Borrowed on the right (like Admin Home) */}
          <div className="grid gap-2 rounded-xl border border-(color:--border) p-2.5">
            <div className="flex items-center gap-2.5" style={{ color: GREEN }}>
              <span className="flex size-9 items-center justify-center rounded-full text-white" style={{ background: GREEN }}>
                <Icon name="tank" />
              </span>
              <span className="flex-1">
                <span className="block text-[14px] font-bold">Tanks Count</span>
                <span className="block text-[18px] leading-tight font-bold">{shown(tankNumbers.total)}</span>
              </span>
              <span className="grid gap-0.5 border-l border-(color:--border) pl-2.5 text-[11px] text-gray-500">
                <span>
                  Revolving: <strong style={{ color: GREEN }}>{shown(tankNumbers.revolving)}</strong>
                </span>
                <span>
                  Borrowed: <strong style={{ color: GREEN }}>{shown(tankNumbers.borrowed)}</strong>
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpen('tankcount')}
              className="flex items-center justify-center gap-2 rounded-lg py-1.5 text-[13px] font-medium text-white"
              style={{ background: GREEN }}
            >
              Go to Tanks Count <Icon name="arrow" className="size-3.5" />
            </button>
          </div>

          {quick.map((q) => (
            <div key={q.key} className="grid gap-2 rounded-xl border border-(color:--border) p-2.5">
              <div className="flex items-center gap-2.5" style={{ color: GREEN }}>
                <span className="flex size-9 items-center justify-center rounded-full text-white" style={{ background: GREEN }}>
                  <Icon name={q.icon} />
                </span>
                <span>
                  <span className="block text-[14px] font-bold">{q.label}</span>
                  <span className="block text-[11px] text-gray-500">{q.text}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpen(q.key)}
                className="flex items-center justify-center gap-2 rounded-lg py-1.5 text-[13px] font-medium text-white"
                style={{ background: GREEN }}
              >
                Go to {q.label} <Icon name="arrow" className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
