import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export default function Inventory() {
  const [items, setItems] = useState([])
  const [itemName, setItemName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [message, setMessage] = useState('')

  const loadItems = async () => {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setMessage(error.message)
    else setItems(data)
  }

  useEffect(() => {
    loadItems()
  }, [])

  const addItem = async (e) => {
    e.preventDefault()
    setMessage('')
    const { error } = await supabase
      .from('inventory')
      .insert({ item_name: itemName, quantity: Number(quantity) })
    if (error) {
      setMessage(error.message)
    } else {
      setItemName('')
      setQuantity(1)
      loadItems()
    }
  }

  const deleteItem = async (id) => {
    await supabase.from('inventory').delete().eq('id', id)
    loadItems()
  }

  return (
    <div>
      <h2>Inventory</h2>

      <form onSubmit={addItem} style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <input placeholder="Item name" value={itemName}
          onChange={(e) => setItemName(e.target.value)} required />
        <input type="number" min="0" value={quantity} style={{ width: 70 }}
          onChange={(e) => setQuantity(e.target.value)} required />
        <button type="submit">Add</button>
      </form>

      {message && <p>{message}</p>}

      <table style={{ margin: '24px auto', minWidth: 320 }}>
        <thead>
          <tr><th>Item</th><th>Qty</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.item_name}</td>
              <td>{item.quantity}</td>
              <td><button onClick={() => deleteItem(item.id)}>Delete</button></td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan="3">No items yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}