import { Outlet } from 'react-router-dom'
import { AppHeader } from '@/components/AppHeader'

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      <AppHeader />
      <main className="flex-1 pb-10">
        <Outlet />
      </main>
      <footer className="border-t border-slate-900 py-3 text-center text-[11px] text-slate-600">
        Commander Lab · Play = Phase Engine · Legacy Table = sandbox · PWA-ready
      </footer>
    </div>
  )
}
