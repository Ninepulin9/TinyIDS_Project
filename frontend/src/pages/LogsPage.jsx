import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Filter, Search, ShieldAlert } from 'lucide-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'

import api from '../lib/api'
import { getSocket } from '../lib/socket'

dayjs.extend(relativeTime)

const severityStyles = {
  Low: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  Medium: 'bg-amber-100 text-amber-700 ring-amber-200',
  High: 'bg-rose-100 text-rose-700 ring-rose-200',
}

const statusStyles = {
  blocked: 'bg-rose-100 text-rose-700 ring-rose-200',
  allowed: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
}

const LOG_TIMEZONE = 'Asia/Bangkok'

const parseLocalTimestamp = (timestamp) => {
  if (typeof timestamp !== 'string') return null
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, year, month, day, hour, minute] = match
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  }
}

const formatLocalParts = (parts) => {
  if (!parts) return '--'
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0))
  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
  const timePart = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
  return `${datePart} @ ${timePart}`
}

const formatTimestamp = (timestamp) => {
  const localParts = parseLocalTimestamp(timestamp)
  if (localParts) return formatLocalParts(localParts)
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '--'
  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: LOG_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone: LOG_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return `${datePart} @ ${timePart}`
}

const formatTimestampForSearch = (timestamp) => {
  const localParts = parseLocalTimestamp(timestamp)
  if (localParts) return formatLocalParts(localParts)
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: LOG_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

const normalizeSeverity = (value) => {
  if (!value) return 'Low'
  const label = String(value).trim().toLowerCase()
  if (['info', 'informational', 'low', 'notice'].includes(label)) return 'Low'
  if (['medium', 'moderate', 'warn', 'warning'].includes(label)) return 'Medium'
  if (['high', 'critical', 'severe', 'error'].includes(label)) return 'High'
  return label ? label[0].toUpperCase() + label.slice(1) : 'Low'
}

const normalizeSocketLog = (data) => {
  if (!data || typeof data !== 'object') return null
  const payload = data.payload && typeof data.payload === 'object' ? data.payload : {}
  const id = data.id ?? payload.id
  if (id == null) return null
  return {
    id,
    device_id: data.device_id ?? payload.device_id,
    device_name: data.device ?? payload.device_name ?? payload.device ?? 'Unknown',
    severity: normalizeSeverity(data.severity ?? payload.severity ?? payload.level),
    source_ip:
      data.source_ip ??
      payload.source_ip ??
      payload['source ip'] ??
      payload['source-ip'],
    destination_ip:
      data.destination_ip ??
      payload.destination_ip ??
      payload['destination ip'] ??
      payload['destination-ip'],
    type: payload.type ?? payload.attack_type ?? payload.event_type ?? 'Unknown',
    alert_msg:
      payload.alert_msg ??
      data.alert_msg ??
      payload.message ??
      payload.summary ??
      payload.alert ??
      '',
    description:
      payload.description ??
      payload.detail ??
      payload.message ??
      payload.summary ??
      payload.alert_msg ??
      'No additional context provided.',
    timestamp:
      payload.timestamp ??
      payload.time ??
      data.created_at ??
      data.timestamp ??
      new Date().toISOString(),
    payload,
  }
}

const buildSignature = (log) => {
  const ts = log?.timestamp ? dayjs(log.timestamp).format('YYYY-MM-DD HH:mm:ss') : ''
  const device = log?.device_id ?? log?.device_name ?? ''
  const type = log?.type ?? ''
  const msg = log?.alert_msg ?? log?.description ?? ''
  const source = log?.source_ip ?? ''
  return [device, type, msg, source, ts].map((part) => String(part).trim()).join('|')
}

const mergeLogs = (incoming, existing) => {
  const combined = [...incoming, ...existing].filter(Boolean)
  const byId = new Map()
  const bySignature = new Set()
  for (const log of combined) {
    const signature = buildSignature(log)
    if (signature && bySignature.has(signature)) continue
    if (log?.id == null || byId.has(log.id)) {
      if (signature) bySignature.add(signature)
      continue
    }
    byId.set(log.id, log)
    if (signature) bySignature.add(signature)
  }
  return Array.from(byId.values())
    .sort((left, right) => dayjs(right.timestamp).valueOf() - dayjs(left.timestamp).valueOf())
    .slice(0, 200)
}

const LogsPage = () => {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tokenDeviceIds, setTokenDeviceIds] = useState(new Set())
  const [tokenValues, setTokenValues] = useState(new Set())
  const [tokenNameMap, setTokenNameMap] = useState(new Map())
  const [tokenIdMap, setTokenIdMap] = useState(new Map())
  const [deviceList, setDeviceList] = useState([])
  const [devicesLoaded, setDevicesLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [timeframeDays, setTimeframeDays] = useState(30)
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    try {
      return localStorage.getItem('tinyids:selectedDeviceId') || 'all'
    } catch {
      return 'all'
    }
  })
  const [blockedByDevice, setBlockedByDevice] = useState(new Map())
  const [blockStatusLoading, setBlockStatusLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [sortDesc, setSortDesc] = useState(true)
  const pageSize = 15
  const isMountedRef = useRef(false)
  const pollIntervalRef = useRef(null)
  const settingsRequestRef = useRef({ time: 0 })

  const dedupeDevices = useCallback((list) => {
    const byKey = new Map()
    list.forEach((device) => {
      const key =
        device?.esp_id ||
        device?.espId ||
        (device?.token ? `token:${device.token}` : null) ||
        device?.id
      if (!key) return
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, device)
        return
      }
      const existingSeen = existing?.last_seen ? Date.parse(existing.last_seen) : 0
      const nextSeen = device?.last_seen ? Date.parse(device.last_seen) : 0
      if (nextSeen >= existingSeen) {
        byKey.set(key, device)
      }
    })
    return Array.from(byKey.values())
  }, [])

  const normalizeBlockedList = (value) => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean)
    }
    if (value == null) return []
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const isValidIp = (value) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(value).trim())

  const loadBlockedFromSettings = useCallback(
    async (list = deviceList) => {
      if (!list.length) {
        setBlockedByDevice(new Map())
        return
      }

      try {
        const results = await Promise.allSettled(
          list.map((device) => api.get(`/api/devices/${device.id}/settings/latest`)),
        )

        if (!isMountedRef.current) return

        const nextMap = new Map()
        results.forEach((result, index) => {
          if (result.status !== 'fulfilled') return
          const payload = result.value?.data
          if (!payload || typeof payload !== 'object') return
          const blocked = payload.blocked_ips ?? payload.BLOCKED_IPS
          const ips = normalizeBlockedList(blocked)
            .filter((ip) => isValidIp(ip))
            .map((ip) => ip.toLowerCase())
          if (!ips.length) return
          const device = list[index]
          nextMap.set(String(device.id), new Set(ips))
        })

        setBlockedByDevice(nextMap)
      } catch {
        // ignore
      }
    },
    [deviceList],
  )

  const requestSettingsForDevices = useCallback(
    async (list = deviceList) => {
      if (!list.length) return
      const now = Date.now()
      if (now - settingsRequestRef.current.time < 5000) return
      settingsRequestRef.current.time = now
      await Promise.allSettled(
        list.map((device) =>
          device?.token
            ? api.post(`/api/devices/${device.id}/publish`, {
                topic_base: 'esp/setting/Control',
                message: `showsetting-${device.token}`,
                append_token: false,
              })
            : Promise.resolve(),
        ),
      )
    },
    [deviceList],
  )

  const refreshBlockedStatus = useCallback(
    async (list = deviceList) => {
      if (!list.length) return
      setBlockStatusLoading(true)
      await requestSettingsForDevices(list)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await loadBlockedFromSettings(list)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await loadBlockedFromSettings(list)
      if (isMountedRef.current) {
        setBlockStatusLoading(false)
      }
    },
    [deviceList, loadBlockedFromSettings, requestSettingsForDevices],
  )

  const fetchLatest = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true)
        setError('')
      }
      try {
        const { data } = await api.get('/api/logs')
        if (!isMountedRef.current) return
        const records = Array.isArray(data) ? data : []
        const normalized = records.map((record) => normalizeSocketLog(record)).filter(Boolean)
        setLogs((prev) => mergeLogs(normalized, prev))
      } catch (err) {
        if (!isMountedRef.current) return
        const message =
          err?.response?.data?.message ??
          err?.message ??
          'Unable to fetch intrusion logs right now. Please try again shortly.'
        setError(message)
        setLogs((prev) => mergeLogs([], prev))
      } finally {
        if (isMountedRef.current && !silent) {
          setLoading(false)
        }
      }
    },
    [],
  )

  const fetchDevices = useCallback(async () => {
    try {
      const { data } = await api.get('/api/devices')
      if (!isMountedRef.current) return
      const rawList = Array.isArray(data) ? data : []
      const list = dedupeDevices(rawList).filter((device) => device?.token)
      setDeviceList(list)
      const tokenDevices = list
      const ids = new Set(tokenDevices.map((device) => device.id))
      const tokens = new Set(tokenDevices.map((device) => String(device.token)))
      const nameMap = new Map(
        tokenDevices.map((device) => [String(device.token), device.device_name ?? device.name ?? 'ESP32']),
      )
      const idMap = new Map(tokenDevices.map((device) => [String(device.token), device.id]))
      setTokenDeviceIds(ids)
      setTokenValues(tokens)
      setTokenNameMap(nameMap)
      setTokenIdMap(idMap)
      setDevicesLoaded(true)
    } catch {
      if (!isMountedRef.current) return
      setDevicesLoaded(true)
    }
  }, [dedupeDevices])

  useEffect(() => {
    isMountedRef.current = true
    fetchLatest({ silent: false })
    fetchDevices()
    pollIntervalRef.current = setInterval(() => fetchLatest({ silent: true }).catch(() => {}), 15000)
    return () => {
      isMountedRef.current = false
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [fetchLatest])

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === 'tinyids:selectedDeviceId') {
        setSelectedDeviceId(event.newValue || 'all')
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    const socket = getSocket()

    const handleLogNew = (payload) => {
      const normalized = normalizeSocketLog(payload)
      if (!normalized) return
      setLogs((prev) => mergeLogs([normalized], prev))
      fetchLatest({ silent: true }).catch(() => {})
      const topic = String(normalized?.payload?._mqtt_topic ?? '').toLowerCase()
      if (topic === 'esp/setting/now') {
        const tokenValue = normalized?.payload?.token ? String(normalized.payload.token) : ''
        const deviceId = tokenValue ? tokenIdMap.get(tokenValue) : null
        const blocked = normalized?.payload?.blocked_ips ?? normalized?.payload?.BLOCKED_IPS
        const ips = normalizeBlockedList(blocked)
          .filter((ip) => isValidIp(ip))
          .map((ip) => ip.toLowerCase())
        if (deviceId && ips.length) {
          setBlockedByDevice((prev) => {
            const next = new Map(prev)
            next.set(String(deviceId), new Set(ips))
            return next
          })
          setBlockStatusLoading(false)
        }
      }
    }

    socket.on('log:new', handleLogNew)
    socket.on('device:registered', fetchDevices)
    return () => {
      socket.off('log:new', handleLogNew)
      socket.off('device:registered', fetchDevices)
    }
  }, [fetchDevices, tokenIdMap])

  useEffect(() => {
    if (!deviceList.length) return
    refreshBlockedStatus(deviceList).catch(() => {})
  }, [deviceList, refreshBlockedStatus])

  const resolveBlockedSet = useCallback(
    (logDeviceId) => {
      if (!blockedByDevice.size) return null
      if (selectedDeviceId !== 'all') {
        return blockedByDevice.get(String(selectedDeviceId)) ?? null
      }
      if (logDeviceId == null) return null
      return blockedByDevice.get(String(logDeviceId)) ?? null
    },
    [blockedByDevice, selectedDeviceId],
  )

  const timeFilteredLogs = useMemo(() => {
    const windowDays = Number(timeframeDays) || 30
    const cutoff = dayjs().subtract(windowDays, 'day')
    return logs.filter((log) => {
      const ts = dayjs(log.timestamp)
      const withinWindow = ts.isValid() ? ts.isAfter(cutoff) : true
      if (!withinWindow) return false
      const typeLabel = String(log.type ?? '').trim().toLowerCase()
      if (typeLabel === 'esp settings') return false
      if (!devicesLoaded || (tokenDeviceIds.size === 0 && tokenValues.size === 0)) return true
      if (tokenDeviceIds.has(log.device_id)) return true
      const payloadToken = log?.payload?.token ? String(log.payload.token) : ''
      return payloadToken ? tokenValues.has(payloadToken) : false
    })
  }, [logs, timeframeDays, devicesLoaded, tokenDeviceIds, tokenValues])

  const filteredLogs = useMemo(() => {
    const filteredByDevice =
      selectedDeviceId === 'all'
        ? timeFilteredLogs
        : timeFilteredLogs.filter((log) => {
            const directMatch = String(log.device_id ?? '') === String(selectedDeviceId)
            if (directMatch) return true
            const payloadToken = log?.payload?.token ? String(log.payload.token) : ''
            const mappedId = payloadToken ? tokenIdMap.get(payloadToken) : null
            return mappedId != null && String(mappedId) === String(selectedDeviceId)
          })

    if (!query.trim()) {
      return filteredByDevice
    }

    const lowerQuery = query.trim().toLowerCase()
    return filteredByDevice.filter((log) => {
      const haystack = [
        log.device_name,
        log.severity,
        log.type,
        log.description,
        log.source_ip,
        log.destination_ip,
        formatTimestampForSearch(log.timestamp),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(lowerQuery)
    })
  }, [timeFilteredLogs, query, selectedDeviceId, tokenIdMap])

  useEffect(() => {
    setPage(1)
  }, [query, timeframeDays, timeFilteredLogs.length, selectedDeviceId])

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const pageSafe = Math.min(page, totalPages)
  const pagedLogs = useMemo(() => {
    const ordered = [...filteredLogs].sort((left, right) => {
      const leftTime = dayjs(left.timestamp).valueOf()
      const rightTime = dayjs(right.timestamp).valueOf()
      return sortDesc ? rightTime - leftTime : leftTime - rightTime
    })
    const start = (pageSafe - 1) * pageSize
    return ordered.slice(start, start + pageSize)
  }, [filteredLogs, pageSafe, sortDesc])

  const chartData = useMemo(() => {
    const daysWindow = Number(timeframeDays) === 7 ? 7 : 30
    const today = dayjs().startOf('day')
    return Array.from({ length: daysWindow }, (_, index) => {
      const day = today.subtract(daysWindow - 1 - index, 'day')
      const count = timeFilteredLogs.reduce(
        (total, log) => (dayjs(log.timestamp).isSame(day, 'day') ? total + 1 : total),
        0,
      )
      return {
        label: day.format('ddd'),
        fullLabel: day.format('MMM D'),
        value: count,
      }
    })
  }, [timeFilteredLogs, timeframeDays])

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
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Last {Number(timeframeDays) === 7 ? '7' : '30'} Days
              </p>
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
                {timeFilteredLogs.filter((log) => log.severity === 'High').length}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
              <span>Unique Devices</span>
              <span className="text-base font-semibold text-sky-200">
                {[...new Set(timeFilteredLogs.map((log) => log.device_name))].length}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
              <span>Latest Event</span>
              <span className="text-base font-semibold text-emerald-200">
                {timeFilteredLogs.length ? dayjs(timeFilteredLogs[0].timestamp).fromNow() : '--'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Intrusion Log</h2>
          </div>
          <div className="flex w-full flex-wrap gap-3 sm:w-auto sm:flex-nowrap">
            <div className="flex gap-2">
              {[7, 30].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setTimeframeDays(days)}
                  className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                    timeframeDays === days
                      ? 'border-sky-500 bg-sky-50 text-sky-600'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  Last {days} days
                </button>
              ))}
            </div>
            <div className="relative">
              <select
                value={selectedDeviceId}
                onChange={(event) => {
                  const next = event.target.value
                  setSelectedDeviceId(next)
                  try {
                    localStorage.setItem('tinyids:selectedDeviceId', String(next))
                  } catch {
                    // ignore storage errors
                  }
                }}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
              >
                <option value="all">All devices</option>
                {deviceList.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.device_name ?? device.name ?? `Device ${device.id}`}
                  </option>
                ))}
              </select>
            </div>
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
              onClick={() => setSortDesc((prev) => !prev)}
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
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Alert Message</th>
                <th className="px-4 py-3 text-right">Alert IP</th>
                <th className="px-4 py-3 text-right">Block Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-4 py-6 text-center text-sm text-slate-500">
                    Loading intrusion logs...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="6" className="px-4 py-6 text-center text-sm text-rose-500">
                    {error}
                  </td>
                </tr>
              ) : pagedLogs.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-10 text-center text-sm text-slate-500">
                    No intrusion events match the current search.
                  </td>
                </tr>
              ) : (
                pagedLogs.map((log) => {
                  const ipKey = String(log.source_ip ?? '').trim().toLowerCase()
                  const deviceBlockedSet = resolveBlockedSet(log.device_id)
                  const isBlocked = ipKey && deviceBlockedSet ? deviceBlockedSet.has(ipKey) : false
                  const statusClass = isBlocked
                    ? statusStyles.blocked
                    : statusStyles.allowed ?? 'bg-slate-100 text-slate-600 ring-slate-200'
                  const showLoadingStatus = blockStatusLoading && !deviceBlockedSet
                  const typeLabel = String(log.type ?? '')
                  const isSettings = typeLabel.trim().toLowerCase() === 'esp settings'
                  const tokenValue = log?.payload?.token ? String(log.payload.token) : ''
                  const mappedName = tokenValue ? tokenNameMap.get(tokenValue) : null
                  const displayName = log.device_name === 'Unknown' && mappedName ? mappedName : log.device_name
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-medium text-slate-700">{formatTimestamp(log.timestamp)}</td>
                      <td className="px-4 py-3 text-slate-600">{displayName}</td>
                      <td className={`px-4 py-3 font-semibold ${isSettings ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {typeLabel || 'Unknown'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{log.alert_msg || '--'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-col items-end gap-1 text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">{log.source_ip || '--'}</span>
                          {isBlocked && (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusClass}`}
                            >
                              Listed
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                            isBlocked ? 'bg-rose-100 text-rose-700 ring-rose-200' : 'bg-slate-100 text-slate-600 ring-slate-200'
                          }`}
                        >
                          {showLoadingStatus ? 'Loading...' : isBlocked ? 'Blocked' : 'Not Blocked'}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {pageSafe} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={pageSafe <= 1}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={pageSafe >= totalPages}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

export default LogsPage
