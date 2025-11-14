import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import useAuth from './hooks/useAuth.js'
import Dashboard from './pages/Dashboard.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Settings from './pages/Settings.jsx'
import LogsPage from './pages/LogsPage.jsx'
import ESPConfigPage from './pages/ESPConfigPage.jsx'
import DashboardSettingsPage from './pages/DashboardSettingsPage.jsx'
import UserSettingsPage from './pages/UserSettingsPage.jsx'
import BlacklistPage from './pages/BlacklistPage.jsx'
import RuleManagementPage from './pages/RuleManagementPage.jsx'

const App = () => {
  const auth = useAuth()

  return (
    <Routes>
      <Route path="/login" element={<Login loading={auth.loading} onSubmit={auth.login} />} />
      <Route path="/register" element={<Register loading={auth.loading} onSubmit={auth.register} />} />

      <Route
        element={
          <ProtectedRoute isAllowed={auth.isAuthenticated}>
            <Layout onLogout={auth.logout} user={auth.user} />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/blacklist" element={<BlacklistPage />} />
        <Route path="/devices" element={<ESPConfigPage />} />
        <Route path="/rules" element={<RuleManagementPage />} />
        <Route path="/dashboard-settings" element={<DashboardSettingsPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<UserSettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to={auth.isAuthenticated ? '/dashboard' : '/login'} replace />} />
    </Routes>
  )
}

export default App
