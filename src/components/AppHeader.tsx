import { NavLink } from 'react-router-dom'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-2.5 py-1.5 text-xs font-medium transition sm:px-3 sm:text-sm',
    isActive
      ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
      : 'text-slate-300 hover:bg-slate-800 hover:text-white',
  ].join(' ')

const playLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-2.5 py-1.5 text-xs font-semibold transition sm:px-3 sm:text-sm',
    isActive
      ? 'bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-400/50'
      : 'bg-cyan-700/80 text-white hover:bg-cyan-600',
  ].join(' ')

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/90 text-xs font-bold text-white shadow-lg shadow-emerald-900/40 sm:h-9 sm:w-9 sm:text-sm">
            CL
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-wide text-white">
              Commander Lab
            </p>
            <p className="hidden text-xs text-slate-400 sm:block">
              Phase Engine play · Legacy Table sandbox
            </p>
          </div>
        </div>
        <nav className="flex max-w-[75%] flex-wrap items-center justify-end gap-0.5 sm:gap-1">
          <NavLink to="/engine" className={playLinkClass} title="Phase rules engine — real play path">
            Play
          </NavLink>
          <NavLink to="/" end className={linkClass} title="Legacy zone sandbox (not Phase rules)">
            Legacy
          </NavLink>
          <NavLink to="/decks" className={linkClass}>
            Decks
          </NavLink>
          <NavLink to="/builder" className={linkClass}>
            Builder
          </NavLink>
          <NavLink to="/cards" className={linkClass}>
            Cards
          </NavLink>
          <NavLink to="/stats" className={linkClass}>
            Stats
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            Settings
          </NavLink>
        </nav>
      </div>
    </header>
  )
}
