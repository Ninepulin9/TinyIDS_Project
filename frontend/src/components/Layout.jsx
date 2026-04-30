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
      { to: '/devices', label: 'Device Register & Setting', icon: wifiIcon },
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
  '/devices': 'Device Register & Setting',
  '/blacklist': 'Network Blacklist',
  '/dashboard-settings': 'Preferences',
  '/settings': 'System Administration',
  '/users': 'Profile Settings',
  '/rules': 'Rule Configuration',
}

const normalizeAlertEvent = (incoming) => {
  if (!incoming || typeof incoming !== 'object') return null

  const payload = incoming.payload && typeof incoming.payload === 'object' ? incoming.payload : {}
  const topic = String(
    payload._mqtt_topic ??
      incoming._mqtt_topic ??
      payload.topic ??
      incoming.topic ??
      '',
  ).toLowerCase()
  const type = String(payload.type ?? incoming.type ?? '').trim()
  const message = String(
    payload.alert_msg ??
      incoming.alert_msg ??
      payload.message ??
      incoming.message ??
      payload.summary ??
      incoming.summary ??
      '',
  ).trim()
  const sourceIp = String(
    incoming.source_ip ??
      payload.source_ip ??
      payload['source ip'] ??
      payload['source-ip'] ??
      payload.alert_ip ??
      incoming.alert_ip ??
      payload.ip ??
      incoming.ip ??
      '',
  ).trim()
  const deviceName = String(
    incoming.device_name ??
      incoming.device ??
      payload.device_name ??
      payload.device ??
      '',
  ).trim()
  const severity = String(incoming.severity ?? payload.severity ?? '').trim().toLowerCase()
  const isSettingsEvent = topic.includes('esp/setting') || type.toLowerCase() === 'esp settings'
  const isAliveEvent = topic.includes('esp/alive')
  const looksLikeAlert =
    topic.includes('esp/alert') ||
    type.toLowerCase().includes('alert') ||
    Boolean(payload.alert_msg ?? incoming.alert_msg) ||
    (Boolean(message) && ['high', 'critical', 'severe', 'error'].includes(severity))

  if (!looksLikeAlert || isSettingsEvent || isAliveEvent) return null

  let title = type || 'Attack Alert'
  if (!title.toLowerCase().includes('alert')) {
    title = `${title} Alert`
  }

  return {
    id: incoming.id ?? payload.id ?? null,
    title,
    message: message || 'Intrusion detected',
    sourceIp,
    deviceName,
  }
}

