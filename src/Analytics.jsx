import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { supabase } from './supabaseClient'
import { branchName, BRANCHES } from './branches'
import { localDateString, todayString } from './dateUtils'
import { peso } from './money'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'

const OVERALL = 0
// shared chart palette (same colors as the Product performance chart)
const CHART_GREEN = '#005746'
const CHART_RED = '#a80202'
const CHART_MINT = '#70e6dc'

const PERIODS = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
]

// the standard cylinder sizes, in kg
const KNOWN_SIZES = [2.7, 11, 22, 50]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const INVENTORY_COLORS = [CHART_GREEN, CHART_RED]
const ORDER_SPLIT_COLORS = [CHART_GREEN, CHART_RED, CHART_MINT]

// "LPG Cylinder 11kg" -> "11kg"
const sizeOf = (itemName) => (itemName || '').replace('LPG Cylinder ', '')

// "11kg" -> 11 (kilograms of LPG per cylinder)
const kgOf = (itemName) => {
  const match = sizeOf(itemName).match(/[\d.]+/)
  return match ? Number(match[0]) : 0
}

// volume in both units: { tons: "1.23 tons", kg: "1,234.5 kg" }
const volume = (kg) => {
  const weight = Number(kg || 0)
  return {
    tons: `${(weight / 1000).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} tons`,
    kg: `${weight.toLocaleString('en-PH', { maximumFractionDigits: 2 })} kg`,
  }
}

// first day of the period, as 'YYYY-MM-DD'
const firstDay = (days) => {
  const d = new Date()
  d.setDate(d.getDate() - (days - 1))
  return localDateString(d)
}

const KPI = 'flex flex-1 min-w-[200px] flex-col gap-1 rounded-xl border border-(color:--border) bg-white p-5 text-left'
const CARD = 'flex-1 min-w-[340px] rounded-xl border border-(color:--border) bg-white p-4'

// tooltip for the "revenue vs weight" chart
const MonthTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const rev = payload.find((p) => p.dataKey === 'revenue')
  const wt = payload.find((p) => p.dataKey === 'tons')
  return (
    <div className="rounded-lg border border-(color:--border) bg-white px-3 py-2 text-[13px] shadow">
      <div className="font-semibold">{label}</div>
      {rev && <div>{peso(rev.value)}</div>}
      {wt && (
        <div className="text-gray-500">
          {wt.value.toFixed(2)} tons ({(wt.value * 1000).toLocaleString('en-PH')} kg)
        </div>
      )}
    </div>
  )
}

// tooltip for the pie charts
const CountTip = ({ active, payload, unit = 'cylinders' }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-(color:--border) bg-white px-3 py-2 text-[13px] shadow">
      <div className="font-semibold">{payload[0].name}</div>
      <div>
        {Number(payload[0].value).toLocaleString('en-PH')} {unit}
      </div>
    </div>
  )
}

// tooltip for the horizontal product chart
const ProductTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const rev = payload.find((p) => p.dataKey === 'revenue')
  const orders = payload.find((p) => p.dataKey === 'orders')
  return (
    <div className="rounded-lg border border-(color:--border) bg-white px-3 py-2 text-[13px] shadow">
      <div className="font-semibold">{label}</div>
      {rev && <div>{peso(rev.value)}</div>}
      {orders && <div className="text-gray-500">{orders.value} orders</div>}
    </div>
  )
}

