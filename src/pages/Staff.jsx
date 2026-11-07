import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import StaffLayout from '../components/StaffLayout'
import UpdatePrice from './UpdatePrice'
import InventoryTable from './InventoryTable'
import SalesReport from './SalesReport'
import DailySalesReport from './DailySalesReport'
import TankBorrowed from './TankBorrowed'
import TankRevolving from './TankRevolving'
import MonthlySales from './MonthlySales'
import YearEndReport from './YearEndReport'
import CustomerProfile from './CustomerProfile'
import StaffHome from './StaffHome'
import useWaitingOrders from '../lib/useWaitingOrders'

export default function Staff({ branch, fullName }) {
  const [view, setView] = useState('main')
  const [tab, setTab] = useState('home')
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')
  const waiting = useWaitingOrders(branch) // website orders waiting for Accept / Reject

  const loadAll = async () => {
    const ordersResult = await fetchAll(() =>
      supabase
        .from('orders')
        .select('*')
        .eq('branch', branch)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    )
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
      label: `Daily Sales Log${toDeliver.length > 0 ? ` (${toDeliver.length})` : ''}`,
      icon: 'report',
    },
    { key: 'dailyreport', label: 'Daily Sales Report', icon: 'file' },
    { key: 'borrowed', label: 'Borrowed', icon: 'repeat' },
    { key: 'monthly', label: 'Monthly Sales Report', icon: 'calendar' },
    { key: 'yearend', label: 'Year End Report', icon: 'file' },
    { key: 'customers', label: 'Customer Profile', icon: 'idcard' },
  ]

  return (
    <StaffLayout
      items={items}
      active={tab}
      onSelect={setTab}
      bell={{
        count: waiting.length,
        onClick: () => {
          setTab('report')
          loadAll()
        },
      }}
    >
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
      {tab === 'dailyreport' && <DailySalesReport branch={branch} canEdit />}

      {/* the reports, with only this branch's orders */}
      {tab === 'monthly' && <MonthlySales branch={branch} />}

      {tab === 'yearend' && <YearEndReport branch={branch} />}

      {tab === 'customers' && <CustomerProfile branch={branch} />}

      {/* Borrowed: the orders marked Borrowed in the Daily Sales Log */}
      {tab === 'borrowed' && <TankBorrowed branch={branch} />}

    </StaffLayout>
  )
}