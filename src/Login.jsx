import { useState } from 'react'
import { supabase } from './supabaseClient'
import { BRANCHES } from './branches'

export default function Login({ initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode)
  const [form, setForm] = useState({
    fullName: '',
    address: '',
    contactNumber: '',
    role: 'customer',
    customerType: 'household',
    branch: '',
    email: '',
    password: '',
  })
  const [message, setMessage] = useState('')

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  const needsBranch = form.role === 'staff'
  const isCustomer = form.role === 'customer'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage('')

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      })
      if (error) setMessage(error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            full_name: form.fullName,
            address: form.address,
            contact_number: form.contactNumber,
            role: form.role,
            customer_type: isCustomer ? form.customerType : null,
            branch: needsBranch ? Number(form.branch) : null,
          },
        },
      })
      if (error) setMessage(error.message)
      else if (!data.session) setMessage('Account created! Check your email to confirm, then log in.')
    }
  }

  const isSignUp = mode === 'signup'

  return (
    <form
      onSubmit={handleSubmit}
      style={{ maxWidth: 320, margin: '60px auto', display: 'grid', gap: 12 }}
    >
      <h2>{isSignUp ? 'Create Towngaz Account' : 'Towngaz Login'}</h2>

      {isSignUp && (
        <>
          <input placeholder="Full name" value={form.fullName}
            onChange={update('fullName')} required />
          <input placeholder="Address" value={form.address}
            onChange={update('address')} required />
          <input placeholder="Contact number" value={form.contactNumber}
            onChange={update('contactNumber')} required />
          <select value={form.role} onChange={update('role')}>
            <option value="customer">Customer</option>
            <option value="staff">Staff (needs admin approval)</option>
          </select>

          {isCustomer && (
            <select value={form.customerType} onChange={update('customerType')}>
              <option value="household">Household</option>
              <option value="commercial">Commercial</option>
              <option value="rto">Retail Outlet</option>
            </select>
          )}

          {needsBranch && (
            <select value={form.branch} onChange={update('branch')} required>
              <option value="" disabled>Select branch</option>
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
        </>
      )}

      <input type="email" placeholder="Email" value={form.email}
        onChange={update('email')} required />
      <input type="password" placeholder="Password (min 6 characters)" value={form.password}
        onChange={update('password')} required minLength={6} />

      <button type="submit">{isSignUp ? 'Create account' : 'Log in'}</button>
      <button type="button" onClick={() => { setMode(isSignUp ? 'login' : 'signup'); setMessage('') }}>
        {isSignUp ? 'Back to log in' : 'Create a new account'}
      </button>

      {message && <p>{message}</p>}
    </form>
  )
}