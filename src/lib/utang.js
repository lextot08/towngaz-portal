// The Remark column of the Daily Sales Report.
// Utang orders are listed in Borrowed. A row can have several remarks at once.
export const UTANG_LABELS = {
  utang: 'Utang',
  bayad_utang: 'Bayad Utang',
}

// every remark, with its chip colours
export const REMARKS = [
  { key: 'utang', label: 'Utang', chip: 'bg-red-100 text-red-800' },
  { key: 'bayad_utang', label: 'Bayad Utang', chip: 'bg-green-100 text-green-800' },
  { key: 'delivered', label: 'Delivered', chip: 'bg-blue-100 text-blue-800' },
  { key: 'gcash', label: 'Thru Gcash', chip: 'bg-violet-100 text-violet-800' },
]

// the remarks of an order: its Utang / Bayad Utang, Delivered (delivery status), Thru Gcash
export const remarksOf = (o) =>
  [o.utang_status, o.delivery_status === 'delivered' && 'delivered', o.paid_gcash && 'gcash'].filter(Boolean)
