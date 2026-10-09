import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { statusColor } from './stockStatus'
import { branchName } from './branches'

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
      <p style={{ maxWidth: 640, margin: '0 auto 16px', fontSize: 14 }}>
        Restock is recommended when a size is at or below its low-stock level, or would last
        less than 7 days at the speed of the last 30 days of accepted orders. The suggested
        amount brings the stock up to a 14-day supply.
      </p>

      {message && <p>{message}</p>}

      <div style={{ marginBottom: 16 }}>
        {isAdmin && (
          <label>
            Branch:{' '}
            <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
              <option value="">All branches</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{branchName(n)}</option>
              ))}
            </select>
          </label>
        )}{' '}
        <button onClick={load}>Refresh</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ margin: '0 auto' }} cellPadding="8">
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
                style={r.recommended_qty > 0 ? { background: '#fff7e0' } : undefined}
              >
                {isAdmin && <td>{r.branch}</td>}
                <td>{r.size}</td>
                <td>{r.stock}</td>
                <td>{r.sold_30d}</td>
                <td>{Number(r.avg_daily).toFixed(2)}</td>
                <td>{r.days_left === null ? '-' : Number(r.days_left)}</td>
                <td>{r.pending_qty}</td>
                <td style={{ color: statusColor(r.status), fontWeight: 600 }}>{r.status}</td>
                <td style={{ fontWeight: r.recommended_qty > 0 ? 600 : 400 }}>
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