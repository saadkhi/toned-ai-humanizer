import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import PageNotFound from '@/lib/PageNotFound';
import ScrollToTop from '@/components/ScrollToTop';
import AppLayout from '@/components/AppLayout';
import Landing from '@/pages/Landing';
import Editor from '@/pages/Editor';
import History from '@/pages/History';
import Settings from '@/pages/Settings';
import Terms from '@/pages/Terms';
import Privacy from '@/pages/Privacy';

const Usage = lazy(() => import('@/pages/Usage'));

function App() {
  return (
      <ErrorBoundary>
        <Router>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Landing />} />
            {/* Preserve old bookmarks without presenting account flows. */}
            <Route path="/login" element={<Navigate to="/editor" replace />} />
            <Route path="/register" element={<Navigate to="/editor" replace />} />
            <Route path="/forgot-password" element={<Navigate to="/editor" replace />} />
            <Route path="/reset-password" element={<Navigate to="/editor" replace />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route element={<AppLayout />}>
              <Route path="/editor" element={<Editor />} />
              <Route path="/history" element={<History />} />
              <Route path="/usage" element={<Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading usage…</p>}><Usage /></Suspense>} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Router>
        <Toaster />
      </ErrorBoundary>
  );
}

export default App;
