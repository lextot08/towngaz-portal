export const DEFAULT_LOW_LEVEL = 5

// Low stock level of each size, for example { '5kg': 5, '11kg': 5 }
export async function loadLowLevels(supabase) {
  const { data } = await supabase.from('lpg_prices').select('size, low_stock_level')
  return Object.fromEntries((data || []).map((p) => [p.size, p.low_stock_level]))
}

// Status of one stock row: 'Out of stock' | 'Low stock' | 'In stock'
export function stockStatus(itemName, quantity, levels) {
  const size = itemName.replace('LPG Cylinder ', '')
  const level = levels[size] ?? DEFAULT_LOW_LEVEL
  if (quantity === 0) return 'Out of stock'
  if (quantity <= level) return 'Low stock'
  return 'In stock'
}

export function statusColor(status) {
  if (status === 'Out of stock') return '#b91c1c'
  if (status === 'Low stock') return '#b45309'
  return '#166534'
}