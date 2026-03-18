import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronRight, GaugeCircle, ListChecks, Shield, SlidersHorizontal, UserCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import wifiIcon from '../assets/wi-fi-icon.png'
import profileIcon from '../assets/profile.png'
import controlIcon from '../assets/control.png'
import dashboardIcon from '../assets/dashboard.png'
import rule from '../assets/find.png'
import api from '../lib/api'
import { getSocket } from '../lib/socket'
const sections = [
  {
    title: 'Navigation',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: GaugeCircle },
      { to: '/logs', label: 'Logs', icon: ListChecks },
      { to: '/blacklist', label: 'Blacklist', icon: Shield },
    ],
  },
  {
    title: 'System Config',
    items: [
      { to: '/devices', label: 'ESP Config', icon: wifiIcon },
      { to: '/rules', label: 'Rule Management', icon: rule },
    ],
  },
  {
    title: 'Settings',
    items: [
      // { to: '/dashboard-settings', label: 'Dashboard Settings', icon: dashboardIcon },
      { to: '/settings', label: 'System Settings', icon: controlIcon },
      { to: '/users', label: 'User Settings', icon: profileIcon },
    ],
  },
]

const routeSubtitles = {
  '/dashboard': 'Main Dashboard',
  '/logs': 'Threat Monitoring',
  '/devices': 'Device Operations',
  '/blacklist': 'Network Blacklist',
  '/dashboard-settings': 'Preferences',
  '/settings': 'System Administration',
  '/users': 'Profile Settings',
  '/rules': 'Rule Configuration',
}

