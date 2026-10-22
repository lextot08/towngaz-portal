// The other pages of the Monthly Sales Report (admin), laid out like the paper reports.
// The numbers are not computed yet, so every cell is empty for now.
import { BRANCHES } from '../lib/branches'

const CARD = 'overflow-x-auto rounded-xl border border-(color:--border) bg-white'
const TABLE =
  'w-full min-w-[860px] border-collapse text-[13px] [&_td]:border [&_td]:border-(color:--border) [&_th]:border [&_th]:border-(color:--border) [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_td]:text-center [&_th]:text-center'
const LABEL = '!text-left font-semibold uppercase'
const SUBTOTAL = 'bg-[#eef6f3] font-semibold'
const NOTE = 'block text-[11px] font-normal text-gray-500'

// the order of the branches on the paper reports
const byName = (names) => names.map((n) => BRANCHES.find((b) => b.name === n)).filter(Boolean)

// ---- Page 1: income summary ----
export function IncomeSummary() {
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
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>
              <span className={NOTE}>Branches</span>
              <span className={`${NOTE} mt-6`}>Nawa / Unwind</span>
            </td>
            <td></td>
            <td></td>
          </tr>
          {/* subtotals */}
          <tr className={SUBTOTAL}>
            <td colSpan={2}>
              <span className={NOTE}>Gross Sales + Gcash</span>
            </td>
            <td colSpan={2}>
              <span className={NOTE}>Benta Tanke + Add Tanke</span>
            </td>
            <td>
              <span className={NOTE}>Total collectibles</span>
            </td>
            <td colSpan={2}>
              <span className={NOTE}>Expenses + BIVMC Purchases</span>
            </td>
          </tr>
          <tr className={SUBTOTAL}>
            <td colSpan={4}>
              <span className={`${NOTE} !text-brand-red`}>Actual total gross income</span>
            </td>
            <td colSpan={3} rowSpan={2}></td>
          </tr>
          <tr className={SUBTOTAL}>
            <td colSpan={5}>
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
              <span className="mt-3 block text-[18px] font-bold text-brand-pine">&nbsp;</span>
              <span className={`${NOTE} !text-blue-700`}>Actual Net Income</span>
              <span className="mt-3 block text-[16px] font-semibold">&nbsp;</span>
              <span className={NOTE}>Projected Net Income</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---- Page 2: actual volume against the BIVMC receipts and the target ----
const RECEIPT_GROUPS = [
  byName(['Bayan', 'Gulod', 'Caloocan', 'Truck']),
  byName(['Cuenca', 'Sta. Teresita', 'Agoncillo']),
]

export function VolumeTarget() {
  const rowCount = RECEIPT_GROUPS.reduce((n, g) => n + g.length, 0)
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
          {RECEIPT_GROUPS.map((group, gi) =>
            group.map((b, i) => (
              <tr key={b.id}>
                <td className={LABEL}>{b.name}</td>
                <td></td>
                {/* one BIVMC receipt covers a group of branches */}
                {i === 0 && <td rowSpan={group.length}></td>}
                {gi === 0 && i === 0 && (
                  <>
                    <td rowSpan={rowCount} className="!align-top">
                      <span className="block py-2 text-left font-semibold">T1 =</span>
                      <span className="block py-2 text-left font-semibold">T2 =</span>
                      <span className="block py-2 text-left font-semibold text-violet-700">T3 =</span>
                    </td>
                    <td rowSpan={rowCount + 1}></td>
                  </>
                )}
              </tr>
            ))
          )}
          <tr className="bg-[#fdf1e3] font-bold">
            <td className={LABEL}>Total</td>
            <td>
              <span className={NOTE}>kgs / tons</span>
            </td>
            <td>
              <span className={NOTE}>kgs / tons</span>
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---- Page 3: tanks count and tank volume per branch ----
const VOLUME_BRANCHES = byName(['Bayan', 'Gulod', 'Cuenca', 'Sta. Teresita', 'Agoncillo', 'Caloocan', 'Truck'])

export function TanksVolume({ sizes }) {
  const sizeList = sizes.length > 0 ? sizes : ['']
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
          {VOLUME_BRANCHES.map((b) => (
            <tr key={b.id}>
              <td className={LABEL}>{b.name}</td>
              {sizeList.map((s) => (
                <td key={`c-${s}`}></td>
              ))}
              {sizeList.map((s) => (
                <td key={`v-${s}`} className="bg-[#f4f8f4]"></td>
              ))}
              <td></td>
            </tr>
          ))}
          <tr className="bg-[#fdf1e3]">
            <td colSpan={1 + sizeList.length * 2} className="!text-right text-[16px] font-bold text-brand-pine">
              TOTAL VOLUME
            </td>
            <td>
              <span className={NOTE}>kgs / metric tons / US short tons</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