const Layout = ({ onLogout, user }) => {
  const location = useLocation()
  const subtitle = routeSubtitles[location.pathname] ?? 'TinyIDS Platform'
  const [showConfirm, setShowConfirm] = useState(false)
  const [attackNotifyEnabled, setAttackNotifyEnabled] = useState(true)
  const [routeRefreshKey, setRouteRefreshKey] = useState(0)
  const lastToastRef = useRef({ key: '', at: 0 })
  const lastAlertIdRef = useRef(null)
  const alertsSeededRef = useRef(false)

  const emitAlertToast = (normalized) => {
    if (!attackNotifyEnabled) return
    if (!normalized) return
    const now = Date.now()
    const key = `${normalized.message}-${normalized.sourceIp ?? ''}-${normalized.deviceName ?? ''}`
    if (lastToastRef.current.key === key && now - lastToastRef.current.at < 3000) {
      return
    }
    lastToastRef.current = { key, at: now }
    toast.custom((t) => (
      <div
        className={`pointer-events-auto relative w-full max-w-[360px] overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-2xl ring-1 ring-slate-200/80 transition-all ${
          t.visible ? 'animate-enter' : 'animate-leave'
        }`}
      >
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-rose-500 via-orange-400 to-amber-300" />
        <div className="pl-5 pr-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-200">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d="M12 3.2 1.7 21.1c-.3.5.1 1.1.7 1.1h19.2c.6 0 1-.6.7-1.1L12 3.2z" />
                <rect x="11" y="9" width="2" height="7" rx="1" fill="#fff" />
                <rect x="11" y="17.5" width="2" height="2" rx="1" fill="#fff" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-500">
                    Attack Notification
                  </p>
                  <h4 className="mt-1 text-sm font-semibold leading-5 text-slate-900">
                    {normalized.title}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => toast.dismiss(t.id)}
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Dismiss alert"
                >
                  &times;
                </button>
              </div>
              <p className="mt-2 text-sm leading-5 text-slate-700">{normalized.message}</p>
              {(normalized.sourceIp || normalized.deviceName) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {normalized.sourceIp && (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                      IP {normalized.sourceIp}
                    </span>
                  )}
                  {normalized.deviceName && (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                      Device {normalized.deviceName}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    ), {
      id: key,
      duration: 5000,
    })
  }

  useEffect(() => {
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
      const normalized = normalizeAlertEvent(payload)
      if (!normalized) return
      const numericId = Number(normalized.id)
      if (Number.isFinite(numericId)) {
        if (lastAlertIdRef.current != null && numericId <= lastAlertIdRef.current) return
        lastAlertIdRef.current = Math.max(lastAlertIdRef.current ?? numericId, numericId)
      }
      alertsSeededRef.current = true
      emitAlertToast(normalized)
    }
    socket.on('log:new', handleLogNew)
    return () => {
      socket.off('log:new', handleLogNew)
    }
  }, [attackNotifyEnabled])

  useEffect(() => {
    if (!attackNotifyEnabled) return undefined

    let cancelled = false

    const syncLatestAlerts = async (seedOnly = false) => {
      try {
        const { data } = await api.get('/api/logs?limit=10')
        if (cancelled) return
        const alerts = (Array.isArray(data) ? data : [])
          .map((item) => normalizeAlertEvent(item))
          .filter(Boolean)
          .map((item) => ({ ...item, numericId: Number(item.id) }))
          .filter((item) => Number.isFinite(item.numericId))
          .sort((left, right) => left.numericId - right.numericId)

        if (!alerts.length) {
          if (!alertsSeededRef.current) {
            alertsSeededRef.current = true
          }
          return
        }

        if (seedOnly || !alertsSeededRef.current || lastAlertIdRef.current == null) {
          lastAlertIdRef.current = alerts[alerts.length - 1].numericId
          alertsSeededRef.current = true
          return
        }

        const unseen = alerts.filter((item) => item.numericId > lastAlertIdRef.current)
        if (!unseen.length) return

        for (const alert of unseen) {
          emitAlertToast(alert)
        }
        lastAlertIdRef.current = unseen[unseen.length - 1].numericId
      } catch {
        // ignore polling errors; socket remains primary
      }
    }

    syncLatestAlerts(true)
    const intervalId = window.setInterval(() => {
      syncLatestAlerts(false)
    }, 10000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [attackNotifyEnabled])

  return (
  <div className="flex min-h-screen bg-slate-100 text-slate-900">
    <aside className="hidden h-screen w-80 flex-shrink-0 flex-col overflow-y-auto bg-white shadow-xl lg:sticky lg:top-0 lg:flex xl:w-[21rem]">
      <div className="flex items-center justify-center bg-gradient-to-br from-sky-500 via-blue-500 to-blue-600 px-7 py-7">
        <Link to="/dashboard" className="text-[2rem] font-semibold tracking-wide text-white">
          TinyIDS
        </Link>
      </div>
      <div className="flex flex-1 flex-col gap-10 px-7 py-7">
        <div className="text-center">
          <div className="mx-auto flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-inner">
            <UserCircle2 className="h-14 w-14" />
          </div>
          <p className="mt-4 text-base font-semibold text-slate-800">{user?.username ?? 'User Name'}</p>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>

        <nav className="space-y-8">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="mb-3 text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-sky-500">
                {section.title}
              </p>
              <div className="space-y-1.5">
	                {section.items.map(({ to, label, icon: Icon, disabled }) =>
	                  to && !disabled ? (
	                    <NavLink
	                      key={label}
	                      to={to}
	                      onClick={(event) => {
	                        if (location.pathname === to) {
	                          event.preventDefault()
	                          setRouteRefreshKey((prev) => prev + 1)
	                        }
	                      }}
	                      className={({ isActive }) =>
	                        `flex items-center justify-between rounded-2xl px-4 py-2.5 text-[0.95rem] font-medium transition ${
	                          isActive
                            ? 'bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-400'
                            : 'text-slate-500 hover:bg-slate-100'
                        }`
                      }
                    >
                      <span className="flex items-center gap-3.5">
                        {typeof Icon === 'string' ? (
                          <img src={Icon} alt="" className="h-[1.125rem] w-[1.125rem] rounded-full object-cover" />
                        ) : (
                          <Icon className="h-[1.125rem] w-[1.125rem]" />
                        )}
                        {label}
                      </span>
                      <ChevronRight className="h-[1.125rem] w-[1.125rem] opacity-60" />
                    </NavLink>
                  ) : (
                    <div
                      key={label}
                      className="flex cursor-not-allowed items-center justify-between rounded-2xl px-4 py-2.5 text-[0.95rem] font-medium text-slate-300"
                    >
                      <span className="flex items-center gap-3.5">
                        {typeof Icon === 'string' ? (
                          <img src={Icon} alt="" className="h-[1.125rem] w-[1.125rem] rounded-full object-cover" />
                        ) : (
                          <Icon className="h-[1.125rem] w-[1.125rem]" />
                        )}
                        {label}
                      </span>
                      <ChevronRight className="h-[1.125rem] w-[1.125rem] opacity-40" />
                    </div>
                  )
                )}
              </div>
            </div>
          ))}
        </nav>
      </div>
      <div className="sticky bottom-0 z-10 mt-auto border-t border-slate-100 bg-white px-7 py-6">
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="w-full rounded-2xl bg-rose-500 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-rose-600"
        >
          Sign out
        </button>
      </div>
	    </aside>
	    <main className="flex-1 px-5 py-7 sm:px-10 lg:px-14 lg:py-11 xl:px-16">
	      <Outlet key={`${location.pathname}:${routeRefreshKey}`} />
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
