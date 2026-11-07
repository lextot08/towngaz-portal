// The orders of one branch for a few days only (not every order it ever had), so the Daily Sales
// Log and Staff Home stay fast as the orders pile up over the months.
import { supabase } from './supabaseClient'
import { fetchAll } from './fetchAll'
import { dateString } from './dateUtils'

// midnight (local time) at the start of 'YYYY-MM-DD', and days later
export const dayStart = (ymd, addDays = 0) => {
  const d = new Date(`${ymd}T00:00:00`)
  d.setDate(d.getDate() + addDays)
  return d
}
export const addDays = (ymd, n) => dateString(dayStart(ymd, n))

// The orders of the branch accepted from `from` (included) to `to` (not included). With withOpen,
// also the website orders still waiting for Accept / Reject or out for delivery, from any day.
export async function loadBranchOrders(branch, from, to, withOpen = false) {
  const inRange = `and(accepted_at.gte."${from.toISOString()}",accepted_at.lt."${to.toISOString()}")`
  const filter = withOpen
    ? `${inRange},status.eq.pending,and(customer_id.not.is.null,delivery_status.eq.out_for_delivery)`
    : inRange
  return fetchAll(() =>
    supabase
      .from('orders')
      .select('*')
      .eq('branch', branch)
      .or(filter)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
  )
}
