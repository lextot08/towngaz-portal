import { useState } from 'react'
import { supabase } from './supabaseClient'
import { BRANCHES } from './branches'
import {
  EMAIL_DOMAIN,
  buildEmail,
  passwordError,
  filterName,
  nameError,
  filterContact,
  contactError,
} from './accountRules'

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
  const isSignUp = mode === 'signup'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage('')

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      })
      if (error) setMessage(error.message)
      return
    }

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

    // sign up: the email must end with @towngaz.com and the password follows the rules
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

    const { data, error } = await supabase.auth.signUp({
      email: emailResult.email,
      password: form.password,
      options: {
        data: {
          full_name: form.fullName.trim(),
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

  const switchMode = () => {
    setMode(isSignUp ? 'login' : 'signup')
    setMessage('')
    setForm((f) => ({ ...f, email: '', password: '' }))
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto my-[60px] grid max-w-[320px] gap-3">
      <h2>{isSignUp ? 'Create Towngaz Account' : 'Towngaz Login'}</h2>

      {isSignUp && (
        <>
          <input
            placeholder="Full name (letters only)"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: filterName(e.target.value) })}
            required
          />
          <input placeholder="Address" value={form.address}
            onChange={update('address')} required />
          <input
            placeholder="Contact number (11 digits)"
            type="tel"
            inputMode="numeric"
            maxLength={11}
            value={form.contactNumber}
            onChange={(e) => setForm({ ...form, contactNumber: filterContact(e.target.value) })}
            required
          />
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

      {isSignUp ? (
        <div>
          <div className="flex overflow-hidden rounded-md border border-(color:--border) bg-white">
            <input
              className="min-w-0 flex-1 rounded-none border-0 p-2"
              placeholder="Email name"
              value={form.email}
              onChange={update('email')}
              autoCapitalize="none"
              autoComplete="off"
              required
            />
            <span className="flex items-center bg-brand-light px-3 text-[14px] whitespace-nowrap">
              {EMAIL_DOMAIN}
            </span>
          </div>
          <p className="mt-1 mb-0 text-[12px] text-gray-600">
            Your email always ends with {EMAIL_DOMAIN}
          </p>
        </div>
      ) : (
        <input type="email" placeholder="email@towngaz.com" value={form.email}
          onChange={update('email')} required />
      )}

      <div>
        <input
          className="w-full box-border"
          type="password"
          placeholder={isSignUp ? 'Password (8 or more)' : 'Password'}
          value={form.password}
          onChange={update('password')}
          minLength={isSignUp ? 8 : undefined}
          required
        />
        {isSignUp && (
          <p className="mt-1 mb-0 text-[12px] text-gray-600">
            At least 8 characters, letters and numbers only (no signs or symbols), with at least
            one letter and one number.
          </p>
        )}
      </div>

      <button type="submit">{isSignUp ? 'Create account' : 'Log in'}</button>
      <button type="button" onClick={switchMode}>
        {isSignUp ? 'Back to log in' : 'Create a new account'}
      </button>

      {message && <p>{message}</p>}
    </form>
  )
}