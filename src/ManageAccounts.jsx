import { useEffect, useState } from 'react'
import { supabase, signupClient } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'

const emptyForm = {
  fullName: '',
  address: '',
  contactNumber: '',
  role: 'staff',
  branch: '',
  email: '',
  password: '',
}

const formStyle = {
  maxWidth: 360,
  margin: '0 auto 24px',
  display: 'grid',
  gap: 10,
  textAlign: 'left',
  background: '#ffffff',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 20,
}

const fieldStyle = { display: 'grid', gap: 4, fontSize: 14 }

export default function ManageAccounts({ mode, branch }) {
  const isAdmin = mode === 'admin'
  const [accounts, setAccounts] = useState([])
  const [filterBranch, setFilterBranch] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | account id
  const [form, setForm] = useState(emptyForm)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const loadAccounts = async () => {
    let query = supabase.from('profiles').select('*')
    if (isAdmin) {
      query = query.in('role', ['manager', 'staff'])
      if (filterBranch) query = query.eq('branch', Number(filterBranch))
    } else {
      query = query.eq('role', 'staff').eq('branch', branch)
    }
    const { data, error } = await query
      .order('role')
      .order('branch')
      .order('full_name')
    if (error) setMessage(error.message)
    else setAccounts(data)
  }

  useEffect(() => {
    loadAccounts()
  }, [filterBranch])

  const setField = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  const startAdd = () => {
    setMessage('')
    setForm({ ...emptyForm, branch: isAdmin ? '' : String(branch) })
    setEditing('new')
  }

  const startEdit = (a) => {
    setMessage('')
    setForm({
      fullName: a.full_name || '',
      address: a.address || '',
      contactNumber: a.contact_number || '',
      role: a.role,
      branch: a.branch ? String(a.branch) : '',
      email: a.email || '',
      password: '',
    })
    setEditing(a.id)
  }

  const createAccount = async () => {
    const role = 'staff'
    const branchValue = isAdmin ? Number(form.branch) : Number(branch)
    if (!branchValue) {
      setMessage('Please select a branch')
      return
    }
    const name = form.fullName.trim()
    if (!(await confirmDialog(`Are you sure you want to create this ${role} account for ${name}?`))) {
      return
    }

    setSaving(true)
    const { data, error } = await signupClient.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          full_name: name,
          address: form.address.trim(),
          contact_number: form.contactNumber.trim(),
          role,
          branch: branchValue,
        },
      },
    })

    if (error) {
      setSaving(false)
      setMessage(error.message)
      return
    }
    if (data.user?.identities?.length === 0) {
      setSaving(false)
      setMessage('This email is already registered')
      return
    }

    await signupClient.auth.signOut({ scope: 'local' })

    // new accounts start as pending, so approve it right away
    const { error: approveError } = await supabase
      .from('profiles')
      .update({ status: 'approved' })
      .eq('id', data.user.id)
    setSaving(false)

    if (approveError) {
      setMessage(`Account created, but it could not be approved: ${approveError.message}`)
    } else {
      setMessage(`Account created for ${form.email.trim()}`)
      setEditing(null)
    }
    loadAccounts()
  }

  const saveChanges = async () => {
    if (!(await confirmDialog('Are you sure you want to save these changes?'))) return

    setSaving(true)
    const changes = {
      full_name: form.fullName.trim(),
      address: form.address.trim(),
      contact_number: form.contactNumber.trim(),
    }
    if (isAdmin) changes.branch = Number(form.branch)

    const { data, error } = await supabase
      .from('profiles')
      .update(changes)
      .eq('id', editing)
      .select()
    setSaving(false)

    if (error) setMessage(error.message)
    else if (data.length === 0) setMessage('You are not allowed to edit this account')
    else {
      setMessage('Changes saved')
      setEditing(null)
      loadAccounts()
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage('')
    if (editing === 'new') await createAccount()
    else await saveChanges()
  }

  const deleteAccount = async (a) => {
    setMessage('')
    const who = a.full_name || a.email
    if (!(await confirmDialog(`Are you sure you want to delete ${who}? This cannot be undone.`))) {
      return
    }
    const { error } = await supabase.rpc('delete_account', { p_user_id: a.id })
    if (error) {
      setMessage(error.message)
    } else {
      setMessage('Account deleted')
      if (editing === a.id) setEditing(null)
      loadAccounts()
    }
  }

  const isNew = editing === 'new'

  return (
    <div>
      <h2>Manage Account</h2>
      {message && <p>{message}</p>}

      <div style={{ marginBottom: 16 }}>
        {isAdmin && (
          <label>
            Branch:{' '}
            <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
              <option value="">All branches</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{branchName(n)}</option>
              ))}
            </select>
          </label>
        )}{' '}
        <button onClick={startAdd}>Add account</button>
      </div>

      {editing && (
        <form onSubmit={handleSubmit} style={formStyle}>
          <h3 style={{ margin: 0 }}>{isNew ? 'Add account' : 'Edit account'}</h3>

          <label style={fieldStyle}>
            Full name
            <input value={form.fullName} onChange={setField('fullName')} required />
          </label>

          <label style={fieldStyle}>
            Address
            <input value={form.address} onChange={setField('address')} required />
          </label>

          <label style={fieldStyle}>
            Contact No.
            <input type="tel" value={form.contactNumber} onChange={setField('contactNumber')} required />
          </label>

          {isAdmin && (
            <label style={fieldStyle}>
              Branch
              <select value={form.branch} onChange={setField('branch')} required>
                <option value="" disabled>Select branch</option>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>{branchName(n)}</option>
                ))}
              </select>
            </label>
          )}

          {isNew ? (
            <>
              <label style={fieldStyle}>
                Email
                <input type="email" value={form.email} onChange={setField('email')} required />
              </label>
              <label style={fieldStyle}>
                Password (min 6 characters)
                <input type="password" value={form.password} onChange={setField('password')} required minLength={6} />
              </label>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 14 }}>
              Email: {form.email} ({form.role})
            </p>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Saving...' : isNew ? 'Create account' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              style={{ flex: 1, background: '#ffffff', color: 'var(--text)', border: '1px solid var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ margin: '0 auto' }} cellPadding="8">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Address</th>
              <th>Contact</th>
              {isAdmin && <th>Role</th>}
              {isAdmin && <th>Branch</th>}
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.full_name}</td>
                <td>{a.email}</td>
                <td>{a.address}</td>
                <td>{a.contact_number}</td>
                {isAdmin && <td>{a.role}</td>}
                {isAdmin && <td>{branchName(a.branch)}</td>}
                <td>{a.status}</td>
                <td>
                  <button onClick={() => startEdit(a)}>Edit</button>{' '}
                  <button onClick={() => deleteAccount(a)}>Delete</button>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr><td colSpan={isAdmin ? 8 : 6}>No accounts found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}