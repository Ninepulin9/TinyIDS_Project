import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'

import api from '../lib/api'
import { getSocket } from '../lib/socket'
import DeviceTable from '../components/DeviceTable.jsx'
import WifiModal from '../components/WifiModal.jsx'
import MqttModal from '../components/MqttModal.jsx'

const ESPConfigPage = () => {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const [selectedWifiDevice, setSelectedWifiDevice] = useState(null)
  const [selectedMqttDevice, setSelectedMqttDevice] = useState(null)
  const [togglingId, setTogglingId] = useState(null)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerMac, setRegisterMac] = useState('')
  const [registerToken, setRegisterToken] = useState('')
  const [registering, setRegistering] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [reregisterTarget, setReregisterTarget] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [aliveCheckAt, setAliveCheckAt] = useState(null)
  const pingIntervalRef = useRef(null)
  const initialPingRef = useRef(false)
  const lastAlivePingRef = useRef(0)
  const location = useLocation()

  const dedupeDevices = (list) => {
    const byKey = new Map()
    list.forEach((device) => {
      const key = device?.esp_id || device?.espId || device?.id
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
  }

  const sendAliveCheck = useCallback(async (list) => {
    const liveDevices = list.filter((d) => d?.id && d.token)
    if (!liveDevices.length) return
    const now = Date.now()
    if (now - lastAlivePingRef.current < 5000) return
    lastAlivePingRef.current = now
    const needsCheck = liveDevices.some((device) => !device?.last_seen)
    if (needsCheck) {
      setAliveCheckAt(now)
    }
    try {
      await Promise.all(
        liveDevices.map((device) =>
          api.post(`/api/devices/${device.id}/publish`, {
            topic_base: 'esp/Alive/Check',
            message: `Test-${device.token}`,
            append_token: false,
          }),
        ),
      )
    } catch (err) {
      console.warn('Ping devices failed', err)
    }
  }, [])

  const fetchDevices = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/devices')
      const fetchedDevices = Array.isArray(data) ? data : []
      const deduped = dedupeDevices(fetchedDevices)
      setDevices(deduped)
      sendAliveCheck(deduped)
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to load devices right now.'
      console.error('Unable to load devices', err)
      setDevices([])
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (location.pathname !== '/devices') return
    lastAlivePingRef.current = 0
    fetchDevices()
  }, [fetchDevices, location.pathname])

  useEffect(() => {
    const socket = getSocket()
    const handleRegistered = () => {
      fetchDevices()
    }
    const handleLogNew = (payload) => {
      const data = payload?.payload ?? payload
      if (!data || typeof data !== 'object') return
      const topic = String(data._mqtt_topic ?? '').toLowerCase()
      if (topic === 'esp/alive' || data.ip || data.ip_address || data.device_ip) {
        fetchDevices()
      }
    }
    const handleDeviceUpdated = () => {
      fetchDevices()
    }
    socket.on('device:registered', handleRegistered)
    socket.on('log:new', handleLogNew)
    socket.on('device:updated', handleDeviceUpdated)
    return () => {
      socket.off('device:registered', handleRegistered)
      socket.off('log:new', handleLogNew)
      socket.off('device:updated', handleDeviceUpdated)
    }
  }, [fetchDevices])

  const pingDevices = useCallback(async () => {
    await sendAliveCheck(devices)
  }, [devices, sendAliveCheck])

  useEffect(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
    const liveDevices = devices.filter((d) => d?.id && d.token)
    if (!liveDevices.length) return undefined
    pingIntervalRef.current = setInterval(() => {
      pingDevices()
      fetchDevices()
    }, 20000)
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
      }
    }
  }, [devices, pingDevices, fetchDevices])

  useEffect(() => {
    if (initialPingRef.current) return
    const liveDevices = devices.filter((d) => d?.id && d.token)
    if (!liveDevices.length) return
    initialPingRef.current = true
    const needsCheck = liveDevices.some((device) => !device?.last_seen)
    setAliveCheckAt(needsCheck ? Date.now() : null)
    pingDevices()
  }, [devices, pingDevices])

  const filteredDevices = useMemo(() => {
    const withToken = devices.filter((device) => device?.token)
    if (!query.trim()) return withToken
    const needle = query.trim().toLowerCase()
    return withToken.filter((device) => {
      const haystack = [device.device_name, device.ip_address, device.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [devices, query])

  const updateDeviceState = (updatedDevice) => {
    if (!updatedDevice?.id) return
    setDevices((prev) =>
      prev.map((device) => (device.id === updatedDevice.id ? { ...device, ...updatedDevice } : device)),
    )
  }

  const handleToggleActive = async (device) => {
    if (!device) return
    const nextActive = !device.active
    setTogglingId(device.id)

    setDevices((prev) => prev.map((item) => (item.id === device.id ? { ...item, active: nextActive } : item)))

    if (!device.token) {
      toast.error('This device has no token set; cannot send AlertOn/AlertOff.')
      setTogglingId(null)
      return
    }

    const message = nextActive ? `AlertOn-${device.token}` : `AlertOff-${device.token}`

    try {
      await api.post(`/api/devices/${device.id}/publish`, {
        topic_base: 'esp/alive/setting',
        message,
        append_token: false,
      })
      await api.patch(`/api/devices/${device.id}/active`, { active: nextActive })
      toast.success(`Sent ${message}`)
      setTimeout(() => {
        fetchDevices()
      }, 1500)
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to send AlertOn/AlertOff. Reverting toggle.'
      setDevices((prev) => prev.map((item) => (item.id === device.id ? { ...item, active: !nextActive } : item)))
      toast.error(message)
    } finally {
      setTogglingId(null)
    }
  }

  const handleWifiSaved = (payload) => {
    if (payload?.id) {
      updateDeviceState(payload)
    } else if (selectedWifiDevice) {
      updateDeviceState({ ...selectedWifiDevice, wifi: { ssid: payload?.wifi?.ssid } })
    }
  }

  const handleMqttSaved = (payload) => {
    if (payload?.id) {
      updateDeviceState(payload)
    } else if (selectedMqttDevice) {
      updateDeviceState({ ...selectedMqttDevice, mqtt: payload?.mqtt })
    }
  }

  const handleDeleteDevice = (device) => {
    if (!device?.id) return
    setDeleteTarget(device)
  }

  const confirmDeleteDevice = async () => {
    const device = deleteTarget
    if (!device?.id) return
    setDeletingId(device.id)
    try {
      await api.delete(`/api/devices/${device.id}`)
      setDevices((prev) => prev.filter((item) => item.id !== device.id))
      toast.success('Device deleted')
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to delete device. Please try again.'
      toast.error(message)
    } finally {
      setDeletingId(null)
      setDeleteTarget(null)
    }
  }

  const handleReregisterDevice = async (device) => {
    if (!device?.id) return
    setReregisterTarget(device)
  }

  const handleRenameDevice = async (device) => {
    if (!device?.id) return
    setRenameTarget(device)
    setRenameValue(device.device_name ?? device.name ?? '')
  }

  const confirmRenameDevice = async () => {
    const device = renameTarget
    if (!device?.id) return
    const trimmed = renameValue.trim()
    if (!trimmed) {
      toast.error('Device name is required.')
      return
    }
    try {
      const { data } = await api.patch(`/api/devices/${device.id}`, { device_name: trimmed })
      setDevices((prev) => prev.map((item) => (item.id === device.id ? { ...item, ...data } : item)))
      toast.success('Device name updated')
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to update device name. Please try again.'
      toast.error(message)
    } finally {
      setRenameTarget(null)
      setRenameValue('')
    }
  }

  const confirmReregisterDevice = async () => {
    const device = reregisterTarget
    if (!device?.id) return
    try {
      await api.post(`/api/devices/${device.id}/reregister`)
      toast.success('Device marked for re-registration')
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to re-register device. Please try again.'
      toast.error(message)
    } finally {
      setReregisterTarget(null)
    }
  }

  const handleRegisterSubmit = async () => {
    const mac = registerMac.trim()
    const token = registerToken.trim()
    if (!mac || !token) {
      toast.error('MAC address and token are required.')
      return
    }
    setRegistering(true)
    try {
      await api.post('/api/devices/discover', {
        mac_address: mac,
        token,
      })
      toast.success('Sent register request.')
      setRegisterOpen(false)
      setRegisterMac('')
      setRegisterToken('')
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to register device. Please try again.'
      toast.error(message)
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div className="space-y-6 text-slate-900" style={{ colorScheme: 'light' }}>
      <header className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-6 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold sm:text-4xl">ESP Configuration</h1>
          <p className="mt-2 text-sm text-white/80">
            Manage Wi-Fi and MQTT credentials for every TinyIDS ESP32 sensor.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRegisterOpen(true)}
          className="inline-flex items-center justify-center rounded-full bg-white/15 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/25"
        >
          REGISTER
        </button>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md">
        <DeviceTable
          devices={filteredDevices}
          loading={loading}
          error={error}
          onRetry={fetchDevices}
          query={query}
          onQueryChange={setQuery}
          onEditWifi={setSelectedWifiDevice}
          onEditMqtt={setSelectedMqttDevice}
          onToggleActive={handleToggleActive}
          onDelete={handleDeleteDevice}
          onReregister={handleReregisterDevice}
          onRename={handleRenameDevice}
          togglingId={togglingId}
          aliveCheckAt={aliveCheckAt}
          withContainer={false}
        />
      </section>

      <WifiModal
        device={selectedWifiDevice}
        open={Boolean(selectedWifiDevice)}
        onClose={() => setSelectedWifiDevice(null)}
        onSaved={handleWifiSaved}
        isDemo={false}
      />

      <MqttModal
        device={selectedMqttDevice}
        open={Boolean(selectedMqttDevice)}
        onClose={() => setSelectedMqttDevice(null)}
        onSaved={handleMqttSaved}
        isDemo={false}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Delete device?</h3>
            <p className="mt-2 text-sm text-slate-600">
              This will remove{' '}
              <span className="font-semibold">{deleteTarget.device_name ?? deleteTarget.name ?? deleteTarget.id}</span>
              .
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteDevice}
                disabled={deletingId === deleteTarget.id}
                className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {deletingId === deleteTarget.id ? 'Deleting...' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Rename device</h3>
            <p className="mt-2 text-sm text-slate-600">
              Update name for{' '}
              <span className="font-semibold">{renameTarget.device_name ?? renameTarget.name ?? renameTarget.id}</span>
              .
            </p>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
              placeholder="Device name"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setRenameTarget(null)
                  setRenameValue('')
                }}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRenameDevice}
                className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {reregisterTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Re-register device?</h3>
            <p className="mt-2 text-sm text-slate-600">
              This will reset token for{' '}
              <span className="font-semibold">{reregisterTarget.device_name ?? reregisterTarget.name ?? reregisterTarget.id}</span>
              .
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setReregisterTarget(null)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReregisterDevice}
                className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600"
              >
                Yes, re-register
              </button>
            </div>
          </div>
        </div>
      )}

      {registerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Register ESP32</h3>
            <p className="mt-2 text-sm text-slate-600">Enter MAC address and token from the ESP.</p>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={registerMac}
                onChange={(e) => setRegisterMac(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                placeholder="MAC address (e.g., 8C:AA:B5:94:5F:24)"
              />
              <input
                type="text"
                value={registerToken}
                onChange={(e) => setRegisterToken(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                placeholder="Token"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setRegisterOpen(false)
                  setRegisterMac('')
                  setRegisterToken('')
                }}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRegisterSubmit}
                disabled={registering}
                className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {registering ? 'Registering...' : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ESPConfigPage
