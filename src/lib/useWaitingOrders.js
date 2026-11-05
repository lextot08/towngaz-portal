import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// The website orders still waiting for Accept / Reject (for the bell of the top bar).
// branch = one branch (staff); no branch = every branch (admin). Updates by itself when an order
// is placed, accepted or rejected.
// Returns the waiting orders: [{ id, branch }]
export default function useWaitingOrders(branch) {
  const [waiting, setWaiting] = useState([])

  useEffect(() => {
    let alive = true
    const load = async () => {
      let query = supabase
        .from('orders')
        .select('id, branch')
        .eq('status', 'pending')
        .not('customer_id', 'is', null)
        .order('created_at')
      if (branch) query = query.eq('branch', branch)
      const { data, error } = await query
      if (alive && !error) setWaiting(data)
    }
    load()

    const channel = supabase
      .channel(`waiting-orders-${branch || 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', ...(branch ? { filter: `branch=eq.${branch}` } : {}) },
        () => load()
      )
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
  }, [branch])

  return waiting
}
