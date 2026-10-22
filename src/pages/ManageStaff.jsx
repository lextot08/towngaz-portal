import { useState } from 'react'
import ManageAccounts from './ManageAccounts'
import AuditLog from './AuditLog'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'

// Manage Staff (admin): the staff accounts (made by the admin), and what the staff did.
export default function ManageStaff() {
  const [view, setView] = useState('accounts') // accounts | audit

  const buttonClass = (name) => (view === name ? SOLID : OUTLINE)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="mr-2 text-xl font-bold text-brand-pine">Manage Staff</span>
        <button className={buttonClass('accounts')} onClick={() => setView('accounts')}>
          Manage Staff Account
        </button>
        <button className={buttonClass('audit')} onClick={() => setView('audit')}>
          Staff Audit Log
        </button>
      </div>

      {view === 'accounts' && <ManageAccounts mode="admin" />}

      {/* only what staff and the admin did (customer actions are left out) */}
      {view === 'audit' && <AuditLog roles={['staff', 'admin']} />}
    </div>
  )
}
