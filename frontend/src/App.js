import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DataCacheProvider } from './contexts/DataCacheContext'
import LeadsetsDashboard from './pages/LeadsetsDashboard'
import LeadsetDetail from './pages/LeadsetDetail'
import ErrorBoundary from './components/ErrorBoundary'
import './App.css'

function App() {
  return (
    <ErrorBoundary>
      <DataCacheProvider>
        <BrowserRouter>
          <div className="app-shell">
            <Routes>
              <Route path="/" element={<LeadsetsDashboard />} />
              <Route path="/leadsets/:leadsetId" element={<LeadsetDetail />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </BrowserRouter>
      </DataCacheProvider>
    </ErrorBoundary>
  )
}

export default App
