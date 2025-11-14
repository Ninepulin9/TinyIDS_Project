import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import api from '../lib/api'
import Button from '../components/ui/Button.jsx'
import Switch from '../components/ui/Switch.jsx'

const getErrorMessage = (error, fallbackMessage) =>
  error?.response?.data?.message ?? error?.message ?? fallbackMessage

const Settings = () => {
  const [systemSettings, setSystemSettings] = useState({
    log_retention_days: 30,
    attack_notifications: true,
    cooldown_seconds: 60,
  })
  const [dashboardSettings, setDashboardSettings] = useState({
    timeframe_minutes: 60,
    widgets_visible: { traffic: true, alerts: true },
  })
  const [systemSaving, setSystemSaving] = useState(false)
  const [dashboardSaving, setDashboardSaving] = useState(false)
  const attackNotificationsEnabled = Boolean(systemSettings.attack_notifications)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const [system, dashboard] = await Promise.all([
          api.get('/api/settings/system'),
          api.get('/api/settings/dashboard'),
        ])
        setSystemSettings((prev) => ({
          ...prev,
          ...(system?.data ?? {}),
        }))
        setDashboardSettings((prev) => ({
          ...prev,
          ...(dashboard?.data ?? {}),
          widgets_visible: {
            ...prev.widgets_visible,
            ...(dashboard?.data?.widgets_visible ?? {}),
          },
        }))
      } catch (error) {
        console.error('Unable to load system settings', error)
        toast.error(getErrorMessage(error, 'Unable to load settings. Please try again.'))
      }
    }
    fetchSettings()
  }, [])

  const handleSystemSave = async (event) => {
    event.preventDefault()
    if (systemSaving) return
    setSystemSaving(true)
    try {
      await api.put('/api/settings/system', systemSettings)
      toast.success('System settings saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save system settings. Please try again.'))
    } finally {
      setSystemSaving(false)
    }
  }

  const handleDashboardSave = async (event) => {
    event.preventDefault()
    if (dashboardSaving) return
    setDashboardSaving(true)
    try {
      await api.put('/api/settings/dashboard', dashboardSettings)
      toast.success('Dashboard settings saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save dashboard settings. Please try again.'))
    } finally {
      setDashboardSaving(false)
    }
  }

  return (
    <div className="space-y-10 text-slate-900">
      <header className="rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
           
            <h1 className="mt-3 text-3xl font-semibold text-white">System Settings</h1>
            <p className="mt-1 text-sm text-white/80">
              Control retention, notification policies, and dashboard visibility across TinyIDS.
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md md:p-8">
        <h2 className="text-xl font-semibold text-slate-900">System Settings</h2>
        <form onSubmit={handleSystemSave} className="mt-6 grid gap-6 md:grid-cols-2">
          <label className="flex flex-col text-sm font-medium text-slate-700">
            Log Retention (days)
            <input
              type="number"
              value={systemSettings.log_retention_days ?? 0}
              onChange={(event) =>
                setSystemSettings((prev) => ({ ...prev, log_retention_days: Number(event.target.value) }))
              }
              className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <label className="flex flex-col text-sm font-medium text-slate-700">
            Cooldown (seconds)
            <input
              type="number"
              value={systemSettings.cooldown_seconds ?? 0}
              onChange={(event) =>
                setSystemSettings((prev) => ({ ...prev, cooldown_seconds: Number(event.target.value) }))
              }
              className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <div className="md:col-span-2 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-col text-slate-700">
              <span className="text-sm font-semibold">Enable Attack Notifications</span>
              <span className="text-xs text-slate-500">Receive alerts whenever suspicious activity is detected.</span>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-semibold ${
                  attackNotificationsEnabled ? 'text-indigo-600' : 'text-slate-400'
                }`}
              >
                {attackNotificationsEnabled ? 'On' : 'Off'}
              </span>
              <Switch
                checked={attackNotificationsEnabled}
                onChange={(nextValue) =>
                  setSystemSettings((prev) => ({ ...prev, attack_notifications: nextValue }))
                }
                disabled={systemSaving}
                label="Enable Attack Notifications"
              />
            </div>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={systemSaving}>
              {systemSaving ? 'Saving...' : 'Save System Settings'}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md md:p-8">
        <h2 className="text-xl font-semibold text-slate-900">Dashboard Settings</h2>
        <form onSubmit={handleDashboardSave} className="mt-6 space-y-4">
          <label className="flex flex-col text-sm font-medium text-slate-700">
            Timeframe (minutes)
            <input
              type="number"
              value={dashboardSettings.timeframe_minutes ?? 0}
              onChange={(event) =>
                setDashboardSettings((prev) => ({ ...prev, timeframe_minutes: Number(event.target.value) }))
              }
              className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(dashboardSettings.widgets_visible?.traffic)}
              onChange={(event) =>
                setDashboardSettings((prev) => ({
                  ...prev,
                  widgets_visible: { ...prev.widgets_visible, traffic: event.target.checked },
                }))
              }
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
            />
            Show Traffic Widget
          </label>
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(dashboardSettings.widgets_visible?.alerts)}
              onChange={(event) =>
                setDashboardSettings((prev) => ({
                  ...prev,
                  widgets_visible: { ...prev.widgets_visible, alerts: event.target.checked },
                }))
              }
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
            />
            Show Alerts Widget
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={dashboardSaving}>
              {dashboardSaving ? 'Saving...' : 'Save Dashboard Settings'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default Settings
