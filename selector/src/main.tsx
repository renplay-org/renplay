import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import { Spinner, ToastProvider } from './components/ui'
import Library from './pages/Library'
import './index.css'

const GamePage = lazy(() => import('./pages/GamePage'))
const Player = lazy(() => import('./pages/Player'))
const AddGames = lazy(() => import('./pages/AddGames'))
const Activity = lazy(() => import('./pages/Activity'))
const Settings = lazy(() => import('./pages/Settings'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } },
})

// Old builds registered Ren'Py service workers under /play/<game>/; they are no longer used.
navigator.serviceWorker?.getRegistrations?.().then((regs) => regs.forEach((r) => void r.unregister())).catch(() => {})

const fallback = (
  <div className="flex h-[60vh] items-center justify-center">
    <Spinner />
  </div>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={fallback}>
            <Routes>
              <Route path="/play/:slug" element={<Player />} />
              <Route element={<AppShell />}>
                <Route path="/" element={<Library />} />
                <Route path="/game/:slug" element={<GamePage />} />
                <Route path="/add" element={<AddGames />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
