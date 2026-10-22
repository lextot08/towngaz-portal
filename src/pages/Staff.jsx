import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import StaffLayout from '../components/StaffLayout'
import UpdatePrice from './UpdatePrice'
import InventoryTable from './InventoryTable'
import SalesReport from './SalesReport'
import TankBorrowed from './TankBorrowed'
import TankRevolving from './TankRevolving'
import MonthlySales from './MonthlySales'
import YearEndReport from './YearEndReport'
import CustomerProfile from './CustomerProfile'
import StaffHome from './StaffHome'

export default function Staff({ branch, fullName }) {
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

  const toDeliver = orders.filter(
    (o) => o.status === 'pending' || (o.customer_id && o.delivery_status === 'out_for_delivery')
  )

  const items = [
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'inventory', label: 'Stock Inventory', icon: 'box' },
    { key: 'tankcount', label: 'Tanks Count', icon: 'list' },
    {
      key: 'report',
      label: `Daily Sales Report${toDeliver.length > 0 ? ` (${toDeliver.length})` : ''}`,
      icon: 'report',
    },
    { key: 'borrowed', label: 'Borrowed', icon: 'repeat' },
    { key: 'monthly', label: 'Monthly Sales Report', icon: 'calendar' },
    { key: 'yearend', label: 'Year End Report', icon: 'file' },
    { key: 'customers', label: 'Customer Profile', icon: 'idcard' },
  ]

  return (
    <StaffLayout items={items} active={tab} onSelect={setTab}>
      {message && <p className="mt-0">{message}</p>}

      {tab === 'home' && (
        <StaffHome
          branch={branch}
          fullName={fullName}
          orders={orders}
          onOpen={setTab}
          onUpdatePrice={() => setView('updateprice')}
        />
      )}

      {tab === 'inventory' && <InventoryTable branch={branch} canEdit />}

      {tab === 'tankcount' && <TankRevolving branch={branch} />}

      {tab === 'report' && (
        <SalesReport branch={branch} orders={orders} reload={loadAll} canEdit showRefresh />
      )}
      {/* the reports, with only this branch's orders */}
      {tab === 'monthly' && <MonthlySales branch={branch} />}

      {tab === 'yearend' && <YearEndReport branch={branch} />}

      {tab === 'customers' && <CustomerProfile branch={branch} />}

      {/* Borrowed: the orders marked Utang (and Bayad Utang) in the Daily Sales Report */}
      {tab === 'borrowed' && <TankBorrowed branch={branch} />}

    </StaffLayout>
  )
}