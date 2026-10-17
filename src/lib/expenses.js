// The Expenses column of the Daily Sales Report is free text, for example "gas 70 others 30".
// Its value is the sum of the numbers in it: "gas 70 others 30" -> 100, "food 1,250.50" -> 1250.5
export const expenseOf = (text) => {
  const numbers =
    String(text || '')
      .replace(/(\d),(?=\d{3}(\D|$))/g, '$1') // 1,250 -> 1250
      .match(/\d+(\.\d+)?/g) || []
  return numbers.reduce((sum, n) => sum + Number(n), 0)
}

// The expenses of a list of orders. Orders added together (several sizes for one customer)
// share a group_id and the same Expenses text, so each group is counted once.
export const expensesOfOrders = (orders) => {
  const seen = new Set()
  return orders.reduce((sum, o) => {
    const key = o.group_id || `order-${o.id}`
    if (seen.has(key)) return sum
    seen.add(key)
    return sum + expenseOf(o.remarks)
  }, 0)
}
