import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const [discovering, setDiscovering] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const pingIntervalRef = useRef(null)

  const fetchDevices = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/devices')
      const fetchedDevices = Array.isArray(data) ? data : []
      setDevices(fetchedDevices)
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
    fetchDevices()
  }, [fetchDevices])

  useEffect(() => {
    const socket = getSocket()
    const handleRegistered = () => {
      fetchDevices()
    }
    socket.on('device:registered', handleRegistered)
    return () => {
      socket.off('device:registered', handleRegistered)
    }
  }, [fetchDevices])

  const pingDevices = useCallback(async () => {
    const liveDevices = devices.filter((d) => d?.id && d.token)
    if (!liveDevices.length) return
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
  }, [devices])

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
    }, 30000)
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
      }
    }
  }, [devices, pingDevices, fetchDevices])

  const filteredDevices = useMemo(() => {
    if (!query.trim()) return devices
    const needle = query.trim().toLowerCase()
    return devices.filter((device) => {
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

  const handleDeleteDevice = async (device) => {
    if (!device?.id) return
    const confirmDelete = window.confirm(`Delete device ${device.device_name ?? device.name ?? device.id}?`)
    if (!confirmDelete) return
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
    }
  }

  const handleDiscover = async () => {
    setDiscovering(true)
    try {
      const { data } = await api.post('/api/devices/discover', { nonce_length: 8 })
      toast.success(`Sent DISCOVER (${data?.nonce ?? 'ok'})`)
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to send DISCOVER. Please try again.'
      toast.error(message)
    } finally {
      setDiscovering(false)
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
          onClick={handleDiscover}
          disabled={discovering}
          className="inline-flex items-center justify-center rounded-full bg-white/15 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {discovering ? 'Discovering...' : 'DISCOVER'}
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
          togglingId={togglingId}
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
    </div>
  )
}

export default ESPConfigPage
