import { useEffect, useState } from 'react'
import './Confirm.css'

let openDialog = null

// Use it like this:  if (await confirmDialog('Are you sure ...?')) { ... }
export function confirmDialog(message) {
  return new Promise((resolve) => {
    if (openDialog) openDialog(message, resolve)
    else resolve(window.confirm(message)) // safety net if the dialog is not on the page
  })
}

export default function ConfirmDialog() {
  const [dialog, setDialog] = useState(null)

  useEffect(() => {
    openDialog = (message, resolve) => setDialog({ message, resolve })
    return () => {
      openDialog = null
    }
  }, [])

  // press Esc to cancel
  useEffect(() => {
    if (!dialog) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        dialog.resolve(false)
        setDialog(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])

  if (!dialog) return null

  const answer = (result) => {
    dialog.resolve(result)
    setDialog(null)
  }

  return (
    <div className="confirm-backdrop" onClick={() => answer(false)}>
      <div
        className="confirm-box"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="confirm-title">Please confirm</h3>
        <p className="confirm-message">{dialog.message}</p>
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={() => answer(false)}>Cancel</button>
          <button autoFocus onClick={() => answer(true)}>Yes</button>
        </div>
      </div>
    </div>
  )
}