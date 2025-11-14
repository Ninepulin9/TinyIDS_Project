import { useEffect, useMemo, useState } from 'react'
import { Filter, Search, ShieldAlert } from 'lucide-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import toast from 'react-hot-toast'

import api from '../lib/api'

dayjs.extend(relativeTime)

const severityStyles = {
  Low: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  Medium: 'bg-amber-100 text-amber-700 ring-amber-200',
  High: 'bg-rose-100 text-rose-700 ring-rose-200',
}

const formatTimestamp = (timestamp) => dayjs(timestamp).format('MMM D, YYYY @ HH:mm')

const fallbackLogs = [
  {
    id: 1,
    device_id: 10,
    device_name: 'Lab Sensor A',
    severity: 'High',
    source_ip: '192.168.1.120',
    destination_ip: '10.0.0.15',
    type: 'SYN Flood',
    description: 'Detected burst of SYN packets targeting the gateway.',
    timestamp: '2025-11-09T20:00:00Z',
  },
]

const LogsPage = () => {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [blockedSet, setBlockedSet] = useState(new Set())

  useEffect(() => {
    let isMounted = true

    const fetchLogs = async () => {
      try {
        setLoading(true)
        setError('')
        const { data } = await api.get('/api/logs')
        if (!isMounted) return
        const records = Array.isArray(data) && data.length ? data : fallbackLogs
        const sortedRecords = records
          .slice()
          .sort((left, right) => dayjs(right.timestamp).valueOf() - dayjs(left.timestamp).valueOf())
        setLogs(sortedRecords)
      } catch (err) {
        if (!isMounted) return
        const message =
          err?.response?.data?.message ??
          err?.message ??
          'Unable to fetch intrusion logs right now. Please try again shortly.'
        setError(message)
        setLogs(fallbackLogs)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchLogs()

    return () => {
      isMounted = false
    }
  }, [])

  const filteredLogs = useMemo(() => {
    if (!query.trim()) {
      return logs
    }

    const lowerQuery = query.trim().toLowerCase()
    return logs.filter((log) => {
      const haystack = [
        log.device_name,
        log.severity,
        log.type,
        log.description,
        dayjs(log.timestamp).format('MMM D YYYY HH:mm'),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(lowerQuery)
    })
  }, [logs, query])

  const chartData = useMemo(() => {
    const today = dayjs().startOf('day')
    return Array.from({ length: 7 }, (_, index) => {
      const day = today.subtract(6 - index, 'day')
      const count = logs.reduce((total, log) => (dayjs(log.timestamp).isSame(day, 'day') ? total + 1 : total), 0)
      return {
        label: day.format('ddd'),
        fullLabel: day.format('MMM D'),
        value: count,
      }
    })
  }, [logs])

  return (
    <div className="space-y-7 text-slate-900" style={{ colorScheme: 'light' }}>
      <header className="rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-7 text-white shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl text-white">Detected Attacks</h1>
            <p className="mt-1 text-sm text-white/80">
              Review TinyIDS intrusion alerts, filter by device or severity, and track attack velocity.
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur">
            Total alerts logged:{' '}
            <span className="font-semibold text-white">{loading ? '--' : filteredLogs.length}</span>
          </div>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-5">
        <div className="rounded-3xl bg-white p-6 shadow-sm lg:col-span-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Last 7 Days</p>
              <h2 className="text-xl font-semibold text-slate-900">Detected Attacks</h2>
            </div>
          </div>
          <div className="mt-6 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="4 4" className="stroke-slate-100" />
                <XAxis
                  dataKey="label"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0' }}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.fullLabel ?? label}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#38bdf8"
                  strokeWidth={3}
                  dot={{ stroke: '#0ea5e9', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-3xl bg-slate-900 p-6 text-white shadow-sm lg:col-span-2">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-10 w-10 text-sky-400" />
            <div>
              <p className="text-xs uppercase tracking-wide text-sky-400">Threat Summary</p>
              <h2 className="text-xl font-semibold text-white">Network Pulse</h2>
            </div>
          </div>
          <div className="mt-6 space-y-5 text-sm text-slate-200">
            <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
              <span>High Severity Events</span>
              <span className="text-base font-semibold text-rose-300">
                {logs.filter((log) => log.severity === 'High').length}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
              <span>Unique Devices</span>
              <span className="text-base font-semibold text-sky-200">
                {[...new Set(logs.map((log) => log.device_name))].length}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
              <span>Latest Event</span>
              <span className="text-base font-semibold text-emerald-200">
                {logs.length ? dayjs(logs[0].timestamp).fromNow() : '--'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Intrusion Log</h2>
            <p className="text-sm text-slate-500">Real-time stream of captured TinyIDS alerts.</p>
          </div>
          <div className="flex w-full gap-3 sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search logs by device, severity, type..."
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 transition focus:border-sky-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-100"
              />
            </div>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-sky-300 hover:text-sky-500"
              aria-label="Filter logs"
            >
              <Filter className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-100">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="5" className="px-4 py-6 text-center text-sm text-slate-500">
                    Loading intrusion logs...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="5" className="px-4 py-6 text-center text-sm text-rose-500">
                    {error}
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-4 py-10 text-center text-sm text-slate-500">
                    No intrusion events match the current search.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const severity = log.severity ?? 'Low'
                  const chipClass = severityStyles[severity] ?? 'bg-slate-100 text-slate-600 ring-slate-200'
                  const blockedKey = `${log.device_id}-${log.source_ip}`
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-medium text-slate-700">{formatTimestamp(log.timestamp)}</td>
                      <td className="px-4 py-3 text-slate-600">{log.device_name}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${chipClass}`}>
                          {severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{log.type}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className={`rounded-full border px-4 py-1 text-sm font-semibold transition ${
                            blockedSet.has(blockedKey)
                              ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                              : 'border-rose-500 text-rose-600 hover:bg-rose-50'
                          }`}
                          onClick={() => handleBlockIp(log)}
                          disabled={blockedSet.has(blockedKey)}
                        >
                          {blockedSet.has(blockedKey) ? 'Blocked' : 'Block IP'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default LogsPage
