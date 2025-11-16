import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'

import api from '../lib/api'
import DeviceTable from '../components/DeviceTable.jsx'
import WifiModal from '../components/WifiModal.jsx'
import MqttModal from '../components/MqttModal.jsx'

const sampleDevices = [
  {
    id: 'demo-1',
    device_name: 'Lab Sensor A',
    status: 'Connected',
    last_seen: '2025-11-10T09:12:00Z',
    ip_address: '192.168.10.21',
    mac_address: 'AA:BB:CC:DD:EE:01',
    active: true,
    wifi: { ssid: 'TinyIDS-Lab' },
    mqtt: { broker: 'demo-broker', topic: 'tinyids/demo/lab' },
  },
  {
    id: 'demo-2',
    device_name: 'Warehouse ESP-7',
    status: 'Disconnected',
    last_seen: '2025-11-09T20:45:00Z',
    ip_address: '10.0.30.15',
    mac_address: 'AA:BB:CC:DD:EE:02',
    active: false,
    wifi: { ssid: 'TinyIDS-Warehouse' },
    mqtt: { broker: 'demo-broker', topic: 'tinyids/demo/warehouse' },
  },
  {
    id: 'demo-3',
    device_name: 'Perimeter Node 3',
    status: 'Connected',
    last_seen: '2025-11-10T08:30:00Z',
    ip_address: '172.16.0.45',
    mac_address: 'AA:BB:CC:DD:EE:03',
    active: true,
    wifi: { ssid: 'TinyIDS-Perimeter' },
    mqtt: { broker: 'demo-broker', topic: 'tinyids/demo/perimeter' },
  },
]

const isDemoDevice = (device) => String(device?.id ?? '').startsWith('demo-')

const ESPConfigPage = () => {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const [selectedWifiDevice, setSelectedWifiDevice] = useState(null)
  const [selectedMqttDevice, setSelectedMqttDevice] = useState(null)
  const [togglingId, setTogglingId] = useState(null)

  const fetchDevices = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/devices')
      const fetchedDevices = Array.isArray(data) ? data : []
      if (!fetchedDevices.length) {
        setDevices(sampleDevices)
      } else {
        setDevices(fetchedDevices)
      }
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to load devices right now. Showing demo data instead.'
      console.error('Unable to load devices', err)
      setDevices(sampleDevices)
      setError('')
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDevices()
  }, [fetchDevices])

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

    if (isDemoDevice(device)) {
      toast.success(`${device.device_name} ${nextActive ? 'activated' : 'deactivated'} (demo mode)`)
      setTogglingId(null)
      return
    }

    try {
      const { data } = await api.patch(`/api/devices/${device.id}/active`, { active: nextActive })
      if (data?.id) {
        updateDeviceState(data)
      }
      toast.success(
        `${device.device_name} ${nextActive ? 'activated' : 'deactivated'} successfully`,
      )
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to update device status. Reverting to previous value.'
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

  return (
    <div className="space-y-6 text-slate-900" style={{ colorScheme: 'light' }}>
      <header className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-6 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold sm:text-4xl">ESP Configuration</h1>
          <p className="mt-2 text-sm text-white/80">
            Manage Wi-Fi and MQTT credentials for every TinyIDS ESP32 sensor.
          </p>
        </div>
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
          togglingId={togglingId}
          withContainer={false}
        />
      </section>

      <WifiModal
        device={selectedWifiDevice}
        open={Boolean(selectedWifiDevice)}
        onClose={() => setSelectedWifiDevice(null)}
        onSaved={handleWifiSaved}
        isDemo={isDemoDevice(selectedWifiDevice)}
      />

      <MqttModal
        device={selectedMqttDevice}
        open={Boolean(selectedMqttDevice)}
        onClose={() => setSelectedMqttDevice(null)}
        onSaved={handleMqttSaved}
        isDemo={isDemoDevice(selectedMqttDevice)}
      />
    </div>
  )
}

export default ESPConfigPage
