import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { TabletopPage } from '@/features/tabletop/TabletopPage'
import { DecksPage } from '@/features/decks/DecksPage'
import { BuilderPage } from '@/features/builder/BuilderPage'
import { CardsPage } from '@/features/cards/CardsPage'
import { StatsPage } from '@/features/stats/StatsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'

/** Vite `base` ends with `/` (e.g. `/commander-lab/` or `/`). */
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined

export function AppRouter() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<TabletopPage />} />
          <Route path="decks" element={<DecksPage />} />
          <Route path="builder" element={<BuilderPage />} />
          <Route path="cards" element={<CardsPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
