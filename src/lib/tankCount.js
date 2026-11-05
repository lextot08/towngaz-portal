// Tanks Count (draft), at the end of a day (nothing in the Stock Inventory is changed):
//   REVOLVING F = the FILLED Actual Count of the Stock Inventory (its Ending on a day not counted yet)
//   REVOLVING E = the EMPTIES Actual Count of the Stock Inventory
//   BORROWED  E = the empties still owed by customers who bought a filled tank without giving
//                 an empty (Remark "Borrowed" minus the returned ones); its F is always empty
// Used by the Tanks Count page and the Tanks Count tiles of the home pages.
import { supabase } from './supabaseClient'
import { BRANCHES } from './branches'
import { borrowedOf } from './utang'

// the Truck has no borrowed tanks (it is not a store)
export const BORROWED_BRANCHES = BRANCHES.filter((b) => b.name !== 'Truck')

// The numbers of the branches on day 'YYYY-MM-DD': { counts, error }, where counts is
// { "revolving|borrowed:branch:size:f|e": number }. ownBranch = one branch only (staff).
export async function loadTankCounts(day, branchIds, ownBranch) {
  // the day, from midnight to midnight (local time), like the Stock Inventory
  const from = new Date(`${day}T00:00:00`)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)

  const [filled, empties] = await Promise.all([
    Promise.all(
      branchIds.map((id) =>
        supabase.rpc('inventory_report', {
          p_branch: id,
          p_from: from.toISOString(),
          p_to: to.toISOString(),
        })
      )
    ),
    Promise.all(branchIds.map((id) => supabase.rpc('empties_report', { p_branch: id, p_day: day }))),
  ])

  // borrowed tanks given out until the end of the day, and the ones returned by then
  let ordersQuery = supabase
    .from('orders')
    .select('id, branch, item_name, quantity, borrowed_tank, borrowed_qty')
    .eq('borrowed_tank', true)
    .eq('status', 'accepted')
    .lt('accepted_at', to.toISOString())
  let returnsQuery = supabase
    .from('tank_returns')
    .select('order_id, quantity')
    .lt('returned_at', to.toISOString())
  if (ownBranch) {
    ordersQuery = ordersQuery.eq('branch', ownBranch)
    returnsQuery = returnsQuery.eq('branch', ownBranch)
  }
  const [ordersResult, returnsResult] = await Promise.all([ordersQuery, returnsQuery])

  const failed = [...filled, ...empties, ordersResult, returnsResult].find((x) => x.error)

  const counts = {}
  branchIds.forEach((id, i) => {
    for (const r of filled[i].data || []) counts[`revolving:${id}:${r.size}:f`] = r.actual ?? r.ending
    for (const r of empties[i].data || []) counts[`revolving:${id}:${r.size}:e`] = r.actual
  })
  for (const o of ordersResult.data || []) {
    const back = (returnsResult.data || [])
      .filter((t) => t.order_id === o.id)
      .reduce((sum, t) => sum + t.quantity, 0)
    const out = Math.max(borrowedOf(o) - back, 0)
    const key = `borrowed:${o.branch}:${o.item_name.replace('LPG Cylinder ', '')}:e`
    counts[key] = (counts[key] || 0) + out
  }
  return { counts, error: failed?.error || null }
}

// The totals of the home tiles, like the Overall Total of the Tanks Count page:
// { revolving, borrowed, total }
export function tankTotals(counts) {
  const sumOf = (table, ids) =>
    Object.entries(counts)
      .filter(([key]) => key.startsWith(`${table}:`) && ids.includes(Number(key.split(':')[1])))
      .reduce((sum, [, n]) => sum + (Number(n) || 0), 0)
  const revolving = sumOf('revolving', BRANCHES.map((b) => b.id))
  const borrowed = sumOf('borrowed', BORROWED_BRANCHES.map((b) => b.id))
  return { revolving, borrowed, total: revolving + borrowed }
}
