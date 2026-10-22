import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BRANCHES, branchName } from '../lib/branches'
import { peso } from '../lib/money'

const GREEN = '#0b4436'
const RED = '#d4111b'
const CARD = 'rounded-2xl border border-(color:--border) bg-white shadow-sm'
const MINT = 'bg-[#eef6f3]'

const ICONS = {
  pin: 'M12 22s-7-7.5-7-12.5a7 7 0 0 1 14 0C19 14.5 12 22 12 22zM12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  tank: 'M8 3h8M9 3v3M15 3v3M6 9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3zM6 12h12',
  chart: 'M5 20V12M10 20V8M15 20v-6M20 20V4',
  calendar: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5',
}

function Icon({ name, className = 'size-5', strokeWidth = 2 }) {
  return (
    <svg
      className={`${className} shrink-0`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

// the flame of the logo (green with a red inside)
function Flame({ className = 'h-16 w-auto' }) {
  return (
    <svg className={className} viewBox="0 0 40 56" aria-hidden="true">
      <path
        d="M20 2C24 12 36 20 36 34a16 16 0 0 1-32 0C4 24 11 18 13 9c3 5 2 10 5 13 3-6 3-13 2-20z"
        fill={GREEN}
      />
      <path d="M21 26c3 5 7 8 7 14a8 8 0 0 1-15 3c3 1 6-1 6-5 0-5 2-8 2-12z" fill={RED} />
    </svg>
  )
}

// Admin Home: shortcuts to the reports, the current prices of a branch, and the branches.
// Everything is kept small enough to fit on one screen.
export default function AdminHome({
  adminBranch, // the branch whose price the admin can update (Caloocan)
  onOpen, // onOpen('recommendation' | 'tankcount' | 'monthly' | 'yearend')
  onOpenBranch, // onOpenBranch(branchId)
  onUpdatePrice,
}) {
  const [priceBranch, setPriceBranch] = useState(adminBranch)
  const [prices, setPrices] = useState([])
  const [message, setMessage] = useState('')

  // the price of each size for the chosen branch (its own price, or the normal price)
  useEffect(() => {
    const load = async () => {
      setMessage('')
      const sizesResult = await supabase.from('lpg_prices').select('size, price').order('sort_order')
      const branchResult = await supabase
        .from('branch_prices')
        .select('size, price')
        .eq('branch', priceBranch)
      if (sizesResult.error) {
        setMessage(sizesResult.error.message)
        return
      }
      const own = Object.fromEntries((branchResult.data || []).map((p) => [p.size, p.price]))
      setPrices(sizesResult.data.map((p) => ({ size: p.size, price: own[p.size] ?? p.price })))
    }
    load()
  }, [priceBranch])

  // Tanks Count: the numbers come later (blank for now)
  const tankNumbers = { total: null, revolving: null, borrowed: null }
  const shown = (value) => (value === null || value === undefined ? '—' : value.toLocaleString('en-PH'))

  const tiles = [
    { key: 'monthly', label: 'Monthly Sales Report', icon: 'chart' },
    { key: 'yearend', label: 'Year End Report', icon: 'calendar' },
  ]

  const canUpdatePrice = priceBranch === adminBranch
  const TILE =
    'flex rounded-xl p-3 text-white shadow hover:opacity-100 hover:-translate-y-0.5 hover:shadow-lg'

  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ---- left: welcome, recommendations, report tiles ---- */}
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="m-0 text-[clamp(24px,2.6vw,34px)] leading-tight font-bold" style={{ color: GREEN }}>
                Welcome, Admin
              </h1>
              <p className="mt-0.5 mb-0 text-[14px] text-gray-500">
                Here&apos;s an overview of your Town Gaz LPG system.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpen('recommendation')}
            className={`${MINT} flex items-center gap-4 rounded-2xl border border-(color:--border) px-4 py-3 text-left shadow-sm hover:opacity-100 hover:shadow-md`}
            style={{ color: GREEN }}
          >
            <Flame className="h-11 w-auto shrink-0" />
            <span className="h-10 w-px shrink-0 bg-(--border)" />
            <span className="flex-1">
              <span className="block text-[17px] font-bold">Restock Recommendations</span>
              <span className="block text-[13px] text-gray-500">
                Check the latest stock levels and recommended items for each branch.
              </span>
            </span>
            <Icon name="arrow" />
          </button>

          <div className={`${CARD} grid gap-3 p-3 sm:grid-cols-[1.4fr_1fr_1fr]`}>
            {/* Tanks Count: the total under the name, Revolving and Borrowed on the right */}
            <button
              type="button"
              onClick={() => onOpen('tankcount')}
              className={`${TILE} items-center gap-3 text-left`}
              style={{ background: GREEN }}
            >
              <span className="flex flex-1 flex-col items-center gap-1.5 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-white" style={{ color: GREEN }}>
                  <Icon name="tank" className="size-6" />
                </span>
                <span className="text-[15px] leading-tight font-semibold">Tanks Count</span>
                <span className="text-[22px] leading-none font-bold">{shown(tankNumbers.total)}</span>
              </span>
              <span className="grid gap-2 border-l border-white/25 pl-3 text-[12px] text-white/80">
                <span>
                  Revolving:
                  <span className="block text-[16px] font-bold text-white">{shown(tankNumbers.revolving)}</span>
                </span>
                <span>
                  Borrowed:
                  <span className="block text-[16px] font-bold text-white">{shown(tankNumbers.borrowed)}</span>
                </span>
              </span>
            </button>

            {tiles.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onOpen(t.key)}
                className={`${TILE} flex-col items-center justify-center gap-1.5 text-center`}
                style={{ background: GREEN }}
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-white" style={{ color: GREEN }}>
                  <Icon name={t.icon} className="size-6" />
                </span>
                <span className="text-[15px] leading-tight font-semibold">{t.label}</span>
                <span className="flex size-6 items-center justify-center rounded-full bg-[#1f7a64]">
                  <Icon name="arrow" className="size-3.5" />
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ---- right: current prices of a branch ---- */}
        <div className={`${CARD} grid gap-3 p-4`}>
          <label className={`${MINT} flex items-center gap-2 rounded-xl px-3`} style={{ color: GREEN }}>
            <Icon name="pin" />
            <select
              value={priceBranch}
              onChange={(e) => setPriceBranch(Number(e.target.value))}
              className="min-w-0 flex-1 cursor-pointer appearance-none border-0 bg-transparent py-2 text-[16px] font-semibold outline-none"
              style={{ color: GREEN }}
              aria-label="Branch"
            >
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <Icon name="chevronDown" className="size-4" />
          </label>

          <div>
            <h2 className="m-0 mb-1 text-[18px] font-bold" style={{ color: GREEN }}>Current Price</h2>
            {message && <p className="m-0 text-[13px] text-brand-red">{message}</p>}
            <div className="grid">
              {prices.map((p) => (
                <div
                  key={p.size}
                  className="flex items-center justify-between border-t border-(color:--border) py-1.5 text-[14px] font-semibold"
                  style={{ color: GREEN }}
                >
                  <span>{p.size}</span>
                  <span className="text-[15px] font-bold">{peso(p.price).replace('.00', '')}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={!canUpdatePrice}
            onClick={onUpdatePrice}
            className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-semibold text-white"
            style={{ background: GREEN }}
          >
            <Icon name="refresh" className="size-4" />
            Update Price
          </button>
          {!canUpdatePrice && (
            <p className="m-0 -mt-1 text-[12px] text-gray-500">
              The price of {branchName(priceBranch)} is updated by its staff. You can update{' '}
              {branchName(adminBranch)}.
            </p>
          )}
        </div>
      </div>

      {/* ---- branches ---- */}
      <div className={`${CARD} p-4`}>
        <h2 className="m-0 mb-3 border-l-2 pl-3 text-[20px] font-bold" style={{ color: GREEN, borderColor: GREEN }}>
          Branches
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {BRANCHES.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onOpenBranch(b.id)}
              className={`${MINT} flex items-center gap-2.5 rounded-xl border border-(color:--border) px-4 py-2.5 text-left text-[15px] font-semibold hover:opacity-100 hover:shadow-md`}
              style={{ color: GREEN }}
            >
              <Icon name="pin" />
              <span className="flex-1">{b.name}</span>
              <Icon name="arrow" className="size-4" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
