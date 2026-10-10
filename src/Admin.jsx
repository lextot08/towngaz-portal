import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'
import BranchView from './BranchView'
import ManageAccounts from './ManageAccounts'
import Recommendations from './Recommendations'
import AddStock from './AddStock'
import ManualOrder from './ManualOrder'
import UpdatePrice from './UpdatePrice'

const ADMIN_BRANCH = 1 // Caloocan: the admin's staff tools work on this branch only

export default function Admin({ user }) {
  const [tab, setTab] = useState('home')
  const [view, setView] = useState('main')
  const [pending, setPending] = useState([])
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

  const tabClass = (name) => `mr-2 ${tab === name ? 'font-bold' : 'font-normal'}`

  return (
    <div className="mt-10 text-center">
      <nav className="mb-6">
        <button className={tabClass('home')} onClick={() => setTab('home')}>Admin Home</button>
        <button className={tabClass('branches')} onClick={() => setTab('branches')}>Branches</button>
        <button className={tabClass('recommendation')} onClick={() => setTab('recommendation')}>
          Recommendation
        </button>
        <button className={tabClass('pending')} onClick={() => setTab('pending')}>
          Pending Staff ({pending.length})
        </button>
        <button className={tabClass('accounts')} onClick={() => setTab('accounts')}>
          Manage account
        </button>
        <button
          onClick={async () => {
            if (await confirmDialog('Are you sure you want to log out?')) supabase.auth.signOut()
          }}
        >
          Log out
        </button>
      </nav>

      {tab === 'home' && (
        <div>
          <h1>Towngaz Admin</h1>
          <p>Logged in as {user.email}</p>
          <p>Pending staff waiting for approval: {pending.length}</p>
          <p className="mt-6">Staff tools for {branchName(ADMIN_BRANCH)}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button onClick={() => setView('addstock')}>Add stock</button>
            <button onClick={() => setView('manualorder')}>Manual add order</button>
            <button onClick={() => setView('updateprice')}>Update price</button>
          </div>
        </div>
      )}

      {tab === 'pending' && (
        <div>
          <h2>Pending Staff</h2>
          {message && <p>{message}</p>}
          <div className="overflow-x-auto">
            <table className="mx-auto my-6 [&_td]:p-2 [&_th]:p-2">
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
      )}

      {tab === 'branches' && <BranchView />}
      {tab === 'recommendation' && <Recommendations mode="admin" />}
      {tab === 'accounts' && <ManageAccounts mode="admin" />}
    </div>
  )
}