import { useState, lazy, Suspense } from 'react'
import { BRANCHES } from '../lib/branches'
import StaffLayout from '../components/StaffLayout'
import useWaitingOrders from '../lib/useWaitingOrders'

// each page's code downloads only when it is first opened (a faster first load)
const BranchView = lazy(() => import('./BranchView'))
const ManageStaff = lazy(() => import('./ManageStaff'))
const Recommendations = lazy(() => import('./Recommendations'))
const Analytics = lazy(() => import('./Analytics'))
const UpdatePrice = lazy(() => import('./UpdatePrice'))
const MonthlySales = lazy(() => import('./MonthlySales'))
const YearEndReport = lazy(() => import('./YearEndReport'))
const TankRevolving = lazy(() => import('./TankRevolving'))
const AdminHome = lazy(() => import('./AdminHome'))
const CustomerProfile = lazy(() => import('./CustomerProfile'))

const ADMIN_BRANCH = 1 // Caloocan: the admin's staff tools work on this branch only
const OVERALL = 0 // "Overall" under Branches: the total of all branches

export default function Admin() {
  const [tab, setTab] = useState('home')
  const [branch, setBranch] = useState(OVERALL) // "Overall" or the branch chosen under Branches
  const [view, setView] = useState('main')
  const [branchView, setBranchView] = useState({ view: 'inventory', n: 0 }) // the view a branch opens on
  const waiting = useWaitingOrders(null) // website orders waiting, every branch

  if (view === 'updateprice') {
    return (
      <Suspense fallback={<p className="m-4 text-[14px] text-gray-500">Loading...</p>}>
        <UpdatePrice branch={ADMIN_BRANCH} onBack={() => setView('main')} />
      </Suspense>
    )
  }

  // clicking Branches from another page starts at Overall
  const selectTab = (key) => {
    if (key === 'branches' && tab !== 'branches') setBranch(OVERALL)
    setTab(key)
  }

  // a branch under Branches
  const selectChild = (parentKey, childKey) => {
    setBranch(Number(childKey))
    setTab(parentKey)
  }

  const items = [
    { key: 'home', label: 'Admin Home', icon: 'home' },
    {
      key: 'branches',
      label: 'Branches',
      icon: 'branches',
      subItems: [
        { key: String(OVERALL), label: 'Overall' },
        ...BRANCHES.map((b) => ({ key: String(b.id), label: b.name })),
      ],
    },
    { key: 'tankcount', label: 'Tanks Count', icon: 'box' },
    { key: 'monthly', label: 'Monthly Sales Report', icon: 'calendar' },
    { key: 'yearend', label: 'Year End Report', icon: 'file' },
    { key: 'customers', label: 'Customer Profile', icon: 'idcard' },
    { key: 'recommendation', label: 'Recommendation', icon: 'chart' },
    { key: 'analytics', label: 'Analytics', icon: 'trending' },
    { key: 'accounts', label: 'Manage Staff', icon: 'users' },
  ]

  return (
    <StaffLayout
      items={items}
      active={tab}
      onSelect={selectTab}
      activeChild={String(branch)}
      onSelectChild={selectChild}
      bell={{
        count: waiting.length,
        onClick: () => {
          // the Daily Sales Log of the first branch with a website order waiting (or Caloocan)
          setBranch(waiting[0]?.branch ?? ADMIN_BRANCH)
          setBranchView((b) => ({ view: 'report', n: b.n + 1 }))
          setTab('branches')
        },
      }}
    >
      {tab === 'home' && (
        <AdminHome
          adminBranch={ADMIN_BRANCH}
          onOpen={selectTab}
          onOpenBranch={(id) => selectChild('branches', id)}
          onUpdatePrice={() => setView('updateprice')}
        />
      )}

      {tab === 'branches' && (
        <BranchView key={branchView.n} branch={branch} initialView={branchView.view} />
      )}

      {tab === 'monthly' && <MonthlySales />}

      {tab === 'yearend' && <YearEndReport />}

      {tab === 'customers' && <CustomerProfile />}

      {tab === 'tankcount' && <TankRevolving />}

      {tab === 'recommendation' && <Recommendations mode="admin" />}

      {tab === 'analytics' && <Analytics />}

      {tab === 'accounts' && <ManageStaff />}
    </StaffLayout>
  )
}
