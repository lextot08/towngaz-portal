// The Remark column of the Daily Sales Report. A row can have several remarks at once.
//   Utang       = money lent (the customer pays later): not counted in the Gross Sale
//   Bayad Utang = that money was paid
//   Borrowed    = the customer kept the tank: listed in Borrowed, counted in the EMPTIES
//   Delivered   = the order was delivered
//   Thru Gcash  = paid through Gcash: not in the Gross Sale, in the Gcash column instead
export const REMARKS = [
  { key: 'utang', label: 'Utang', chip: 'bg-red-100 text-red-800' },
  { key: 'bayad_utang', label: 'Bayad Utang', chip: 'bg-green-100 text-green-800' },
  { key: 'borrowed', label: 'Borrowed', chip: 'bg-orange-100 text-orange-800' },
  { key: 'delivered', label: 'Delivered', chip: 'bg-blue-100 text-blue-800' },
  { key: 'gcash', label: 'Thru Gcash', chip: 'bg-violet-100 text-violet-800' },
]

// the remarks of an order
export const remarksOf = (o) =>
  [
    o.utang_status,
    o.borrowed_tank && 'borrowed',
    o.delivery_status === 'delivered' && 'delivered',
    o.paid_gcash && 'gcash',
  ].filter(Boolean)
