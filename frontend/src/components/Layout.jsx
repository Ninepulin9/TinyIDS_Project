import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronRight, GaugeCircle, ListChecks, Shield, UserCircle2, X } from 'lucide-react'
import wifiIcon from '../assets/wi-fi-icon.png'
import profileIcon from '../assets/profile.png'
import controlIcon from '../assets/control.png'
import rule from '../assets/find.png'
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
  const handleLogout = () => setShowConfirm(true)
  const confirmLogout = () => {
    setShowConfirm(false)
    onLogout?.()
  }
  const cancelLogout = () => setShowConfirm(false)

  return (
  <div className="flex min-h-screen bg-slate-100 text-slate-900">
    <aside className="hidden w-72 flex-shrink-0 flex-col bg-white shadow-xl lg:flex">
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
          onClick={handleLogout}
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-indigo-50 p-6 shadow-2xl ring-1 ring-indigo-100">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-indigo-800">Confirm logout</h2>
              <hr className="mt-2 border-indigo-200" />
              <p className="mt-3 text-sm text-indigo-900">Are you sure you want to log out?</p>
            </div>
            <button
              type="button"
              onClick={cancelLogout}
              className="rounded-full p-1 text-indigo-300 transition hover:bg-indigo-100 hover:text-indigo-500"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={cancelLogout}
              className="rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmLogout}
              className="rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-600"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
)}

export default Layout
