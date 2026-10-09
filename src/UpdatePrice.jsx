import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'

const fieldStyle = { display: 'grid', gap: 4, fontSize: 14 }

export default function UpdatePrice({ branch, onBack }) {
  const [prices, setPrices] = useState([])
  const [size, setSize] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const loadPrices = async () => {
    const sizesResult = await supabase
      .from('lpg_prices')
      .select('size, price')
      .order('sort_order')
    const branchResult = await supabase
      .from('branch_prices')
      .select('size, price')
      .eq('branch', branch)

    if (sizesResult.error) {
      setMessage(sizesResult.error.message)
      return
    }
    const own = Object.fromEntries((branchResult.data || []).map((p) => [p.size, p.price]))
    const list = sizesResult.data.map((p) => ({ size: p.size, price: own[p.size] ?? p.price }))
    setPrices(list)
    setSize((current) => current || list[0]?.size || '')
  }

  useEffect(() => {
    loadPrices()
  }, [])

  const current = prices.find((p) => p.size === size)

  // digits and one decimal point, up to 2 decimals
  const handlePrice = (e) => {
    let v = e.target.value.replace(/[^0-9.]/g, '')
    const [whole, ...rest] = v.split('.')
    v = rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
    setNewPrice(v)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage('')

    const value = Number(newPrice)
    if (!(value > 0)) {
      setMessage('Price must be more than 0')
      return
    }
    if (!(await confirmDialog(`Are you sure you want to change the price of LPG Cylinder ${size} to ${value.toFixed(2)}?`))) {
      return
    }

    setSaving(true)
    const { error } = await supabase.rpc('update_price', { p_size: size, p_price: value })
    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }
    setMessage(`Price of LPG Cylinder ${size} is now ${value.toFixed(2)}`)
    setNewPrice('')
    loadPrices()
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ maxWidth: 360, margin: '60px auto', display: 'grid', gap: 12, textAlign: 'left' }}
    >
      <h2>Update Price - {branchName(branch)}</h2>

      <label style={fieldStyle}>
        Size
        <select value={size} onChange={(e) => setSize(e.target.value)} style={{ width: '100%' }}>
          {prices.map((p) => (
            <option key={p.size} value={p.size}>{p.size}</option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        Current price
        <input
          value={current ? Number(current.price).toFixed(2) : ''}
          readOnly
          style={{ width: '100%' }}
        />
      </label>

      <label style={fieldStyle}>
        New price
        <input
          type="text"
          inputMode="decimal"
          placeholder="For example 950.00"
          value={newPrice}
          onChange={handlePrice}
          required
          style={{ width: '100%' }}
        />
      </label>

      <button type="submit" disabled={saving || !current}>
        {saving ? 'Updating...' : 'Update price'}
      </button>
      <button
        type="button"
        onClick={onBack}
        style={{ background: '#ffffff', color: 'var(--text)', border: '1px solid var(--border)' }}
      >
        Back
      </button>

      {message && <p>{message}</p>}
    </form>
  )
}