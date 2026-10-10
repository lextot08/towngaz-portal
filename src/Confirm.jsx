import { useEffect, useState } from 'react'

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
    <div
      className="fixed inset-0 z-[1000] box-border flex animate-[confirm-fade_0.2s_ease] items-center justify-center bg-black/50 p-4"
      onClick={() => answer(false)}
    >
      <div
        className="box-border w-full max-w-[380px] animate-[confirm-pop_0.2s_ease] rounded-2xl bg-white p-6 text-center shadow-2xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mt-0 mb-2 text-xl">Please confirm</h3>
        <p className="mt-0 mb-5">{dialog.message}</p>
        <div className="flex gap-2">
          <button
            className="flex-1 border border-[var(--border)] bg-white text-[var(--text)]"
            onClick={() => answer(false)}
          >
            Cancel
          </button>
          <button className="flex-1" autoFocus onClick={() => answer(true)}>Yes</button>
        </div>
      </div>
    </div>
  )
}