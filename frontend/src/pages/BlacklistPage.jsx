import { useCallback, useEffect, useMemo, useState } from 'react'
import { Filter, ShieldAlert, Search } from 'lucide-react'
import toast from 'react-hot-toast'

import api from '../lib/api'
import Button from '../components/ui/Button.jsx'

const sampleBlacklist = [
  {
    id: 1,
    device_name: 'Lab Sensor A',
    ip_address: '192.168.1.120',
    reason: 'SYN flood detected',
    created_at: '2025-11-09T20:35:00Z',
  },
  {
    id: 2,
    device_name: 'Device 2',
    ip_address: '203.0.113.195',
    reason: 'Repeated suspicious packets',
    created_at: '2025-11-09T18:25:00Z',
  },
  {
    id: 3,
    device_name: 'Perimeter Node 3',
    ip_address: '192.168.1.150',
    reason: 'Unauthorized access attempt',
    created_at: '2025-11-08T10:05:00Z',
  },
]

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

  const loadBlacklist = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/api/blacklist')
      if (Array.isArray(data) && data.length) {
        setEntries(data)
      } else {
        setEntries(sampleBlacklist)
      }
      setLastUpdated(new Date().toISOString())
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'ไม่สามารถโหลดข้อมูล Blacklist ได้ ใช้ข้อมูลตัวอย่างแทน'
      toast.error(message)
      setEntries(sampleBlacklist)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBlacklist()
  }, [loadBlacklist])

  const filteredEntries = useMemo(() => {
    if (!query.trim()) return entries
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      const haystack = `${entry.device_name ?? ''} ${entry.ip_address ?? ''}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [entries, query])

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

  const activeBlocks = filteredEntries.length
  const lastUpdatedLabel = lastUpdated ? new Date(lastUpdated).toLocaleString() : '—'

  return (
    <div className="space-y-6 text-slate-900" style={{ colorScheme: 'light' }}>
      <header className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">Blacklist</h1>
            <p className="text-sm text-white/80">Manage blocked IP addresses .</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-white shadow-inner backdrop-blur">
              <ShieldAlert className="h-8 w-8 text-rose-200" />
              <div>
                <p className="text-xs uppercase tracking-wide text-white/70">Active Blocks</p>
                <p className="text-2xl font-semibold">{activeBlocks}</p>
              </div>
            </div>
            <div className="rounded-2xl bg-white/15 px-4 py-3 text-sm text-white shadow-inner backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-white/70">Last Update</p>
              <p className="text-lg font-semibold">{lastUpdatedLabel}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by IP address..."
              className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-3 text-sm text-slate-700 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
            >
              <Filter className="h-4 w-4" />
              Filters
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
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
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/70">
                      <td className="px-6 py-3 text-slate-600">{formatTimestamp(entry.created_at)}</td>
                      <td className="px-6 py-3 font-medium text-slate-900">{entry.device_name ?? 'Unknown'}</td>
                      <td className="px-6 py-3 text-slate-700">{entry.ip_address}</td>
                      <td className="px-6 py-3 text-slate-600">{entry.reason ?? '—'}</td>
                      <td className="px-6 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        className="rounded-full border border-rose-500 bg-white px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60"
                        disabled={deletingId === entry.id}
                        onClick={() => handleDelete(entry.id)}
                      >
                        {deletingId === entry.id ? 'Deleting…' : 'Delete'}
                      </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default BlacklistPage
