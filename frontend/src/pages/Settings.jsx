import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import api from '../lib/api'
import Button from '../components/ui/Button.jsx'
import TimeframeSelector from '../components/settings/TimeframeSelector.jsx'
import Switch from '../components/ui/Switch.jsx'

const getErrorMessage = (error, fallbackMessage) =>
  error?.response?.data?.message ?? error?.message ?? fallbackMessage

const timeframeToMinutes = {
  seconds: 0,
  minutes: 1,
  hours: 60,
  days: 1440,
  months: 43200,
}

const timeframeOptions = [
  { value: 'seconds', label: 'Seconds' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
  { value: 'months', label: 'Months' },
]

const minutesToTimeframe = (value) => {
  const minutes = Number(value)
  if (Number.isNaN(minutes)) return 'days'
  if (minutes >= 43200) return 'months'
  if (minutes >= 1440) return 'days'
  if (minutes >= 60) return 'hours'
  if (minutes >= 1) return 'minutes'
  return 'seconds'
}

const formatTimeframeSummary = (timeframe) => {
  switch (timeframe) {
    case 'seconds':
      return 'Groups dashboard data at second-level detail for very short live views.'
    case 'minutes':
      return 'Groups dashboard data by minute for short-term monitoring.'
    case 'hours':
      return 'Groups dashboard data by hour for same-day operational monitoring.'
    case 'days':
      return 'Groups dashboard data by day for weekly and monthly trend review.'
    case 'months':
      return 'Groups dashboard data by month for long-term summaries.'
    default:
      return 'Groups dashboard data into a readable chart time unit.'
  }
}

const Settings = () => {
  const [systemSettings, setSystemSettings] = useState({
    log_retention_days: 30,
    attack_notifications: true,
    auto_block_enabled: true,
  })
  const [dashboardSettings, setDashboardSettings] = useState({
    graph_timeframe: 'days',
    widgets_visible: { traffic: true, alerts: true },
  })
  const [systemSaving, setSystemSaving] = useState(false)
  const [dashboardSaving, setDashboardSaving] = useState(false)
  const [systemLoaded, setSystemLoaded] = useState(false)
  const systemDirtyRef = useRef(false)
  const attackNotificationsEnabled = Boolean(systemSettings.attack_notifications)
  const autoBlockEnabled = Boolean(systemSettings.auto_block_enabled)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const [system, dashboard] = await Promise.all([
          api.get('/api/settings/system'),
          api.get('/api/dashboard-settings/me'),
        ])
        const { cooldown_seconds: _cooldown, ...systemData } = system?.data ?? {}
        if (!systemDirtyRef.current) {
          setSystemSettings((prev) => ({
            ...prev,
            ...systemData,
          }))
        }
        const dashboardData = dashboard?.data ?? {}
        const widgets = dashboardData.widgets ?? dashboardData.widgets_visible ?? {}
        const timeframe =
          dashboardData.graph_timeframe ??
          minutesToTimeframe(dashboardData.timeframe_minutes) ??
          'days'
        setDashboardSettings((prev) => ({
          ...prev,
          graph_timeframe: timeframe,
          widgets_visible: {
            traffic: widgets.data_pipeline_card ?? prev.widgets_visible.traffic,
            alerts: widgets.alerts_triggered ?? prev.widgets_visible.alerts,
          },
        }))
      } catch (error) {
        console.error('Unable to load system settings', error)
        toast.error(getErrorMessage(error, 'Unable to load settings. Please try again.'))
      } finally {
        setSystemLoaded(true)
      }
    }
    fetchSettings()
  }, [])

  const handleSystemSave = async (event) => {
    event.preventDefault()
    if (systemSaving) return
    setSystemSaving(true)
    try {
      const { data } = await api.put('/api/settings/system', systemSettings)
      const backfilledCount = Number(data?.backfilled_auto_block_count ?? 0)
      if (backfilledCount > 0 && autoBlockEnabled) {
        toast.success(`System settings saved. Retroactively blocked ${backfilledCount} IPs.`)
      } else {
        toast.success('System settings saved')
      }
      systemDirtyRef.current = false
      try {
        localStorage.setItem('tinyids_system_settings', JSON.stringify(systemSettings))
      } catch {
        // ignore storage errors
      }
      window.dispatchEvent(new CustomEvent('system:settings-updated', { detail: systemSettings }))
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
      const graphTimeframe = dashboardSettings.graph_timeframe ?? 'days'
      const payload = {
        timeframe_minutes: timeframeToMinutes[graphTimeframe] ?? timeframeToMinutes.days,
        graph_timeframe: graphTimeframe,
        widgets: {
          data_pipeline_card: Boolean(dashboardSettings.widgets_visible?.traffic),
          alerts_triggered: Boolean(dashboardSettings.widgets_visible?.alerts),
        },
      }
      await api.put('/api/dashboard-settings/me', payload)
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
          <label className="flex flex-col text-sm font-medium text-slate-700 md:col-span-2">
            Log Retention (days)
            <input
              type="number"
              value={systemSettings.log_retention_days ?? 0}
              onChange={(event) =>
                setSystemSettings((prev) => {
                  systemDirtyRef.current = true
                  return { ...prev, log_retention_days: Number(event.target.value) }
                })
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
                  setSystemSettings((prev) => {
                    systemDirtyRef.current = true
                    return { ...prev, attack_notifications: nextValue }
                  })
                }
                disabled={systemSaving || !systemLoaded}
                label="Enable Attack Notifications"
              />
            </div>
          </div>
          <div className="md:col-span-2 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-col text-slate-700">
              <span className="text-sm font-semibold">Enable Auto Block IP</span>
              <span className="text-xs text-slate-500">
                Automatically block alert IPs and push them to ESP settings.
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold ${autoBlockEnabled ? 'text-indigo-600' : 'text-slate-400'}`}>
                {autoBlockEnabled ? 'On' : 'Off'}
              </span>
              <Switch
                checked={autoBlockEnabled}
                onChange={(nextValue) =>
                  setSystemSettings((prev) => {
                    systemDirtyRef.current = true
                    return { ...prev, auto_block_enabled: nextValue }
                  })
                }
                disabled={systemSaving || !systemLoaded}
                label="Enable Auto Block IP"
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
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-slate-800">Chart Grouping</span>
              <span className="text-sm text-slate-500">
                Choose an easier time unit for charts instead of typing raw minutes.
              </span>
            </div>
            <div className="mt-4">
              <TimeframeSelector
                value={dashboardSettings.graph_timeframe}
                onChange={(nextValue) =>
                  setDashboardSettings((prev) => ({ ...prev, graph_timeframe: nextValue }))
                }
                options={timeframeOptions}
              />
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">
                Current setting: {timeframeOptions.find((option) => option.value === dashboardSettings.graph_timeframe)?.label ?? 'Days'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {formatTimeframeSummary(dashboardSettings.graph_timeframe)}
              </p>
            </div>
          </div>
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