// Admin analytics: accepted orders into 4 KPIs, a revenue/weight trend chart,
// inventory and order-split pies, and a product bar chart.
export default function Analytics() {
  const [period, setPeriod] = useState('30')
  const [branch, setBranch] = useState(OVERALL) // 0 = Overall (all branches)
  const [orders, setOrders] = useState([])
  const [inv, setInv] = useState({ filled: 0, empty: 0 })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  // every accepted order; the branch filter is applied below
  const loadOrders = async () => {
    setLoading(true)
    setMessage('')
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'accepted')
      .order('accepted_at', { ascending: false })
    if (error) setMessage(error.message)
    else setOrders(data)
    setLoading(false)
  }

  // current Filled (stock) and Empty (empties report) cylinder counts
  const loadInventory = async () => {
    const day = todayString()
    let stockQuery = supabase.from('stock').select('quantity, branch')
    if (branch !== OVERALL) stockQuery = stockQuery.eq('branch', branch)
    const { data: stock } = await stockQuery
    const filled = (stock || []).reduce((sum, r) => sum + Number(r.quantity || 0), 0)

    const ids = branch === OVERALL ? BRANCHES.map((b) => b.id) : [branch]
    const results = await Promise.all(
      ids.map((id) => supabase.rpc('empties_report', { p_branch: id, p_day: day }))
    )
    const empty = results.reduce(
      (sum, r) => sum + (r.data || []).reduce((s, e) => s + Number(e.ending || 0), 0),
      0
    )
    setInv({ filled, empty })
  }

  useEffect(() => {
    loadOrders()
  }, [])

  useEffect(() => {
    loadInventory()
  }, [branch])

  const revenueOf = (o) => Number(o.total_price) - Number(o.discount || 0)
  // kilograms of LPG for one order: quantity x kg per cylinder
  const kgOfOrder = (o) => Number(o.quantity) * kgOf(o.item_name)

  const chosen = PERIODS.find((p) => p.key === period)
  const from = chosen.days ? firstDay(chosen.days) : null
  const inPeriod = (o) => !from || (o.accepted_at && localDateString(o.accepted_at) >= from)

  const periodAll = orders.filter(inPeriod)
  const rows = branch === OVERALL ? periodAll : periodAll.filter((o) => o.branch === branch)

  const totalVolume = volume(rows.reduce((sum, o) => sum + kgOfOrder(o), 0))
  const totalRevenue = rows.reduce((sum, o) => sum + revenueOf(o), 0)
  const totalOrders = rows.length
  const averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0

  // last 3 months (including the current one): revenue vs weight, branch-filtered
  const monthKeys = []
  for (let i = 2; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    monthKeys.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${MONTH_NAMES[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`,
    })
  }
  const branchOrders = branch === OVERALL ? orders : orders.filter((o) => o.branch === branch)
  const monthChart = monthKeys.map((m) => {
    const monthOrders = branchOrders.filter(
      (o) => o.accepted_at && localDateString(o.accepted_at).startsWith(m.key)
    )
    const kg = monthOrders.reduce((sum, o) => sum + kgOfOrder(o), 0)
    return {
      label: m.label,
      revenue: monthOrders.reduce((sum, o) => sum + revenueOf(o), 0),
      tons: Number((kg / 1000).toFixed(3)),
    }
  })

  // pie: filled vs empty cylinders (current inventory)
  const inventoryPie = [
    { name: 'Filled', value: inv.filled },
    { name: 'Empty', value: inv.empty },
  ].filter((d) => d.value > 0)

  // pie: orders split by source / customer type / delivery status
  const orderSplit = [
    { name: 'Instore (walk-in)', value: rows.filter((o) => o.source === 'walkin').length },
    { name: 'Commercial', value: rows.filter((o) => o.customer_type === 'commercial').length },
    { name: 'Delivered', value: rows.filter((o) => o.delivery_status === 'delivered').length },
  ].filter((d) => d.value > 0)

  // horizontal product chart: revenue and orders per cylinder size
  const productMap = new Map()
  for (const size of KNOWN_SIZES) {
    productMap.set(size, { size, label: `${size} kg`, revenue: 0, orders: 0 })
  }
  for (const o of rows) {
    const size = kgOf(o.item_name)
    if (!productMap.has(size)) productMap.set(size, { size, label: `${size} kg`, revenue: 0, orders: 0 })
    const p = productMap.get(size)
    p.revenue += revenueOf(o)
    p.orders += 1
  }
  const productChart = [...productMap.values()].sort((a, b) => a.size - b.size)

  // breakdowns
  const kpis = [
    { label: 'Total volume', value: totalVolume.tons, sub: totalVolume.kg },
    { label: 'Total revenue', value: peso(totalRevenue) },
    { label: 'Total orders', value: totalOrders.toLocaleString('en-PH') },
    { label: 'Average order value', value: peso(averageOrder) },
  ]

  const periodButton = (p) => (period === p.key ? SOLID : OUTLINE)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Analytics</h1>
          <p className="m-0 text-[14px] text-gray-500">
            {branch === OVERALL ? 'All branches' : branchName(branch)} · accepted orders · {chosen.label}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={branch} onChange={(e) => setBranch(Number(e.target.value))}>
            <option value={OVERALL}>All branches</option>
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {PERIODS.map((p) => (
            <button key={p.key} className={periodButton(p)} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
          <button
            className={OUTLINE}
            onClick={() => {
              loadOrders()
              loadInventory()
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div>
          <div className="mb-8 flex flex-wrap gap-4">
            {kpis.map((k) => (
              <div key={k.label} className={KPI}>
                <span className="text-[14px] text-gray-500">{k.label}</span>
                <span className="text-2xl font-bold text-brand-pine">{k.value}</span>
                {k.sub && <span className="text-[14px] text-gray-500">{k.sub}</span>}
              </div>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap gap-4">
            <div className={CARD}>
              <h3 className="mt-0 mb-2 text-lg">Last 3 months: revenue vs weight</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 12 }}
                    label={{ value: 'tons', angle: 90, position: 'insideRight', fontSize: 12 }}
                  />
                  <Tooltip content={<MonthTip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill={CHART_GREEN} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="tons" name="Weight (tons)" fill={CHART_RED} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className={CARD}>
              <h3 className="mt-0 mb-2 text-lg">Filled vs Empty</h3>
              {inventoryPie.length === 0 ? (
                <p className="text-[14px] text-gray-500">No inventory data</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={inventoryPie}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={(d) => d.name}
                    >
                      {inventoryPie.map((d, i) => (
                        <Cell key={d.name} fill={INVENTORY_COLORS[i % INVENTORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CountTip unit="cylinders" />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="mb-8 flex flex-wrap gap-4">
            <div className={CARD}>
              <h3 className="mt-0 mb-2 text-lg">Instore, Commercial &amp; Delivered</h3>
              {orderSplit.length === 0 ? (
                <p className="text-[14px] text-gray-500">No accepted orders in this period</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={orderSplit}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={(d) => d.name}
                    >
                      {orderSplit.map((d, i) => (
                        <Cell key={d.name} fill={ORDER_SPLIT_COLORS[i % ORDER_SPLIT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CountTip unit="orders" />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <p className="mb-0 text-[12px] text-gray-500">
                Instore = walk-in orders, Commercial = commercial customers, Delivered = delivered orders.
                A single order can fall under more than one slice.
              </p>
            </div>

            <div className={CARD}>
              <h3 className="mt-0 mb-2 text-lg">Product performance (2.7, 11, 22, 50 kg)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  layout="vertical"
                  data={productChart}
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis xAxisId="rev" type="number" tick={{ fontSize: 12 }} />
                  <XAxis xAxisId="orders" type="number" orientation="top" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="label" width={56} tick={{ fontSize: 12 }} />
                  <Tooltip content={<ProductTip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Legend />
                  <Bar xAxisId="rev" dataKey="revenue" name="Revenue" fill={CHART_GREEN} radius={[0, 4, 4, 0]} />
                  <Bar xAxisId="orders" dataKey="orders" name="Orders" fill={CHART_RED} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
