import { useState } from 'react'
import { BRANCHES } from '../lib/branches'
import StaffLayout from '../components/StaffLayout'
import BranchView from './BranchView'
import ManageStaff from './ManageStaff'
import Recommendations from './Recommendations'
import Analytics from './Analytics'
import UpdatePrice from './UpdatePrice'
import MonthlySales from './MonthlySales'
import YearEndReport from './YearEndReport'
import TankRevolving from './TankRevolving'
import AdminHome from './AdminHome'
import CustomerProfile from './CustomerProfile'

const ADMIN_BRANCH = 1 // Caloocan: the admin's staff tools work on this branch only
const OVERALL = 0 // "Overall" under Branches: the total of all branches

export default function Admin() {
  const [tab, setTab] = useState('home')
  const [branch, setBranch] = useState(OVERALL) // "Overall" or the branch chosen under Branches
  const [view, setView] = useState('main')

  if (view === 'updateprice') {
    return <UpdatePrice branch={ADMIN_BRANCH} onBack={() => setView('main')} />
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
    >
      {tab === 'home' && (
        <AdminHome
          adminBranch={ADMIN_BRANCH}
          onOpen={selectTab}
          onOpenBranch={(id) => selectChild('branches', id)}
          onUpdatePrice={() => setView('updateprice')}
        />
      )}

      {tab === 'branches' && <BranchView branch={branch} />}

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
