import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { branchName } from './branches'
import { loadLowLevels, stockStatus, statusColor } from './stockStatus'
import { todayString } from './dateUtils'

export default function InventoryTable({ branch }) {
  const [date, setDate] = useState('') // '' means today
  const [rows, setRows] = useState([])
  const [levels, setLevels] = useState({})
  const [message, setMessage] = useState('')

  const shownDate = date || todayString()

  const load = async () => {
    setMessage('')
    // the day runs from midnight to midnight in this device's local time
    const from = new Date(`${shownDate}T00:00:00`)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)

    const { data, error } = await supabase.rpc('inventory_report', {
      p_branch: branch,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    })
    if (error) setMessage(error.message)
    else setRows(data)
    setLevels(await loadLowLevels(supabase))
  }

  useEffect(() => {
    load()
  }, [branch, shownDate])

  return (
    <div>
      <h2>{branchName(branch)} Inventory</h2>

      <div style={{ marginBottom: 12 }}>
        <label>
          Date:{' '}
          <input
            type="date"
            value={shownDate}
            max={todayString()}
            onChange={(e) =>
              setDate(!e.target.value || e.target.value === todayString() ? '' : e.target.value)
            }
          />
        </label>{' '}
        <button onClick={() => setDate('')}>Today</button>{' '}
        <button onClick={load}>Refresh</button>
      </div>

      {message && <p>{message}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ margin: '16px auto' }} cellPadding="8">
          <thead>
            <tr>
              <th>Item</th>
              <th>Beginning</th>
              <th>Sold</th>
              <th>Ending</th>
              <th>Price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = stockStatus('LPG Cylinder ' + r.size, r.ending, levels)
              return (
                <tr key={r.size}>
                  <td>LPG Cylinder {r.size}</td>
                  <td>{r.beginning}</td>
                  <td>{r.sold}</td>
                  <td>{r.ending}</td>
                  <td>{Number(r.price).toFixed(2)}</td>
                  <td style={{ color: statusColor(status), fontWeight: 600 }}>{status}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan="6">No data</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 14, maxWidth: 560, margin: '0 auto' }}>
        Beginning: stock when the day started. Sold: cylinders sold that day. Ending: stock left
        at the end of the day (for today, the stock right now).
      </p>
    </div>
  )
}