const Layout = ({ onLogout, user }) => {
  const location = useLocation()
  const subtitle = routeSubtitles[location.pathname] ?? 'TinyIDS Platform'
  const [showConfirm, setShowConfirm] = useState(false)
  const [attackNotifyEnabled, setAttackNotifyEnabled] = useState(true)
  const lastToastRef = useRef({ key: '', at: 0 })
  const lastAlertIdRef = useRef(null)

  const emitAlertToast = (incoming) => {
    if (!attackNotifyEnabled) return
    if (!incoming || typeof incoming !== 'object') return

    const payload =
      incoming?.payload && typeof incoming.payload === 'object'
        ? incoming.payload
        : incoming

    const topic = String(
      payload?._mqtt_topic ??
        incoming?.payload?._mqtt_topic ??
        incoming?._mqtt_topic ??
        payload?.topic ??
        incoming?.topic ??
        '',
    ).toLowerCase()

    if (topic && !topic.includes('esp/alert')) return
    const typeLabel = String(payload.type ?? incoming?.type ?? '').toLowerCase()
    if (typeLabel === 'esp settings') return
    if (!typeLabel && !payload.alert_msg && !payload.message && !incoming?.alert_msg) return

    const message =
      payload.alert_msg ||
      incoming?.alert_msg ||
      payload.message ||
      incoming?.message ||
      payload.type ||
      incoming?.type ||
      'Intrusion detected'
    const sourceIp =
      payload.source_ip ||
      incoming?.source_ip ||
      payload.alert_ip ||
      incoming?.alert_ip ||
      payload.ip ||
      incoming?.ip
    const deviceName =
      payload.device_name ||
      incoming?.device_name ||
      payload.device ||
      incoming?.device
    let title = payload.type || incoming?.type || 'Alert'
    if (!String(title).toLowerCase().includes('alert')) {
      title = `${title} Alert`
    }
    const details = `${message}${sourceIp ? ` (${sourceIp})` : ''}${deviceName ? ` - ${deviceName}` : ''}`
    const toastTitle = title
    const toastDetails = details
    const now = Date.now()
    const key = `${message}-${sourceIp ?? ''}-${deviceName ?? ''}`
    if (lastToastRef.current.key === key && now - lastToastRef.current.at < 3000) {
      return
    }
    lastToastRef.current = { key, at: now }
    toast.custom(
      (t) => (
        <div
          className={`w-full max-w-sm rounded-xl bg-white px-4 py-3 text-slate-900 shadow-xl ring-1 ring-slate-200 ${
            t.visible ? 'animate-enter' : 'animate-leave'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <span className="inline-flex h-5 w-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 text-amber-500"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 3.2 1.7 21.1c-.3.5.1 1.1.7 1.1h19.2c.6 0 1-.6.7-1.1L12 3.2z" />
                <rect x="11" y="9" width="2" height="7" rx="1" fill="#fff" />
                <rect x="11" y="17.5" width="2" height="2" rx="1" fill="#fff" />
              </svg>
            </span>
            <span>{toastTitle}</span>
          </div>
          <div className="mt-1 text-xs text-slate-800">{toastDetails}</div>
        </div>
      ),
      { duration: 4000 },
    )
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem('tinyids_system_settings')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (typeof parsed?.attack_notifications === 'boolean') {
          setAttackNotifyEnabled(parsed.attack_notifications)
        }
      }
    } catch {
      // ignore storage errors
    }
    const loadSettings = async () => {
      try {
        const { data } = await api.get('/api/settings/system')
        if (typeof data?.attack_notifications === 'boolean') {
          setAttackNotifyEnabled(data.attack_notifications)
        }
      } catch {
        // ignore fetch errors
      }
    }
    loadSettings()
  }, [])

  useEffect(() => {
    const handleSettingsUpdated = (event) => {
      const next = event?.detail
      if (typeof next?.attack_notifications === 'boolean') {
        setAttackNotifyEnabled(next.attack_notifications)
      }
    }
    window.addEventListener('system:settings-updated', handleSettingsUpdated)
    return () => window.removeEventListener('system:settings-updated', handleSettingsUpdated)
  }, [])

  useEffect(() => {
    const socket = getSocket()
    const handleLogNew = (payload) => {
      const id = payload?.id ?? payload?.payload?.id
      if (id != null && lastAlertIdRef.current === id) return
      if (id != null) lastAlertIdRef.current = id
      emitAlertToast(payload)
    }
    socket.on('log:new', handleLogNew)
    return () => {
      socket.off('log:new', handleLogNew)
    }
  }, [attackNotifyEnabled])

  useEffect(() => {
    let timer = null
    const pollLatest = async () => {
      if (!attackNotifyEnabled) return
      try {
        const { data } = await api.get('/api/logs', { params: { limit: 1 } })
        const latest = Array.isArray(data) ? data[0] : null
        if (!latest) return
        if (lastAlertIdRef.current === latest.id) return
        lastAlertIdRef.current = latest.id
        emitAlertToast(latest)
      } catch {
        // ignore polling errors
      }
    }
    pollLatest()
    timer = setInterval(pollLatest, 5000)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [attackNotifyEnabled])

  return (
  <div className="flex min-h-screen bg-slate-100 text-slate-900">
    <aside className="hidden h-screen w-72 flex-shrink-0 flex-col overflow-y-auto bg-white shadow-xl lg:sticky lg:top-0 lg:flex">
      <div className="flex items-center justify-center bg-gradient-to-br from-sky-500 via-blue-500 to-blue-600 px-6 py-6">
        <Link to="/dashboard" className="text-2xl font-semibold tracking-wide text-white">
          TinyIDS
        </Link>
      </div>
      <div className="flex flex-1 flex-col gap-8 px-6 py-6">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-inner">
            <UserCircle2 className="h-12 w-12" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-800">{user?.username ?? 'User Name'}</p>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>

        <nav className="space-y-7">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-sky-500">
                {section.title}
              </p>
              <div className="space-y-1">
                {section.items.map(({ to, label, icon: Icon, disabled }) =>
                  to && !disabled ? (
                    <NavLink
                      key={label}
                      to={to}
                      className={({ isActive }) =>
                        `flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition ${
                          isActive
                            ? 'bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-400'
                            : 'text-slate-500 hover:bg-slate-100'
                        }`
                      }
                    >
                      <span className="flex items-center gap-3">
                        {typeof Icon === 'string' ? (
                          <img src={Icon} alt="" className="h-4 w-4 rounded-full object-cover" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                        {label}
                      </span>
                      <ChevronRight className="h-4 w-4 opacity-60" />
                    </NavLink>
                  ) : (
                    <div
                      key={label}
                      className="flex cursor-not-allowed items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-slate-300"
                    >
                      <span className="flex items-center gap-3">
                        {typeof Icon === 'string' ? (
                          <img src={Icon} alt="" className="h-4 w-4 rounded-full object-cover" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                        {label}
                      </span>
                      <ChevronRight className="h-4 w-4 opacity-40" />
                    </div>
                  )
                )}
              </div>
            </div>
          ))}
        </nav>
      </div>
      <div className="sticky bottom-0 z-10 mt-auto border-t border-slate-100 bg-white px-6 py-5">
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="w-full rounded-xl bg-rose-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-600"
        >
          Sign out
        </button>
      </div>
    </aside>
    <main className="flex-1 px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
      <Outlet />
    </main>

    {showConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
          <h3 className="text-lg font-semibold text-slate-900">Sign out?</h3>
          <p className="mt-2 text-sm text-slate-600">You will be logged out of TinyIDS.</p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConfirm(false)
                onLogout?.()
              }}
              className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-600"
            >
              Yes, sign out
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
)}

export default Layout
