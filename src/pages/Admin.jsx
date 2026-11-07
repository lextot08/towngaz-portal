import { useEffect, lazy, Suspense } from 'react'
import { BRANCHES } from '../lib/branches'
import StaffLayout from '../components/StaffLayout'
import useWaitingOrders from '../lib/useWaitingOrders'
import { useAddress, go, branchSlug, branchOfSlug } from '../lib/address'

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

// the address of each page (Back / Forward move between them);
// a branch is /branches/<branch>/<view>, for example /branches/caloocan/sales-log
const PAGE_PATHS = {
  home: '/home',
  tankcount: '/tanks-count',
  monthly: '/monthly',
  yearend: '/year-end',
  customers: '/customers',
  recommendation: '/recommendation',
  analytics: '/analytics',
  accounts: '/manage-staff',
  updateprice: '/update-price',
}
const VIEW_PATHS = { inventory: 'inventory', report: 'sales-log', dailyreport: 'daily-report' }
const branchPath = (id, view = 'inventory') =>
  `/branches/${id === OVERALL ? 'overall' : branchSlug(id)}/${VIEW_PATHS[view]}`

// "/branches/caloocan/sales-log" -> { tab: 'branches', branch: 1, branchView: 'report' }, unknown -> null
function readPath(path) {
  const page = Object.keys(PAGE_PATHS).find((k) => PAGE_PATHS[k] === path)
  if (page) return { tab: page, branch: OVERALL, branchView: 'inventory' }
  const m = /^\/branches\/([a-z0-9-]+)\/([a-z-]+)$/.exec(path)
  if (!m) return null
  const branch = m[1] === 'overall' ? OVERALL : branchOfSlug(m[1])
  const branchView = Object.keys(VIEW_PATHS).find((k) => VIEW_PATHS[k] === m[2])
  if (branch === null || !branchView) return null
  return { tab: 'branches', branch, branchView }
}

export default function Admin() {
  const path = useAddress()
  const route = readPath(path)
  const { tab, branch, branchView } = route ?? { tab: 'home', branch: OVERALL, branchView: 'inventory' }
  const view = tab === 'updateprice' ? 'updateprice' : 'main'
  const setTab = (key) => go(PAGE_PATHS[key])
  const setView = (v) => go(PAGE_PATHS[v === 'updateprice' ? 'updateprice' : 'home'])
  const waiting = useWaitingOrders(null) // website orders waiting, every branch

  // an unknown address (for example the login screen just after logging in): Admin Home
  const unknownAddress = route === null
  useEffect(() => {
    if (unknownAddress) go(PAGE_PATHS.home, true)
  }, [unknownAddress])

  if (view === 'updateprice') {
    return (
      <Suspense fallback={<p className="m-4 text-[14px] text-gray-500">Loading...</p>}>
        <UpdatePrice branch={ADMIN_BRANCH} onBack={() => setView('main')} />
      </Suspense>
    )
  }

  // clicking Branches from another page starts at Overall
  const selectTab = (key) => {
    if (key === 'branches') {
      if (tab !== 'branches') go(branchPath(OVERALL))
    } else setTab(key)
  }

  // a branch under Branches (it keeps the view shown: Stock Inventory, Daily Sales Log, ...)
  const selectChild = (parentKey, childKey) => {
    go(branchPath(Number(childKey), tab === 'branches' ? branchView : 'inventory'))
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
          go(branchPath(waiting[0]?.branch ?? ADMIN_BRANCH, 'report'))
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
        <BranchView
          branch={branch}
          view={branchView}
          onViewChange={(v) => go(branchPath(branch, v))}
        />
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
