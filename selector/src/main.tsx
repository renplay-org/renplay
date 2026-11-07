import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import { Spinner, ToastProvider } from './components/ui'
import Library from './pages/Library'
import SignIn from './pages/SignIn'
import Setup from './pages/Setup'
import { AuthGuard } from './lib/auth'
import './index.css'
import { installGamepad } from './lib/gamepad'

const GamePage = lazy(() => import('./pages/GamePage'))
const Player = lazy(() => import('./pages/Player'))
const AddGames = lazy(() => import('./pages/AddGames'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Activity = lazy(() => import('./pages/Activity'))
const Settings = lazy(() => import('./pages/Settings'))
const Account = lazy(() => import('./pages/Account'))
const Users = lazy(() => import('./pages/Users'))
const History = lazy(() => import('./pages/History'))
const ImportSaves = lazy(() => import('./pages/ImportSaves'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } },
})

// renplay 1.x let Ren'Py register service workers (and their caches) under
// /play/<game>/. They are no longer used; remove them. Renplay's own (/sw.js) opens the library and
// kept games offline.
navigator.serviceWorker
  ?.getRegistrations?.()
  .then((regs) => regs.filter((r) => !r.active?.scriptURL.endsWith('/sw.js') && !r.installing && !r.waiting).forEach((r) => void r.unregister()))
  .then(() => navigator.serviceWorker.register('/sw.js', { scope: '/' }))
  .catch(() => {})
globalThis.caches
  ?.keys()
  .then((keys) => keys.filter((k) => !k.startsWith('renplay-')).forEach((k) => void caches.delete(k)))
  .catch(() => {})

const fallback = (
  <div className="flex h-[60vh] items-center justify-center">
    <Spinner />
  </div>
)

installGamepad()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={fallback}>
            <Routes>
              <Route path="/signin" element={<SignIn />} />
              <Route path="/setup" element={<Setup />} />
              <Route element={<AuthGuard />}>
              <Route path="/play/:id" element={<Player />} />
              <Route element={<AppShell />}>
                <Route path="/" element={<Library />} />
                <Route path="/catalog" element={<Catalog />} />
                <Route path="/game/:id" element={<GamePage />} />
                <Route element={<AuthGuard admin />}>
                  <Route path="/add" element={<AddGames />} />
                  <Route path="/activity" element={<Activity />} />
                  <Route path="/settings/users" element={<Users />} />
                </Route>
                <Route path="/settings" element={<Settings />} />
                <Route path="/account" element={<Account />} />
                <Route path="/history" element={<History />} />
                <Route path="/import-saves" element={<ImportSaves />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
