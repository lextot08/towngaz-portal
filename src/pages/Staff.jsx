import { useEffect, useState, lazy, Suspense } from 'react'
import { loadBranchOrders, dayStart } from '../lib/branchOrders'
import { todayString } from '../lib/dateUtils'
import StaffLayout from '../components/StaffLayout'
import useWaitingOrders from '../lib/useWaitingOrders'

// each page's code downloads only when it is first opened (a faster first load)
const UpdatePrice = lazy(() => import('./UpdatePrice'))
const InventoryTable = lazy(() => import('./InventoryTable'))
const SalesReport = lazy(() => import('./SalesReport'))
const DailySalesReport = lazy(() => import('./DailySalesReport'))
const TankBorrowed = lazy(() => import('./TankBorrowed'))
const TankRevolving = lazy(() => import('./TankRevolving'))
const MonthlySales = lazy(() => import('./MonthlySales'))
const YearEndReport = lazy(() => import('./YearEndReport'))
const CustomerProfile = lazy(() => import('./CustomerProfile'))
const StaffHome = lazy(() => import('./StaffHome'))

export default function Staff({ branch, fullName }) {
  const [view, setView] = useState('main')
  const [tab, setTab] = useState('home')
  const [orders, setOrders] = useState([])
  const [message, setMessage] = useState('')
  const waiting = useWaitingOrders(branch) // website orders waiting for Accept / Reject

  // Staff Home and the sidebar need only yesterday and today (and the website orders still open);
  // the Daily Sales Log loads its own day
  const loadAll = async () => {
    const today = todayString()
    const ordersResult = await loadBranchOrders(branch, dayStart(today, -1), dayStart(today, 1), true)
    if (ordersResult.error) setMessage(ordersResult.error.message)
    else setOrders(ordersResult.data)
  }

  useEffect(() => {
    loadAll()
  }, [])

  if (view === 'updateprice') {
    return (
      <Suspense fallback={<p className="m-4 text-[14px] text-gray-500">Loading...</p>}>
        <UpdatePrice
          branch={branch}
          onBack={() => {
            setView('main')
            loadAll()
          }}
        />
      </Suspense>
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
        <SalesReport branch={branch} reload={loadAll} canEdit showRefresh />
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