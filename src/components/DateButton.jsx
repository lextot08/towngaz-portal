import { todayString } from '../lib/dateUtils'

const BUTTON =
  'relative flex cursor-pointer items-center gap-2 rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'

// "2026-10-15" -> "Oct 15, 2026"
const pretty = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// A button that shows the chosen date. The whole button opens the calendar,
// because an invisible date field covers all of it.
export default function DateButton({ value, onChange }) {
  return (
    <label className={BUTTON}>
      Date: <strong>{pretty(value)}</strong>
      <input
        type="date"
        className="absolute inset-0 m-0 h-full w-full cursor-pointer border-0 p-0 opacity-0"
        value={value}
        max={todayString()}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.currentTarget.showPicker?.()}
      />
    </label>
  )
}