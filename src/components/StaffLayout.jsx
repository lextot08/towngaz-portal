import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { confirmDialog } from './Confirm'

// The top bar picture: blue-green band on top, then a white band and a red band
const NAVBAR_IMAGE = '/navbarcolor.jpg'
// How much of the picture (from the top) is the blue-green band. The logo stays inside it.
// If the logo touches the white stripe, make this number smaller.
const TEAL_PART = '66%'

const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  box: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  report: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  logout: 'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9',
  branches: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  trending: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  chevron: 'M6 9l6 6 6-6',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  idcard: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 16a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3',
  calendar: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
}

function Icon({ name, className = 'size-5' }) {
  return (
    <svg
      className={`${className} shrink-0`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

// expandable = the button opens a list of smaller buttons under it
const navClass = (active, expandable = false) =>
  `flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left font-medium text-white hover:opacity-100 ${
    active && !expandable ? 'bg-brand-red' : active ? 'bg-white/15' : 'bg-transparent hover:bg-white/15'
  }`

// the smaller buttons inside an opened list
const subClass = (active) =>
  `w-full rounded-lg px-4 py-2 text-left text-[15px] font-medium text-white hover:opacity-100 ${
    active ? 'bg-brand-red' : 'bg-transparent hover:bg-white/15'
  }`

// The bell on the right of the top bar: the website orders waiting for Accept / Reject
// (with a chat bubble "3 New Orders" next to it while orders are waiting)
function Bell({ count, onClick }) {
  const label = count > 0 ? `${count} website order${count === 1 ? '' : 's'} waiting` : 'No website orders waiting'
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {count > 0 && (
        <button
          type="button"
          className="relative rounded-xl bg-white px-3 py-1.5 text-[13px] leading-none font-bold whitespace-nowrap text-brand-red shadow-md hover:bg-brand-light max-[900px]:px-2 max-[900px]:py-1 max-[900px]:text-[11px]"
          onClick={onClick}
          aria-label={label}
        >
          {count > 99 ? '99+' : count} New Order{count === 1 ? '' : 's'}
          {/* the tail of the bubble, pointing at the bell */}
          <span
            className="absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 rotate-45 rounded-[2px] bg-inherit"
            aria-hidden="true"
          />
        </button>
      )}
    <button
      type="button"
      className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-white hover:bg-white/15 max-[900px]:size-9"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg className="size-6 max-[900px]:size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count > 0 && (
        <span
          className={`absolute -top-0.5 -right-0.5 box-border flex h-[18px] items-center justify-center rounded-full bg-brand-red text-[11px] leading-none font-bold text-white ring-2 ring-white ${
            count < 10 ? 'w-[18px] p-0' : 'min-w-[18px] px-1'
          }`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
    </div>
  )
}

// Top bar (the picture), sidebar on the left (menu, Log Out at the bottom), page on the right.
// An item can have subItems: they show under it while that item is the active one.
// bell = { count, onClick }: the bell on the right of the top bar (website orders waiting).
export default function StaffLayout({
  items,
  active,
  onSelect,
  activeChild,
  onSelectChild,
  bell,
  children,
}) {
  const [open, setOpen] = useState(false)

  const logout = async () => {
    if (await confirmDialog('Are you sure you want to log out?')) supabase.auth.signOut()
  }

  return (
    <div className="fixed inset-0 bg-white">
      {/* Top bar: the picture, with the logo inside the blue-green band */}
      <header
        className="fixed inset-x-0 top-0 z-40 box-border h-[88px] bg-no-repeat max-[900px]:h-14"
        style={{ backgroundImage: `url("${NAVBAR_IMAGE}")`, backgroundSize: '100% 100%' }}
      >
        <div
          className="box-border flex items-center gap-3 px-5 max-[900px]:px-3"
          style={{ height: TEAL_PART }}
        >
          <button
            className="hidden bg-transparent px-2.5 py-0.5 text-[22px] text-white max-[900px]:block"
            aria-label="Menu"
            onClick={() => setOpen(!open)}
          >
            ☰
          </button>
          <img className="block h-[80%] w-auto" src="/cjg-logo-bar.png" alt="CJG Joseph and Norie Trading" />
          {bell && <Bell count={bell.count} onClick={bell.onClick} />}
        </div>
      </header>

      {/* Under the top bar: sidebar and page */}
      <div className="fixed inset-x-0 top-[88px] bottom-0 flex max-[900px]:top-14">
        {open && (
          <div
            className="fixed inset-x-0 top-14 bottom-0 z-20 hidden bg-black/50 max-[900px]:block"
            onClick={() => setOpen(false)}
          />
        )}

        <aside
          className={`z-30 flex w-64 shrink-0 flex-col bg-brand-teal max-[900px]:fixed max-[900px]:top-14 max-[900px]:bottom-0 max-[900px]:left-0 max-[900px]:transition-transform max-[900px]:duration-250 ${
            open ? 'max-[900px]:translate-x-0' : 'max-[900px]:-translate-x-full'
          }`}
        >
          {/* still scrolls on short screens, but the scrollbar is hidden */}
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map((item) => {
              const hasSub = Boolean(item.subItems)
              const isActive = active === item.key
              return (
                <div key={item.key}>
                  <button
                    className={navClass(isActive, hasSub)}
                    onClick={() => {
                      onSelect(item.key)
                      if (!hasSub) setOpen(false) // keep the menu open so a branch can be picked
                    }}
                  >
                    <Icon name={item.icon} />
                    <span className="flex-1">{item.label}</span>
                    {hasSub && (
                      <Icon
                        name="chevron"
                        className={`size-4 transition-transform duration-300 ${
                          isActive ? 'rotate-180' : ''
                        }`}
                      />
                    )}
                  </button>

                  {hasSub && (
                    <div
                      className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                        isActive ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="grid gap-1 py-1 pl-6">
                          {item.subItems.map((sub) => (
                            <button
                              key={sub.key}
                              tabIndex={isActive ? 0 : -1}
                              className={subClass(isActive && activeChild === sub.key)}
                              onClick={() => {
                                onSelectChild(item.key, sub.key)
                                setOpen(false)
                              }}
                            >
                              {sub.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          <div className="border-t border-white/20 p-3">
            <button className={navClass(false)} onClick={logout}>
              <Icon name="logout" />
              Log Out
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-white p-6 text-left max-[900px]:px-4">
          {children}
        </main>
      </div>
    </div>
  )
}