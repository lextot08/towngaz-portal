// The other pages of the Monthly Sales Report (admin), laid out like the paper reports.
// The numbers come from the month's orders, the Stock Inventory (filled tanks received), and the
// numbers the admin types (double-click: Deposit, Benta Tanke, Add Tanke, Nawa / Unwind,
// BIVMC Purchases, and the targets T1, T2, T3).
import { useRef, useState } from 'react'
import { BRANCHES } from '../lib/branches'
import { peso } from '../lib/money'
import { expensesOfOrders, otherIncomeOfOrders } from '../lib/expenses'
import {
  entryOf,
  isGcash,
  isGross,
  isUtang,
  kgOfOrders,
  kgOfSize,
  soldOf,
  sumAmount,
} from '../lib/monthly'

const CARD = 'overflow-x-auto rounded-xl border border-(color:--border) bg-white'
const TABLE =
  'w-full min-w-[860px] border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_td]:text-center [&_th]:text-center'
const LABEL = '!text-left font-semibold uppercase'
const SUBTOTAL = 'bg-[#eef6f3] font-semibold'
const NOTE = 'block text-[11px] font-normal text-gray-500'
const NUMBER = 'block text-[15px] font-semibold'

const kgText = (kg) =>
  kg === 0 ? '-' : `${kg.toLocaleString('en-PH', { maximumFractionDigits: 2 })} kg`
const tonsText = (kg) => `${(kg / 1000).toLocaleString('en-PH', { maximumFractionDigits: 3 })} tons`

// A number the admin types: double-click (double-tap) anywhere on its cell to edit, Enter or
// click away to save, Esc to cancel. An empty box removes the number.
// as = the element of the cell ('td' for a whole table cell), children = text before the number.
// empty = what to show when nothing is typed (a gray "-" when left out).
export function Entry({ value, canEdit, onSave, format = peso, as: Tag = 'span', className = 'rounded px-1', children, empty }) {
  const [draft, setDraft] = useState(null)
  const cancelled = useRef(false)

  const start = () => {
    if (!canEdit) return
    cancelled.current = false
    setDraft(value == null ? '' : String(value))
  }

  const save = async () => {
    if (cancelled.current || draft === null) return
    const text = draft.replace(/[₱,\s]/g, '')
    setDraft(null)
    const next = text === '' ? null : Number(text)
    if (next !== null && (!Number.isFinite(next) || next < 0)) return
    if (next === (value ?? null)) return
    await onSave(next)
  }

  return (
    <Tag
      className={`${className} ${canEdit && draft === null ? 'cursor-pointer hover:bg-brand-light' : ''}`}
      title={canEdit ? 'Double-click to edit' : undefined}
      onDoubleClick={draft === null ? start : undefined}
    >
      {children}
      {draft !== null ? (
        <input
          autoFocus
          inputMode="decimal"
          className="w-full min-w-[90px] px-1 text-right"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              cancelled.current = true
              setDraft(null)
            }
          }}
        />
      ) : value == null ? (
        (empty ?? <span className="text-gray-400">-</span>)
      ) : (
        format(value)
      )}
    </Tag>
  )
}

const sumEntries = (entries, key) =>
  BRANCHES.reduce((sum, b) => sum + (entryOf(entries, b.id, key) || 0), 0)

