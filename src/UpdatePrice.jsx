import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'
import { peso } from './money'

const FIELD = 'grid gap-1 text-[14px]'
const INPUT = 'box-border w-full'
const CANCEL_BTN = 'border border-(color:--border) bg-white text-(color:--text)'

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
      setMessage('Price must be more than ₱0')
      return
    }
    if (!(await confirmDialog(`Are you sure you want to change the price of LPG Cylinder ${size} to ${peso(value)}?`))) {
      return
    }

    setSaving(true)
    const { error } = await supabase.rpc('update_price', { p_size: size, p_price: value })
    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }
    setMessage(`Price of LPG Cylinder ${size} is now ${peso(value)}`)
    setNewPrice('')
    loadPrices()
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto my-15 grid max-w-90 gap-3 text-left">
      <h2>Update Price - {branchName(branch)}</h2>

      <label className={FIELD}>
        Size
        <select className={INPUT} value={size} onChange={(e) => setSize(e.target.value)}>
          {prices.map((p) => (
            <option key={p.size} value={p.size}>{p.size}</option>
          ))}
        </select>
      </label>

      <label className={FIELD}>
        Current price
        <input
          className={INPUT}
          value={current ? peso(current.price) : ''}
          readOnly
        />
      </label>

      <label className={FIELD}>
        New price
        <div className="flex overflow-hidden rounded-md border border-(color:--border) bg-white">
          <span className="flex items-center bg-brand-light px-3">₱</span>
          <input
            className="min-w-0 flex-1 rounded-none border-0 p-2"
            type="text"
            inputMode="decimal"
            placeholder="For example 950.00"
            value={newPrice}
            onChange={handlePrice}
            required
          />
        </div>
      </label>

      <button type="submit" disabled={saving || !current}>
        {saving ? 'Updating...' : 'Update price'}
      </button>
      <button type="button" onClick={onBack} className={CANCEL_BTN}>
        Back
      </button>

      {message && <p>{message}</p>}
    </form>
  )
}