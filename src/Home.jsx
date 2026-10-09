import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Inventory from './Inventory'

export default function Home({ user }) {
  const [tab, setTab] = useState('home')
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('full_name, address, contact_number')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data))
  }, [user.id])

  const tabStyle = (name) => ({
    fontWeight: tab === name ? 'bold' : 'normal',
    marginRight: 8,
  })

  return (
    <div style={{ textAlign: 'center', marginTop: 40 }}>
      <nav style={{ marginBottom: 24 }}>
        <button style={tabStyle('home')} onClick={() => setTab('home')}>Home</button>
        <button style={tabStyle('inventory')} onClick={() => setTab('inventory')}>Inventory</button>
        <button onClick={async () => { if (await confirmDialog('Are you sure you want to log out?')) supabase.auth.signOut() }}>Log out</button>
      </nav>

      {tab === 'home' && (
        <div>
          <h1>Welcome to Towngaz{profile?.full_name ? `, ${profile.full_name}` : ''}!</h1>
          <p>Email: {user.email}</p>
          <p>Address: {profile?.address}</p>
          <p>Contact number: {profile?.contact_number}</p>
        </div>
      )}

      {tab === 'inventory' && <Inventory />}
    </div>
  )
}