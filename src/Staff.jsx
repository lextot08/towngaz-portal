import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { branchName } from './branches'
import StaffLayout from './StaffLayout'
import AddStock from './AddStock'
import ManualOrder from './ManualOrder'
import UpdatePrice from './UpdatePrice'
import InventoryTable from './InventoryTable'
import SalesReport from './SalesReport'
import Pahiram from './Pahiram'

export default function Staff({ user, branch }) {
  const [view, setView] = useState('main')
  const [tab, setTab] = useState('home')
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')

  const loadAll = async () => {
    const ordersResult = await supabase
      .from('orders')
      .select('*')
      .eq('branch', branch)
      .order('created_at', { ascending: false })
    if (ordersResult.error) setMessage(ordersResult.error.message)
    else setOrders(ordersResult.data)
  }

  useEffect(() => {
    loadAll()
  }, [])

  if (view === 'addstock') {
    return (
      <AddStock
        branch={branch}
        onBack={() => {
          setView('main')
          loadAll()
        }}
      />
    )
  }

  if (view === 'manualorder') {
    return (
      <ManualOrder
        branch={branch}
        onBack={() => {
          setView('main')
          loadAll()
        }}
      />
    )
  }

  if (view === 'updateprice') {
    return (
      <UpdatePrice
        branch={branch}
        onBack={() => {
          setView('main')
          loadAll()
        }}
      />
    )
  }

  const pendingOrders = orders.filter((o) => o.status === 'pending')
  const acceptedOrders = orders.filter((o) => o.status === 'accepted')
  const toDeliver = acceptedOrders.filter((o) => o.delivery_status !== 'delivered')

  const items = [
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'inventory', label: 'Stock Inventory', icon: 'box' },
    {
      key: 'report',
      label: `Daily Sales Report${pendingOrders.length > 0 ? ` (${pendingOrders.length})` : ''}`,
      icon: 'report',
    },
    { key: 'pahiram', label: 'Pahiram', icon: 'repeat' },    
  ]

  return (
    <StaffLayout items={items} active={tab} onSelect={setTab}>
      {message && <p className="mt-0">{message}</p>}

      {tab === 'home' && (
        <div>
          <h1 className="mt-0 mb-4 text-2xl">{branchName(branch)} Staff</h1>
          <p>Logged in as {user.email}</p>
          <p>Orders waiting to be accepted: {pendingOrders.length}</p>
          <p>Orders to deliver: {toDeliver.length}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button onClick={() => setView('addstock')}>Add stock</button>
            <button onClick={() => setView('manualorder')}>Manual add order</button>
            <button onClick={() => setView('updateprice')}>Update price</button>
          </div>
        </div>
      )}

      {tab === 'inventory' && <InventoryTable branch={branch} canEdit />}

      {tab === 'report' && (
        <SalesReport branch={branch} orders={orders} reload={loadAll} canEdit showRefresh />
      )}
      {tab === 'pahiram' && <Pahiram branch={branch} />}
    </StaffLayout>
  )
}