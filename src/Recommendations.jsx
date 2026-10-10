import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { BRANCHES, branchName } from './branches'
import { statusColor } from './stockStatus'

export default function Recommendations({ mode }) {
  const isAdmin = mode === 'admin'
  const [rows, setRows] = useState([])
  const [filterBranch, setFilterBranch] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    setMessage('')
    const { data, error } = await supabase.rpc('get_recommendations', {
      p_branch: isAdmin && filterBranch ? Number(filterBranch) : null,
    })
    if (error) setMessage(error.message)
    else setRows(data)
  }

  useEffect(() => {
    load()
  }, [filterBranch])

  return (
    <div>
      <h2>Recommendation</h2>
      <p className="mx-auto mb-4 max-w-160 text-[14px]">
        Restock is recommended when a size is at or below its low-stock level, or would last
        less than 7 days at the speed of the last 30 days of accepted orders. The suggested
        amount brings the stock up to a 14-day supply.
      </p>

      {message && <p>{message}</p>}

      <div className="mb-4">
        {isAdmin && (
          <label>
            Branch:{' '}
            <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
              <option value="">All branches</option>
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
        )}{' '}
        <button onClick={load}>Refresh</button>
      </div>

      <div className="overflow-x-auto">
        <table className="mx-auto [&_td]:p-2 [&_th]:p-2">
          <thead>
            <tr>
              {isAdmin && <th>Branch</th>}
              <th>Size</th>
              <th>In stock</th>
              <th>Sold (30 days)</th>
              <th>Per day</th>
              <th>Days left</th>
              <th>Pending orders</th>
              <th>Status</th>
              <th>Recommendation</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.branch}-${r.size}`}
                className={r.recommended_qty > 0 ? 'bg-[#fff7e0]' : ''}
              >
                {isAdmin && <td>{branchName(r.branch)}</td>}
                <td>{r.size}</td>
                <td>{r.stock}</td>
                <td>{r.sold_30d}</td>
                <td>{Number(r.avg_daily).toFixed(2)}</td>
                <td>{r.days_left === null ? '-' : Number(r.days_left)}</td>
                <td>{r.pending_qty}</td>
                <td className="font-semibold" style={{ color: statusColor(r.status) }}>
                  {r.status}
                </td>
                <td className={r.recommended_qty > 0 ? 'font-semibold' : 'font-normal'}>
                  {r.recommended_qty > 0 ? `Add about ${r.recommended_qty}` : '-'}
                </td>
                <td>{r.reason || '-'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={isAdmin ? 10 : 9}>No data yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}