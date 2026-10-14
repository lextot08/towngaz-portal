import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'
import { peso } from './money'

const FIELD = 'grid gap-1 text-[14px]'
const INPUT = 'box-border w-full'
const CANCEL_BTN = 'border border-(color:--border) bg-white text-(color:--text)'

const TYPE_OPTIONS = [
  { value: 'household', label: 'Household' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'rto', label: 'Retail Outlet' },
]

const SOURCE_OPTIONS = [
  { value: 'phone', label: 'Phone' },
  { value: 'walkin', label: 'Walk-in' },
]

export default function ManualOrder({ branch, onBack }) {
  const [sizes, setSizes] = useState([])
  const [stock, setStock] = useState([])
  const [size, setSize] = useState('')
  const [customerType, setCustomerType] = useState('household')
  const [source, setSource] = useState('phone')
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

    if (pricesResult.error) {
      setMessage(pricesResult.error.message)
    } else {
      const list = pricesResult.data.map((p) => p.size)
      setSizes(list)
      setSize((current) => current || list[0] || '')
    }
    if (stockResult.error) setMessage(stockResult.error.message)
    else setStock(stockResult.data)
  }

  useEffect(() => {
    loadData()
  }, [])

  const item = stock.find((s) => s.item_name === 'LPG Cylinder ' + size)
  const available = item ? item.quantity : 0
  const typeLabel = TYPE_OPTIONS.find((t) => t.value === customerType)?.label || 'Household'

  const unitPrice = item ? Number(item.price) : 0
  const orderQty = Number(quantity) || 0
  const total = unitPrice * orderQty

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
    if (qty > available) {
      setMessage(`Only ${available} in stock for this size`)
      return
    }

    const name = fullName.trim()
    if (!(await confirmDialog(`Are you sure you want to add this ${typeLabel} order: ${qty} x LPG Cylinder ${size} for ${name}?`))) {
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
      p_source: source,
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
    <form onSubmit={handleSubmit} className="mx-auto my-15 grid max-w-90 gap-3 text-left">
      <h2>Manual Add Order - {branchName(branch)}</h2>
      <p className="m-0 text-[14px]">For customers who order by phone or walk in.</p>

      <label className={FIELD}>
        Customer name
        <input className={INPUT} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </label>

      <label className={FIELD}>
        Order via
        <select className={INPUT} value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>

      <label className={FIELD}>
        Customer type
        <select className={INPUT} value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      <label className={FIELD}>
        Address
        <input className={INPUT} value={address} onChange={(e) => setAddress(e.target.value)} required />
      </label>

      <label className={FIELD}>
        Contact No.
        <input className={INPUT} type="tel" value={contact} onChange={(e) => setContact(e.target.value)} required />
      </label>

      <label className={FIELD}>
        Size
        <select className={INPUT} value={size} onChange={(e) => setSize(e.target.value)}>
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

      <label className={FIELD}>
        Price
        <input className={INPUT} value={item ? peso(item.price) : ''} readOnly />
      </label>

      <label className={FIELD}>
        Quantity (max {available})
        <input
          className={INPUT}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="Whole number, 1 or more"
          value={quantity}
          onChange={handleQuantity}
          required
        />
      </label>

      {orderQty > 0 && item && (
        <div className="grid gap-1 rounded-lg bg-brand-light p-3">
          <div>Price each: {peso(unitPrice)}</div>
          <div><strong>Total: {peso(total)}</strong></div>
          <div className="text-[12px] text-gray-600">
            A discount, if any, is added later with Edit in the Daily Sales Report.
          </div>
        </div>
      )}

      <button type="submit" disabled={saving || !item || available < 1}>
        {saving ? 'Adding...' : 'Add order'}
      </button>
      <button type="button" onClick={onBack} className={CANCEL_BTN}>
        Back
      </button>

      {message && <p>{message}</p>}
    </form>
  )
}