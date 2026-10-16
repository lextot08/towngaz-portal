import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName, BRANCHES } from './branches'
import StaffLayout from './StaffLayout'
import BranchView from './BranchView'
import ManageAccounts from './ManageAccounts'
import Recommendations from './Recommendations'
import Analytics from './Analytics'
import AddStock from './AddStock'
import ManualOrder from './ManualOrder'
import UpdatePrice from './UpdatePrice'
import Pahiram from './Pahiram'

const ADMIN_BRANCH = 1 // Caloocan: the admin's staff tools work on this branch only
const OVERALL = 0 // "Overall" under Branches: the total of all branches

export default function Admin({ user }) {
  const [tab, setTab] = useState('home')
  const [branch, setBranch] = useState(OVERALL) // "Overall" or the branch chosen under Branches
  const [tankView, setTankView] = useState('borrowed') // the page chosen under Tank Count
  const [view, setView] = useState('main')
  const [pending, setPending] = useState([])
  const [accountsVersion, setAccountsVersion] = useState(0)
  const [message, setMessage] = useState('')

  const loadPending = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'staff')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (error) setMessage(error.message)
    else setPending(data)
  }

  useEffect(() => {
    loadPending()
  }, [])

  const decide = async (id, status) => {
    const action = status === 'approved' ? 'approve' : 'reject'
    if (!(await confirmDialog(`Are you sure you want to ${action} this account?`))) return
    setMessage('')
    const { error } = await supabase
      .from('profiles')
      .update({ status })
      .eq('id', id)
    if (error) setMessage(error.message)
    loadPending()
    setAccountsVersion((v) => v + 1) // reloads the account list below
  }

  if (view === 'addstock') {
    return <AddStock branch={ADMIN_BRANCH} onBack={() => setView('main')} />
  }
  if (view === 'manualorder') {
    return <ManualOrder branch={ADMIN_BRANCH} onBack={() => setView('main')} />
  }
  if (view === 'updateprice') {
    return <UpdatePrice branch={ADMIN_BRANCH} onBack={() => setView('main')} />
  }

  // clicking Branches from another page starts at Overall, and Tank Count at Borrowed
  const selectTab = (key) => {
    if (key === 'branches' && tab !== 'branches') setBranch(OVERALL)
    if (key === 'tankcount' && tab !== 'tankcount') setTankView('borrowed')
    setTab(key)
  }

  // a smaller button under Branches or Tank Count
  const selectChild = (parentKey, childKey) => {
    if (parentKey === 'branches') setBranch(Number(childKey))
    else setTankView(childKey)
    setTab(parentKey)
  }

  const TANK_VIEWS = [
    { key: 'borrowed', label: 'Borrowed' },
    { key: 'returned', label: 'Returned' },
    { key: 'sell', label: 'Sell' },
    { key: 'buy', label: 'Buy' },
  ]

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
    { key: 'monthly', label: 'Monthly Sales Report', icon: 'calendar' },
    { key: 'yearend', label: 'Year End Report', icon: 'file' },
    { key: 'tankcount', label: 'Tank Count', icon: 'box', subItems: TANK_VIEWS },
    { key: 'recommendation', label: 'Recommendation', icon: 'chart' },
    { key: 'analytics', label: 'Analytics', icon: 'trending' },
    {
      key: 'accounts',
      label: `Manage account${pending.length > 0 ? ` (${pending.length})` : ''}`,
      icon: 'users',
    },
    { key: 'pahiram', label: 'Pahiram', icon: 'repeat' },
  ]

  // pending accounts, shown at the top of Manage account
  const pendingSection = (
    <div className="mb-8">
      <h3 className="mt-0 mb-2 text-lg">Pending staff ({pending.length})</h3>
      {message && <p className="mt-0">{message}</p>}
      <div className="overflow-x-auto rounded-xl border border-(color:--border) bg-white">
        <table className="w-full [&_td]:p-2 [&_th]:p-2">
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Address</th>
              <th>Contact</th><th>Branch</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.id}>
                <td>{p.full_name}</td>
                <td>{p.email}</td>
                <td>{p.address}</td>
                <td>{p.contact_number}</td>
                <td>{branchName(p.branch)}</td>
                <td>
                  <button onClick={() => decide(p.id, 'approved')}>Approve</button>{' '}
                  <button onClick={() => decide(p.id, 'rejected')}>Reject</button>
                </td>
              </tr>
            ))}
            {pending.length === 0 && (
              <tr><td colSpan="6">No pending staff</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <StaffLayout
      items={items}
      active={tab}
      onSelect={selectTab}
      activeChild={tab === 'tankcount' ? tankView : String(branch)}
      onSelectChild={selectChild}
    >
      {tab === 'home' && (
        <div>
          <h1 className="mt-0 mb-4 text-2xl">Towngaz Admin</h1>
          <p>Logged in as {user.email}</p>
          <p>Pending staff waiting for approval: {pending.length}</p>
          <p className="mt-6">Staff tools for {branchName(ADMIN_BRANCH)}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setView('addstock')}>Add stock</button>
            <button onClick={() => setView('manualorder')}>Manual add order</button>
            <button onClick={() => setView('updateprice')}>Update price</button>
          </div>
        </div>
      )}

      {tab === 'branches' && <BranchView branch={branch} />}

      {/* blank for now */}
      {tab === 'monthly' && <h1 className="mt-0 mb-4 text-2xl">Monthly Sales Report</h1>}

      {/* blank for now */}
      {tab === 'yearend' && <h1 className="mt-0 mb-4 text-2xl">Year End Report</h1>}

      {/* blank for now */}
      {tab === 'tankcount' && (
        <h1 className="mt-0 mb-4 text-2xl">
          Tank Count - {TANK_VIEWS.find((v) => v.key === tankView).label}
        </h1>
      )}

      {tab === 'recommendation' && <Recommendations mode="admin" />}

      {tab === 'analytics' && <Analytics />}

      {tab === 'accounts' && (
        <ManageAccounts key={accountsVersion} mode="admin" top={pendingSection} hidePending />
      )}

      {tab === 'pahiram' && <Pahiram branch={ADMIN_BRANCH} />}
    </StaffLayout>
  )
}
