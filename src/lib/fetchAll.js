// Supabase returns at most 1,000 rows per request. fetchAll loads every row in pages of 1,000, so a
// report never misses rows once a table grows past that.
//   const { data, error } = await fetchAll(() => supabase.from('orders').select('*').order('id'))
// makeQuery must build a NEW query each time it is called, and the query must have a stable order
// (end it with .order('id')), so that the pages neither skip nor repeat rows.
const PAGE = 1000

export async function fetchAll(makeQuery) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...data)
    if (data.length < PAGE) return { data: rows, error: null }
  }
}
