// Helpers of the Monthly Sales Report (Sales per Branch and the other pages).

// the price of one order before its discount: quantity x unit price. (The database's
// total_price already has the discount taken off, so it is not used here.)
export const fullPriceOf = (o) => Number(o.quantity || 0) * Number(o.unit_price || 0)
// the amount of one order after its discount, like the Daily Sales Log
export const amountOf = (o) => fullPriceOf(o) - Number(o.discount || 0)
// Utang = money lent: not paid yet, so it is a collectible and not in the Gross Sale
export const isUtang = (o) => o.utang_status === 'utang'
// paid through Gcash (Remark "Thru Gcash"), and not an Utang
export const isGcash = (o) => o.paid_gcash && !isUtang(o)
// the orders in the Gross Sale: not Utang and not paid through Gcash
export const isGross = (o) => !isUtang(o) && !o.paid_gcash
export const sumAmount = (list) => list.reduce((sum, o) => sum + amountOf(o), 0)

// "2.7kg" -> 2.7 (kilograms of LPG in one cylinder)
export const kgOfSize = (size) => Number.parseFloat(size) || 0

// cylinders of one size in a list of orders
export const soldOf = (list, size) =>
  list
    .filter((o) => o.item_name === 'LPG Cylinder ' + size)
    .reduce((sum, o) => sum + Number(o.quantity || 0), 0)

// kg of LPG in a list of orders
export const kgOfOrders = (list, sizes) =>
  sizes.reduce((sum, s) => sum + soldOf(list, s) * kgOfSize(s), 0)

// the typed numbers of a month, as { "branch:key": amount } (branch 0 = whole company)
export const entryOf = (entries, branch, key) => entries[`${branch}:${key}`] ?? null
