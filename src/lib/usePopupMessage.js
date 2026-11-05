import { useEffect } from 'react'
import { alertDialog } from '../components/Confirm'

// the messages that are good news or only information: they stay as text, without a pop-up
const NOT_PROBLEMS = ['Saved', 'Nothing was changed', 'Changes saved', 'Account deleted']
const NOT_PROBLEM_STARTS = ['Account created for ', 'Price of LPG Cylinder ']

const isProblem = (message) =>
  Boolean(message) &&
  !NOT_PROBLEMS.includes(message) &&
  !NOT_PROBLEM_STARTS.some((start) => message.startsWith(start))

// Shows a page's message as a pop-up (with OK) as soon as it appears, so the staff notice right
// away why something did not go through. The message also stays as text on the page.
export default function usePopupMessage(message) {
  useEffect(() => {
    if (isProblem(message)) alertDialog(message)
  }, [message])
}
