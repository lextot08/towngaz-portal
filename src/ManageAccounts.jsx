import { useEffect, useState } from 'react'
import { supabase, signupClient } from './supabaseClient'
import { confirmDialog } from './Confirm'
import { branchName } from './branches'
import {
  EMAIL_DOMAIN,
  buildEmail,
  passwordError,
  filterName,
  nameError,
  filterContact,
  contactError,
} from './accountRules'

const emptyForm = {
  fullName: '',
  address: '',
  contactNumber: '',
  role: 'staff',
  branch: '',
  email: '',
  password: '',
}

const FIELD = 'grid gap-1 text-[14px]'
const CANCEL_BTN = 'flex-1 border border-(color:--border) bg-white text-(color:--text)'

export default function ManageAccounts({ mode, branch, top = null, hidePending = false }) {
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
    const emailResult = buildEmail(form.email)
    if (emailResult.error) {
      setMessage(emailResult.error)
      return
    }
    const passwordProblem = passwordError(form.password)
    if (passwordProblem) {
      setMessage(passwordProblem)
      return
    }
    const name = form.fullName.trim()
    if (!(await confirmDialog(`Are you sure you want to create this ${role} account for ${name}?`))) {
      return
    }

    setSaving(true)
    const { data, error } = await signupClient.auth.signUp({
      email: emailResult.email,
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
      setMessage(`Account created for ${emailResult.email}`)
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
    const nameProblem = nameError(form.fullName)
    if (nameProblem) {
      setMessage(nameProblem)
      return
    }
    const contactProblem = contactError(form.contactNumber)
    if (contactProblem) {
      setMessage(contactProblem)
      return
    }
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
  const visibleAccounts = accounts.filter((a) => !hidePending || a.status !== 'pending')

  return (
    <div>
      <h2>Manage Account</h2>
      {message && <p>{message}</p>}
      {top}

      <div className="mb-4">
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
        <form
          onSubmit={handleSubmit}
          className="mx-auto mb-6 grid max-w-90 gap-2.5 rounded-xl border border-(color:--border) bg-white p-5 text-left"
        >
          <h3 className="m-0">{isNew ? 'Add account' : 'Edit account'}</h3>

          <label className={FIELD}>
            Full name
            <input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: filterName(e.target.value) })}
              required
            />
          </label>

          <label className={FIELD}>
            Address
            <input value={form.address} onChange={setField('address')} required />
          </label>

          <label className={FIELD}>
            Contact No.
            <input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={form.contactNumber}
              onChange={(e) => setForm({ ...form, contactNumber: filterContact(e.target.value) })}
              required
            />
          </label>

          {isAdmin && (
            <label className={FIELD}>
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
              <div className={FIELD}>
                Email
                <div className="flex overflow-hidden rounded-md border border-(color:--border) bg-white">
                  <input
                    className="min-w-0 flex-1 rounded-none border-0 p-2"
                    placeholder="Email name"
                    value={form.email}
                    onChange={setField('email')}
                    autoCapitalize="none"
                    autoComplete="off"
                    required
                  />
                  <span className="flex items-center bg-brand-light px-3 whitespace-nowrap">
                    {EMAIL_DOMAIN}
                  </span>
                </div>
              </div>
              <label className={FIELD}>
                Password (8 or more, letters and numbers only)
                <input
                  type="password"
                  value={form.password}
                  onChange={setField('password')}
                  required
                  minLength={8}
                />
              </label>
            </>
          ) : (
            <p className="m-0 text-[14px]">
              Email: {form.email} ({form.role})
            </p>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="flex-1">
              {saving ? 'Saving...' : isNew ? 'Create account' : 'Save changes'}
            </button>
            <button type="button" onClick={() => setEditing(null)} className={CANCEL_BTN}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="mx-auto [&_td]:p-2 [&_th]:p-2">
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
            {visibleAccounts.map((a) => (
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
            {visibleAccounts.length === 0 && (
              <tr><td colSpan={isAdmin ? 8 : 6}>No accounts found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}