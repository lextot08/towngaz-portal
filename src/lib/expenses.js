// The Expenses column of the Daily Sales Log is free text, for example "gas 70 others 30".
// Its value is the sum of the numbers in it: "gas 70 others 30" -> 100, "food 1,250.50" -> 1250.5
export const expenseOf = (text) => {
  const numbers =
    String(text || '')
      .replace(/(\d),(?=\d{3}(\D|$))/g, '$1') // 1,250 -> 1250
      .match(/\d+(\.\d+)?/g) || []
  return numbers.reduce((sum, n) => sum + Number(n), 0)
}

// The sum of a text column of a list of orders. Orders added together (several sizes for one
// customer) share a group_id and the same text, so each group is counted once.
const sumOfText = (orders, field) => {
  const seen = new Set()
  return orders.reduce((sum, o) => {
    const key = o.group_id || `order-${o.id}`
    if (seen.has(key)) return sum
    seen.add(key)
    return sum + expenseOf(o[field])
  }, 0)
}

// the expenses of a list of orders (the Expenses column)
export const expensesOfOrders = (orders) => sumOfText(orders, 'remarks')

// the Other Income of a list of orders (temporary column of the Daily Sales Log: extra money
// from another source, added to the Gross)
export const otherIncomeOfOrders = (orders) => sumOfText(orders, 'other_income')
