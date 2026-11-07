import { useEffect, useState, lazy, Suspense } from 'react'
import { supabase } from './lib/supabaseClient'
import { confirmDialog } from './components/Confirm'
import Login from './pages/Login'

// each page's code downloads only when it is first opened (a faster first load)
const Admin = lazy(() => import('./pages/Admin'))
const Staff = lazy(() => import('./pages/Staff'))

const WEBSITE_URL = 'http://localhost:5173/' // address of the customer website

function StatusScreen({ title, text, link }) {
  return (
    <div className="mt-20 text-center">
      <h2>{title}</h2>
      <p>{text}</p>
      {link && <p><a href={link}>Go to the website</a></p>}
      <button
        onClick={async () => {
          if (await confirmDialog('Are you sure you want to log out?')) supabase.auth.signOut()
        }}
      >
        Log out
      </button>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(undefined)
  // true while the login page checks the account's branch (the portal must not open yet)
  const [checkingLogin, setCheckingLogin] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id

  useEffect(() => {
    setProfile(undefined)
    if (!userId) return
    supabase
      .from('profiles')
      .select('role, status, branch, full_name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
  }, [userId])

  if (session === undefined) return <p>Loading...</p>
  if (!session || checkingLogin) return <Login onCheckingChange={setCheckingLogin} />
  if (profile === undefined) return <p>Loading...</p>

  if (!profile) {
    return <StatusScreen title="Profile not found" text="Please log out and try again." />
  }

  if (profile.role === 'customer') {
    return (
      <StatusScreen
        title="This is the staff portal"
        text="Customers can order on the Towngaz website."
        link={WEBSITE_URL}
      />
    )
  }

  if (profile.status === 'pending') {
    return (
      <StatusScreen
        title="Account pending approval"
        text="Your account is waiting for approval from the admin. Please check back later."
      />
    )
  }

  if (profile.status === 'rejected') {
    return (
      <StatusScreen
        title="Account not approved"
        text="Your account request was rejected. Please contact Towngaz for help."
      />
    )
  }

  if (profile.role === 'admin') {
    return (
      <Suspense fallback={<p className="m-4 text-[14px] text-gray-500">Loading...</p>}>
        <Admin user={session.user} />
      </Suspense>
    )
  }

  if (profile.role === 'staff') {
    if (!profile.branch) {
      return <StatusScreen title="No branch assigned" text="Please contact the admin." />
    }
    return (
      <Suspense fallback={<p className="m-4 text-[14px] text-gray-500">Loading...</p>}>
        <Staff branch={profile.branch} fullName={profile.full_name} />
      </Suspense>
    )
  }

  return (
    <StatusScreen
      title="Account type no longer used"
      text="Please contact the admin."
    />
  )
}