// ---- Page 1: income summary ----
export function IncomeSummary({ orders, entries, canEdit, onSave }) {
  const gross = sumAmount(orders.filter(isGross)) + otherIncomeOfOrders(orders, false)
  const gcash = sumAmount(orders.filter(isGcash)) + otherIncomeOfOrders(orders, true) + sumEntries(entries, 'gcash')
  const benta = sumEntries(entries, 'benta')
  const add = sumEntries(entries, 'add')
  const utang = sumAmount(orders.filter(isUtang)) // collectibles of the branches
  const nawa = entryOf(entries, 0, 'nawa')
  const expenses = expensesOfOrders(orders)
  const purchases = entryOf(entries, 0, 'bivmc_purchases')

  const collectibles = utang + (nawa || 0)
  const spent = expenses + (purchases || 0)
  const actualGross = gross + gcash + benta + add
  const projectedGross = actualGross + collectibles

  return (
    <div className={CARD}>
      <table className={TABLE}>
        <thead>
          <tr>
            <th className="text-brand-pine">Gross Sales</th>
            <th className="text-blue-700">Gcash</th>
            <th>Benta Tanke</th>
            <th>Add Tanke</th>
            <th className="text-brand-red">Collectibles</th>
            <th className="text-brand-red">Expenses</th>
            <th className="text-blue-700">BIVMC Purchases</th>
          </tr>
        </thead>
        <tbody>
          <tr className="h-24 align-top">
            <td>{peso(gross)}</td>
            <td>{peso(gcash)}</td>
            <td>{peso(benta)}</td>
            <td>{peso(add)}</td>
            <td>
              <span className={NOTE}>Branches (Utang)</span>
              {peso(utang)}
              <Entry
                value={nawa}
                canEdit={canEdit}
                className="mt-3 block rounded py-1"
                onSave={(v) => onSave(0, 'nawa', v)}
              >
                <span className={NOTE}>Nawa / Unwind</span>
              </Entry>
            </td>
            <td>{peso(expenses)}</td>
            <Entry
              as="td"
              className=""
              value={purchases}
              canEdit={canEdit}
              onSave={(v) => onSave(0, 'bivmc_purchases', v)}
            />
          </tr>
          {/* subtotals */}
          <tr className={SUBTOTAL}>
            <td colSpan={2}>
              <span className={NUMBER}>{peso(gross + gcash)}</span>
              <span className={NOTE}>Gross Sales + Gcash</span>
            </td>
            <td colSpan={2}>
              <span className={NUMBER}>{peso(benta + add)}</span>
              <span className={NOTE}>Benta Tanke + Add Tanke</span>
            </td>
            <td>
              <span className={NUMBER}>{peso(collectibles)}</span>
              <span className={NOTE}>Total collectibles</span>
            </td>
            <td colSpan={2}>
              <span className={NUMBER}>{peso(spent)}</span>
              <span className={NOTE}>Expenses + BIVMC Purchases</span>
            </td>
          </tr>
          <tr className={SUBTOTAL}>
            <td colSpan={4}>
              <span className={NUMBER}>{peso(actualGross)}</span>
              <span className={`${NOTE} !text-brand-red`}>Actual total gross income</span>
            </td>
            <td colSpan={3} rowSpan={2}>
              <span className={NUMBER}>{peso(spent)}</span>
              <span className={NOTE}>Total expenses &amp; purchases</span>
            </td>
          </tr>
          <tr className={SUBTOTAL}>
            <td colSpan={4}>
              <span className={NUMBER}>{peso(projectedGross)}</span>
              <span className={`${NOTE} !text-blue-700`}>
                Projected total gross income (actual + collectibles)
              </span>
            </td>
          </tr>
          {/* net income */}
          <tr>
            <td colSpan={7} className="py-4">
              <span className="block text-[14px] font-medium">
                Total Gross Income − Total Expenses &amp; Purchases
              </span>
              <span className="mt-3 block text-[18px] font-bold text-brand-pine">
                {peso(actualGross - spent)}
              </span>
              <span className={`${NOTE} !text-blue-700`}>Actual Net Income</span>
              <span className="mt-3 block text-[16px] font-semibold">{peso(projectedGross - spent)}</span>
              <span className={NOTE}>Projected Net Income</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---- Page 2: actual volume against the BIVMC receipts and the target ----
// same order as Sales per Branch
const TARGET_BRANCHES = BRANCHES

export function VolumeTarget({ orders, sizes, receipts, entries, canEdit, onSave }) {
  const rowCount = TARGET_BRANCHES.length

  // kg sold by a branch, and kg received by a branch (Incoming + Refill)
  const actualOf = (b) => kgOfOrders(orders.filter((o) => o.branch === b.id), sizes)
  const receivedOf = (b) =>
    receipts
      .filter((r) => r.branch === b.id)
      .reduce((sum, r) => sum + r.quantity * kgOfSize(r.size), 0)

  const totalActual = TARGET_BRANCHES.reduce((sum, b) => sum + actualOf(b), 0)
  const totalReceived = TARGET_BRANCHES.reduce((sum, b) => sum + receivedOf(b), 0)

  // the targets (kg), and the highest one reached by the total actual volume
  const targets = ['t1', 't2', 't3'].map((key, i) => ({
    key,
    label: `T${i + 1}`,
    kg: entryOf(entries, 0, key),
  }))
  const set = targets.filter((t) => t.kg != null)
  const reached = set.filter((t) => totalActual >= t.kg).pop()
  const next = set.find((t) => totalActual < t.kg)

  return (
    <div className={CARD}>
      <table className={TABLE}>
        <thead>
          <tr>
            <th className={LABEL}>Branch</th>
            <th>
              Actual
              <span className={NOTE}>Tanks volume (kg)</span>
            </th>
            <th>
              BIVMC Receipts
              <span className={NOTE}>Tanks volume (kg)</span>
            </th>
            <th className="text-violet-700">Target Volume Count</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {TARGET_BRANCHES.map((b, i) => (
              <tr key={b.id}>
                <td className={LABEL}>{b.name}</td>
                <td>{kgText(actualOf(b))}</td>
                <td>{kgText(receivedOf(b))}</td>
                {i === 0 && (
                  <>
                    <td rowSpan={rowCount} className="!align-top">
                      {targets.map((t) => (
                        <Entry
                          key={t.key}
                          value={t.kg}
                          canEdit={canEdit}
                          format={kgText}
                          className={`block rounded px-1 py-2 text-left font-semibold ${t.key === 't3' ? 'text-violet-700' : ''}`}
                          onSave={(v) => onSave(0, t.key, v)}
                        >
                          {t.label} ={' '}
                        </Entry>
                      ))}
                    </td>
                    <td rowSpan={rowCount + 1}>
                      {set.length === 0 ? (
                        <span className="text-gray-400">-</span>
                      ) : (
                        <>
                          <span
                            className={`block text-[15px] font-bold ${reached ? 'text-brand-pine' : 'text-brand-red'}`}
                          >
                            {reached ? `${reached.label} reached` : `Below ${set[0].label}`}
                          </span>
                          {next && (
                            <span className={NOTE}>
                              {kgText(next.kg - totalActual)} more to reach {next.label}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          <tr className="bg-[#fdf1e3] font-bold">
            <td className={LABEL}>Total</td>
            <td>
              {kgText(totalActual)}
              <span className={NOTE}>{tonsText(totalActual)}</span>
            </td>
            <td>
              {kgText(totalReceived)}
              <span className={NOTE}>{tonsText(totalReceived)}</span>
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---- Page 3: tanks count and tank volume per branch ----
// same order as Sales per Branch
const VOLUME_BRANCHES = BRANCHES

export function TanksVolume({ orders, sizes }) {
  const sizeList = sizes.length > 0 ? sizes : ['']
  const countText = (n) => (n > 0 ? n.toLocaleString('en-PH') : '-')
  const totalKg = kgOfOrders(orders, sizes)

  return (
    <div className={CARD}>
      <table className={TABLE}>
        <thead>
          <tr>
            <th rowSpan={2} className={LABEL}>Branch</th>
            <th colSpan={sizeList.length}>Tanks Count</th>
            <th colSpan={sizeList.length} className="bg-[#e6f0e6]">Tank Volume (kg)</th>
            <th rowSpan={2}>Total Volume (kg)</th>
          </tr>
          <tr>
            {sizeList.map((s) => (
              <th key={`c-${s}`} className="text-[12px]">{s}</th>
            ))}
            {sizeList.map((s) => (
              <th key={`v-${s}`} className="bg-[#e6f0e6] text-[12px]">{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VOLUME_BRANCHES.map((b) => {
            const list = orders.filter((o) => o.branch === b.id)
            return (
              <tr key={b.id}>
                <td className={LABEL}>{b.name}</td>
                {sizeList.map((s) => (
                  <td key={`c-${s}`}>{countText(soldOf(list, s))}</td>
                ))}
                {sizeList.map((s) => (
                  <td key={`v-${s}`} className="bg-[#f4f8f4]">
                    {kgText(soldOf(list, s) * kgOfSize(s))}
                  </td>
                ))}
                <td className="font-semibold">{kgText(kgOfOrders(list, sizes))}</td>
              </tr>
            )
          })}
          <tr className="bg-[#fdf1e3]">
            <td colSpan={1 + sizeList.length * 2} className="!text-right text-[16px] font-bold text-brand-pine">
              TOTAL VOLUME
            </td>
            <td>
              <span className="block text-[15px] font-bold">{kgText(totalKg)}</span>
              <span className={NOTE}>
                {(totalKg / 1000).toLocaleString('en-PH', { maximumFractionDigits: 3 })} metric tons ·{' '}
                {(totalKg / 907.18474).toLocaleString('en-PH', { maximumFractionDigits: 3 })} US short tons
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
