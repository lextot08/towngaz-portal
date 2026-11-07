import { useState } from 'react'
import { branchName } from '../lib/branches'
import InventoryTable from './InventoryTable'
import SalesReport from './SalesReport'
import OverallSales from './OverallSales'
import DailySalesReport from './DailySalesReport'

const OVERALL = 0 // "Overall": the total of all branches (view only)
// The admin edits the Stock Inventory, the Daily Sales Log and the Daily Sales Report of Caloocan
// (the main branch) only.
const ADMIN_BRANCH = 1

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'

// the table area always has the same size, only its content changes
const PANEL =
  'h-[calc(100vh-260px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'

// branch comes from the sidebar (Branches opens "Overall" and the list of six branches)
// initialView: the view it opens on (the bell of the top bar opens the Daily Sales Log)
export default function BranchView({ branch, initialView = 'inventory' }) {
  const isOverall = branch === OVERALL
  const [view, setView] = useState(initialView) // inventory | report (the log) | dailyreport
  const [date, setDate] = useState('') // '' means today, shared by both views

  const currentView = view

  const viewButton = (name) =>
    currentView === name
      ? 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'
      : OUTLINE

  // left side of the top row: the branch name, then the views
  const headerLeft = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-2 text-xl font-bold text-brand-pine">
        {isOverall ? 'Overall' : branchName(branch)}
      </span>
      <button className={viewButton('inventory')} onClick={() => setView('inventory')}>
        Stock Inventory
      </button>
      <button className={viewButton('report')} onClick={() => setView('report')}>
        Daily Sales Log
      </button>
      <button className={viewButton('dailyreport')} onClick={() => setView('dailyreport')}>
        Daily Sales Report
      </button>
    </div>
  )

  if (currentView === 'dailyreport') {
    return (
      <DailySalesReport
        branch={isOverall ? null : branch}
        canEdit={branch === ADMIN_BRANCH}
        headerLeft={headerLeft}
        tableClass={PANEL}
      />
    )
  }

  if (isOverall && currentView === 'report') {
    return (
      <OverallSales
        headerLeft={headerLeft}
        date={date}
        onDateChange={setDate}
        tableClass={PANEL}
      />
    )
  }

  if (currentView === 'inventory') {
    return (
      <InventoryTable
        branch={branch}
        overall={isOverall}
        canEdit={branch === ADMIN_BRANCH}
        headerLeft={headerLeft}
        date={date}
        onDateChange={setDate}
        tableClass={PANEL}
      />
    )
  }

  return (
    <div>
      <SalesReport
        branch={branch}
        canEdit={branch === ADMIN_BRANCH}
        isAdmin
        headerLeft={headerLeft}
        showRefresh
        date={date}
        onDateChange={setDate}
        tableClass={PANEL}
      />
    </div>
  )
}