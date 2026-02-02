import { useCallback, useEffect, useMemo, useState } from 'react'
import { Filter, Search } from 'lucide-react'
import toast from 'react-hot-toast'

import api from '../lib/api'
import { getSocket } from '../lib/socket'
import Button from '../components/ui/Button.jsx'

const formatTimestamp = (value) => {
  if (!value) return '--'
  try {
    const date = new Date(value)
    return `${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${date.getFullYear()}`
  } catch (err) {
    console.warn('Invalid timestamp received for blacklist entry', err)
    return value
  }
}

const BlacklistPage = () => {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage] = useState(1)
  const [devices, setDevices] = useState([])
  const [unblockTarget, setUnblockTarget] = useState(null)
  const pageSize = 15

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

  const loadBlacklist = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/api/blacklist')
      const baseEntries = Array.isArray(data) ? data : []
      let mergedEntries = [...baseEntries]

      try {
        const devicesResponse = await api.get('/api/devices')
        const deviceList = Array.isArray(devicesResponse.data) ? devicesResponse.data : []
        const tokenDevices = deviceList.filter((device) => device?.token)
        setDevices(deviceList)

        if (tokenDevices.length) {
          await Promise.allSettled(
            tokenDevices.map((device) =>
              api.post(`/api/devices/${device.id}/publish`, {
                topic_base: 'esp/setting/Control',
                message: `showsetting-${device.token}`,
                append_token: false,
              }),
            ),
          )
          await new Promise((resolve) => setTimeout(resolve, 600))

          const settingsResults = await Promise.allSettled(
            tokenDevices.map((device) => api.get(`/api/devices/${device.id}/settings/latest`)),
          )
          const seenIps = new Set(
            baseEntries.map((entry) => String(entry.ip_address ?? '').trim().toLowerCase()).filter(Boolean),
          )
          const settingsEntries = []

          settingsResults.forEach((result, idx) => {
            if (result.status !== 'fulfilled') return
            const payload = result.value?.data
            if (!payload || typeof payload !== 'object') return
            const blocked = payload.blocked_ips ?? payload.BLOCKED_IPS
            const ips = normalizeBlockedList(blocked)
            if (!ips.length) return
            const device = tokenDevices[idx]
            ips.forEach((ip) => {
              const key = ip.toLowerCase()
              if (seenIps.has(key)) return
              seenIps.add(key)
              settingsEntries.push({
                id: `settings-${device.id}-${key}`,
                device_id: device.id,
                device_name: device.device_name ?? device.name ?? 'ESP32',
                ip_address: ip,
                reason: 'ESP settings',
                created_at: payload.time ?? payload.timestamp ?? new Date().toISOString(),
                readOnly: true,
              })
            })
          })

          mergedEntries = [...baseEntries, ...settingsEntries]
        }
      } catch {
        // ignore settings fetch errors and show stored blacklist
      }

      setEntries(mergedEntries)
      setLastUpdated(new Date().toISOString())
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'ไม่สามารถโหลดข้อมูล Blacklist ได้ ใช้ข้อมูลตัวอย่างแทน'
      toast.error(message)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBlacklist()
  }, [loadBlacklist])

  useEffect(() => {
    const socket = getSocket()
    const handleLogNew = (payload) => {
      const data = payload?.payload ?? payload
      if (!data || typeof data !== 'object') return
      const topic = String(data._mqtt_topic ?? '').toLowerCase()
      if (topic === 'esp/setting/now') {
        loadBlacklist()
      }
    }
    socket.on('log:new', handleLogNew)
    return () => {
      socket.off('log:new', handleLogNew)
    }
  }, [loadBlacklist])

  const filteredEntries = useMemo(() => {
    if (!query.trim()) return entries
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      const haystack = `${entry.device_name ?? ''} ${entry.ip_address ?? ''}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [entries, query])

  useEffect(() => {
    setPage(1)
  }, [query, filteredEntries.length])

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize))
  const pageSafe = Math.min(page, totalPages)
  const pagedEntries = useMemo(() => {
    const start = (pageSafe - 1) * pageSize
    return filteredEntries.slice(start, start + pageSize)
  }, [filteredEntries, pageSafe])

  const handleDelete = async (id) => {
    if (!id) return
    setDeletingId(id)
    try {
      await api.delete(`/api/blacklist/${id}`)
      setEntries((prev) => prev.filter((entry) => entry.id !== id))
      toast.success('ลบรายการสำเร็จ')
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'ลบรายการไม่สำเร็จ จะซ่อนรายการจากมุมมองชั่วคราว'
      setEntries((prev) => prev.filter((entry) => entry.id !== id))
      toast.error(message)
    } finally {
      setDeletingId(null)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await loadBlacklist()
    } finally {
      setRefreshing(false)
    }
  }

  const handleUnblock = (entry) => {
    if (!entry?.device_id || !entry?.ip_address) return
    setUnblockTarget(entry)
  }

  const confirmUnblock = async () => {
    const entry = unblockTarget
    if (!entry?.device_id || !entry?.ip_address) return
    if (!entry?.device_id || !entry?.ip_address) return
    const device = devices.find((item) => item.id === entry.device_id)
    if (!device?.token) {
      toast.error('Device token not found. Unable to update ESP settings.')
      return
    }
    try {
      const { data } = await api.get(`/api/devices/${entry.device_id}/settings/latest`)
      const payload = data && typeof data === 'object' ? { ...data } : {}
      const blocked = payload.blocked_ips ?? payload.BLOCKED_IPS ?? []
      const blockedList = normalizeBlockedList(blocked)
      const nextBlocked = blockedList.filter(
        (ip) => String(ip).trim().toLowerCase() !== String(entry.ip_address).trim().toLowerCase(),
      )
      payload.blocked_ips = nextBlocked
      payload.token = payload.token ?? device.token
      await api.post(`/api/devices/${entry.device_id}/publish`, {
        topic_base: 'esp/setting/Control',
        payload,
        append_token: false,
      })
      setEntries((prev) => prev.filter((item) => item.id !== entry.id))
      toast.success('Unblocked IP and updated ESP settings')
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Unable to update ESP settings'
      toast.error(message)
    } finally {
      setUnblockTarget(null)
    }
  }

  const activeBlocks = filteredEntries.length
  const lastUpdatedLabel = lastUpdated ? new Date(lastUpdated).toLocaleString() : '--'

  return (
    <div className="space-y-6 text-slate-900" style={{ colorScheme: 'light' }}>
      <header className="rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-7 text-white shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">Blacklist</h1>
            <p className="mt-1 text-sm text-white/80">
              Manage blocked IP addresses for TinyIDS. Last update: {lastUpdatedLabel}
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur">
            Total blocked IPs:{' '}
            <span className="font-semibold text-white">{loading ? '--' : activeBlocks}</span>
          </div>
        </div>
      </header>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by IP address..."
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 transition focus:border-sky-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-sky-300 hover:text-sky-500"
              aria-label="Filter blacklist"
            >
              <Filter className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 shadow-sm">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">No blacklisted IPs found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-6 py-3">Time stamp</th>
                    <th className="px-6 py-3">Device</th>
                    <th className="px-6 py-3">IP Address</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/70">
                      <td className="px-6 py-3 text-slate-600">{formatTimestamp(entry.created_at)}</td>
                      <td className="px-6 py-3 font-medium text-slate-900">{entry.device_name ?? 'Unknown'}</td>
                      <td className="px-6 py-3 font-semibold text-slate-700">{entry.ip_address}</td>
                      <td className="px-6 py-3 text-right">
                        {entry.readOnly ? (
                          <button
                            type="button"
                            onClick={() => handleUnblock(entry)}
                            className="rounded-full border border-emerald-500 bg-white px-4 py-2 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-50 hover:text-emerald-700"
                          >
                            Unblock
                          </button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            className="rounded-full border border-rose-500 bg-white px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60"
                            disabled={deletingId === entry.id}
                            onClick={() => handleDelete(entry.id)}
                          >
                            {deletingId === entry.id ? 'Deleting...' : 'Delete'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {filteredEntries.length > 0 && (
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
        )}

        {unblockTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
              <h3 className="text-lg font-semibold text-slate-900">Unblock IP?</h3>
              <p className="mt-2 text-sm text-slate-600">
                This will remove{' '}
                <span className="font-semibold">{unblockTarget.ip_address}</span> from ESP settings.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setUnblockTarget(null)}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmUnblock}
                  className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600"
                >
                  Yes, unblock
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default BlacklistPage
