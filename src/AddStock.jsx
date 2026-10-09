import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'

export default function AddStock({ branch, onBack }) {
  const [prices, setPrices] = useState([])
  const [size, setSize] = useState('')
  const [quantity, setQuantity] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
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
      if (list.length > 0) setSize(list[0].size)
    }
    load()
  }, [branch])

  const selected = prices.find((p) => p.size === size)

  // only digits are allowed, so no minus sign, decimal point, or letters
  const handleQuantity = (e) => setQuantity(e.target.value.replace(/\D/g, ''))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage('')

    const qty = Number(quantity)
    if (!Number.isInteger(qty) || qty < 1) {
      setMessage('Quantity must be a whole number of at least 1')
      return
    }
    
    if (!(await confirmDialog(`Are you sure you want to add ${qty} x LPG Cylinder ${size} to ${branchName(branch)}?`))) {
      return
    }
    setSaving(true)
    const { error } = await supabase.rpc('add_lpg_stock', {
      p_size: size,
      p_quantity: qty,
    })
    setSaving(false)

    if (error) {
      setMessage(error.message)
    } else {
      setMessage(`Added ${qty} x LPG Cylinder ${size} to ${branchName(branch)}`)
      setQuantity('')
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ maxWidth: 320, margin: '60px auto', display: 'grid', gap: 12, textAlign: 'left' }}
    >
      <h2>Add Stock - {branchName(branch)}</h2>

      <label>
        Product
        <input value="LPG Cylinder" readOnly style={{ width: '100%' }} />
      </label>

      <label>
        Size
        <select value={size} onChange={(e) => setSize(e.target.value)} style={{ width: '100%' }}>
          {prices.map((p) => (
            <option key={p.size} value={p.size}>{p.size}</option>
          ))}
        </select>
      </label>

      <label>
        Price
        <input
          value={selected ? Number(selected.price).toFixed(2) : ''}
          readOnly
          style={{ width: '100%' }}
        />
      </label>

      <label>
        Quantity
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="Whole number, 1 or more"
          value={quantity}
          onChange={handleQuantity}
          required
          style={{ width: '100%' }}
        />
      </label>

      <button type="submit" disabled={saving || !selected}>
        {saving ? 'Adding...' : 'Add stock'}
      </button>
      <button type="button" onClick={onBack}>Back</button>

      {message && <p>{message}</p>}
    </form>
  )
}