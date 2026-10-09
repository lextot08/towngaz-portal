import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'

const fieldStyle = { display: 'grid', gap: 4, fontSize: 14 }

const TYPE_OPTIONS = [
  { value: 'household', label: 'Household' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'rto', label: 'Retail Outlet' },
]

export default function ManualOrder({ branch, onBack }) {
  const [sizes, setSizes] = useState([])
  const [stock, setStock] = useState([])
  const [rules, setRules] = useState({})
  const [size, setSize] = useState('')
  const [customerType, setCustomerType] = useState('household')
  const [fullName, setFullName] = useState('')
  const [address, setAddress] = useState('')
  const [contact, setContact] = useState('')
  const [quantity, setQuantity] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const loadData = async () => {
    const pricesResult = await supabase
      .from('lpg_prices')
      .select('size')
      .order('sort_order')
    const stockResult = await supabase
      .from('stock')
      .select('item_name, quantity, price')
      .eq('branch', branch)
    const rulesResult = await supabase
      .from('customer_types')
      .select('type, label, min_quantity, discount_per_unit')

    if (pricesResult.error) {
      setMessage(pricesResult.error.message)
    } else {
      const list = pricesResult.data.map((p) => p.size)
      setSizes(list)
      setSize((current) => current || list[0] || '')
    }
    if (stockResult.error) setMessage(stockResult.error.message)
    else setStock(stockResult.data)
    if (!rulesResult.error) {
      setRules(Object.fromEntries(rulesResult.data.map((r) => [r.type, r])))
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const item = stock.find((s) => s.item_name === 'LPG Cylinder ' + size)
  const available = item ? item.quantity : 0
  const rule = rules[customerType] || { label: 'Household', min_quantity: 1, discount_per_unit: 0 }

  const unitPrice = item ? Number(item.price) : 0
  const orderQty = Number(quantity) || 0
  const discount = rule.discount_per_unit * orderQty
  const total = unitPrice * orderQty - discount

  // only digits are allowed: no minus sign, decimal point, or letters
  const handleQuantity = (e) => setQuantity(e.target.value.replace(/\D/g, ''))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage('')

    const qty = Number(quantity)
    if (!Number.isInteger(qty) || qty < 1) {
      setMessage('Quantity must be a whole number of at least 1')
      return
    }
    if (qty < rule.min_quantity) {
      setMessage(
        `Minimum order for ${rule.label} customers is ${rule.min_quantity} cylinder${rule.min_quantity > 1 ? 's' : ''}`
      )
      return
    }
    if (qty > available) {
      setMessage(`Only ${available} in stock for this size`)
      return
    }

    const name = fullName.trim()
    if (!(await confirmDialog(`Are you sure you want to add this ${rule.label} order: ${qty} x LPG Cylinder ${size} for ${name}?`))) {
      return
    }

    setSaving(true)
    const { error } = await supabase.rpc('add_manual_order', {
      p_size: size,
      p_quantity: qty,
      p_name: name,
      p_address: address.trim(),
      p_contact: contact.trim(),
      p_customer_type: customerType,
    })
    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`Order added: ${qty} x LPG Cylinder ${size} for ${name}`)
    setFullName('')
    setAddress('')
    setContact('')
    setQuantity('')
    setCustomerType('household')
    loadData()
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ maxWidth: 360, margin: '60px auto', display: 'grid', gap: 12, textAlign: 'left' }}
    >
      <h2>Manual Add Order - {branchName(branch)}</h2>
      <p style={{ margin: 0, fontSize: 14 }}>For customers who order by phone.</p>

      <label style={fieldStyle}>
        Customer name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required style={{ width: '100%' }} />
      </label>

      <label style={fieldStyle}>
        Customer type
        <select value={customerType} onChange={(e) => setCustomerType(e.target.value)} style={{ width: '100%' }}>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        Address
        <input value={address} onChange={(e) => setAddress(e.target.value)} required style={{ width: '100%' }} />
      </label>

      <label style={fieldStyle}>
        Contact No.
        <input type="tel" value={contact} onChange={(e) => setContact(e.target.value)} required style={{ width: '100%' }} />
      </label>

      <label style={fieldStyle}>
        Size
        <select value={size} onChange={(e) => setSize(e.target.value)} style={{ width: '100%' }}>
          {sizes.map((s) => {
            const row = stock.find((x) => x.item_name === 'LPG Cylinder ' + s)
            const qty = row ? row.quantity : 0
            return (
              <option key={s} value={s} disabled={qty < 1}>
                {s} ({qty < 1 ? 'out of stock' : `${qty} in stock`})
              </option>
            )
          })}
        </select>
      </label>

      <label style={fieldStyle}>
        Price
        <input value={item ? Number(item.price).toFixed(2) : ''} readOnly style={{ width: '100%' }} />
      </label>

      <label style={fieldStyle}>
        Quantity (min {rule.min_quantity}, max {available})
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

      {orderQty > 0 && item && (
        <div style={{ background: 'var(--table-head)', borderRadius: 8, padding: 12, display: 'grid', gap: 4 }}>
          <div>Price each: {unitPrice.toFixed(2)}</div>
          <div>Discount: {discount > 0 ? `-${discount.toFixed(2)}` : '0.00'}</div>
          <div><strong>Total: {total.toFixed(2)}</strong></div>
        </div>
      )}

      <button type="submit" disabled={saving || !item || available < 1}>
        {saving ? 'Adding...' : 'Add order'}
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