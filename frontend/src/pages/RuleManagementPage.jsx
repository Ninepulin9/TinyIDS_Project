import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Settings, X } from 'lucide-react'
import toast from 'react-hot-toast'

import api from '../api/axios'

const defaultRuleState = {
  rate_limit_ppm: '',
  mac_address: '',
  mqtt_topics: '',
  ssid: '',
  max_packet_size: '',
  rssi_threshold: '',
  enabled: false,
}

const Spinner = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-slate-500">
    <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
    {label && <p>{label}</p>}
  </div>
)

const sampleDevices = [
  { id: 101, name: 'Lab Sensor A', status: 'online', ip_address: '192.168.10.21' },
  { id: 102, name: 'Warehouse ESP-7', status: 'offline', ip_address: '10.0.30.15' },
  { id: 103, name: 'Perimeter Node 3', status: 'online', ip_address: '172.16.0.45' },
]

const sampleRules = {
  101: {
    rate_limit_ppm: 45,
    mac_address: 'AA:BB:CC:DD:EE:AA',
    mqtt_topics: ['esp32/lab', 'esp32/alerts'],
    ssid: 'TinyIDS-Lab',
    max_packet_size: 2048,
    rssi_threshold: -70,
    enabled: true,
  },
  102: {
    rate_limit_ppm: 20,
    mac_address: 'AA:BB:CC:DD:EE:BB',
    mqtt_topics: ['warehouse/packets'],
    ssid: 'TinyIDS-Warehouse',
    max_packet_size: 1024,
    rssi_threshold: -75,
    enabled: false,
  },
  fallback: {
    rate_limit_ppm: 30,
    mac_address: 'AA:BB:CC:DD:EE:FF',
    mqtt_topics: ['esp32/sensor', 'esp32/alerts'],
    ssid: 'TinyIDS-Network',
    max_packet_size: 2048,
    rssi_threshold: -72,
    enabled: true,
  },
}

const RuleManagementPage = () => {
  const [devices, setDevices] = useState([])
  const [loadingDevices, setLoadingDevices] = useState(true)
  const [devicesError, setDevicesError] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [ruleValues, setRuleValues] = useState(defaultRuleState)
  const [ruleErrors, setRuleErrors] = useState({})
  const [loadingRules, setLoadingRules] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true)
    setDevicesError('')
    try {
      const { data } = await api.get('/api/devices')
      setDevices(Array.isArray(data) ? data : [])
      if (!Array.isArray(data) || data.length === 0) {
        setDevices(sampleDevices)
      }
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Unable to load devices. Showing sample data.'
      setDevicesError(message)
      setDevices(sampleDevices)
      toast(message, { icon: 'ℹ️' })
    } finally {
      setLoadingDevices(false)
    }
  }, [])

  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  const openDrawer = async (device) => {
    setSelectedDevice(device)
    setRuleErrors({})
    setDrawerOpen(true)
    setLoadingRules(true)
    try {
      const { data } = await api.get(`/api/device-rules/${device.id}`)
      setRuleValues({
        rate_limit_ppm: data?.rate_limit_ppm ?? '',
        mac_address: data?.mac_address ?? '',
        mqtt_topics: (data?.mqtt_topics ?? []).join(', '),
        ssid: data?.ssid ?? '',
        max_packet_size: data?.max_packet_size ?? '',
        rssi_threshold: data?.rssi_threshold ?? '',
        enabled: Boolean(data?.enabled),
      })
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Unable to load rules for this device. Showing sample data.'
      const sample = sampleRules[device.id] ?? sampleRules.fallback
      setRuleValues({
        rate_limit_ppm: sample.rate_limit_ppm,
        mac_address: sample.mac_address,
        mqtt_topics: sample.mqtt_topics.join(', '),
        ssid: sample.ssid,
        max_packet_size: sample.max_packet_size,
        rssi_threshold: sample.rssi_threshold,
        enabled: sample.enabled,
      })
      toast(message, { icon: 'ℹ️' })
    } finally {
      setLoadingRules(false)
    }
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setSelectedDevice(null)
    setRuleValues(defaultRuleState)
    setRuleErrors({})
  }

  const validate = () => {
    const errors = {}
    if (!ruleValues.mac_address.trim()) {
      errors.mac_address = 'MAC address is required'
    }
    const rate = Number(ruleValues.rate_limit_ppm)
    if (!rate || rate <= 0) {
      errors.rate_limit_ppm = 'Rate limit must be greater than 0'
    }
    const maxPacket = Number(ruleValues.max_packet_size)
    if (!maxPacket || maxPacket <= 0) {
      errors.max_packet_size = 'Max packet size must be greater than 0'
    }
    return errors
  }

  const handleChange = (field, value) => {
    setRuleValues((prev) => ({ ...prev, [field]: value }))
    setRuleErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const handleSave = async () => {
    const errors = validate()
    if (Object.keys(errors).length) {
      setRuleErrors(errors)
      return
    }

    if (!selectedDevice) return

    const payload = {
      rate_limit_ppm: Number(ruleValues.rate_limit_ppm),
      mac_address: ruleValues.mac_address.trim(),
      mqtt_topics: ruleValues.mqtt_topics
        .split(',')
        .map((topic) => topic.trim())
        .filter(Boolean),
      ssid: ruleValues.ssid.trim(),
      max_packet_size: Number(ruleValues.max_packet_size),
      rssi_threshold: ruleValues.rssi_threshold === '' ? null : Number(ruleValues.rssi_threshold),
      enabled: Boolean(ruleValues.enabled),
    }

    setSaving(true)
    try {
      await api.put(`/api/device-rules/${selectedDevice.id}`, payload)
      toast.success('Rules updated successfully')
      closeDrawer()
    } catch (err) {
      const message = err?.response?.data?.message ?? err?.message ?? 'Unable to save rules'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const drawerTitle = selectedDevice ? `ESP Setting Rules – ${selectedDevice.name}` : 'ESP Setting Rules'

  const renderStatus = (device) => {
    const online = (device.status ?? '').toLowerCase() === 'online'
    return (
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold ${
          online ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {online ? 'Connected' : 'Offline'}
      </span>
    )
  }

  const deviceRows = useMemo(() => devices, [devices])

  return (
    <div className="space-y-6 bg-gray-50 px-4 pb-12 text-slate-900 sm:px-6">
      <header className="flex flex-col gap-2 rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-6 text-white shadow-sm">
        <h1 className="text-3xl font-semibold">Rule Management</h1>
        <p className="text-sm text-white/80">Configure per-device detection rules across your TinyIDS fleet.</p>
      </header>

      <section className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Devices</h2>
            <p className="text-sm text-slate-500">Select a device to manage its rule configuration.</p>
          </div>
        </div>

        {loadingDevices ? (
          <Spinner label="Loading devices…" />
        ) : devicesError ? (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-600">
            <p>{devicesError}</p>
            <button
              type="button"
              className="mt-3 rounded-full bg-rose-500 px-4 py-1 text-white shadow-sm transition hover:bg-rose-600"
              onClick={loadDevices}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Device Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">IP Address</th>
                  <th className="px-4 py-3 text-right">Setting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deviceRows.map((device) => (
                  <tr key={device.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-slate-900">{device.name}</td>
                    <td className="px-4 py-3">{renderStatus(device)}</td>
                    <td className="px-4 py-3 text-slate-600">{device.ip_address ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openDrawer(device)}
                        className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-sky-600 hover:to-blue-600"
                      >
                        <Settings className="h-4 w-4" />
                        Configure
                      </button>
                    </td>
                  </tr>
                ))}
                {!deviceRows.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                      No devices available for rule configuration.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div className="hidden flex-1 bg-slate-900/40 backdrop-blur-sm sm:block" onClick={closeDrawer} />
          <div className="w-full max-w-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Rules Editor</p>
                <h3 className="text-lg font-semibold text-slate-900">{drawerTitle}</h3>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-6">
              {loadingRules ? (
                <Spinner label="Loading rule settings…" />
              ) : (
                <div className="space-y-5">
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Rate Limit (packets per minute)</label>
                    <input
                      type="number"
                      value={ruleValues.rate_limit_ppm}
                      onChange={(e) => handleChange('rate_limit_ppm', e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                    <p className="mt-1 text-xs text-slate-500">Maximum packets allowed per minute.</p>
                    {ruleErrors.rate_limit_ppm && (
                      <p className="mt-1 text-xs text-rose-500">{ruleErrors.rate_limit_ppm}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-slate-700">MAC Address</label>
                    <input
                      type="text"
                      value={ruleValues.mac_address}
                      onChange={(e) => handleChange('mac_address', e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                    <p className="mt-1 text-xs text-slate-500">Hardware identifier of the device.</p>
                    {ruleErrors.mac_address && (
                      <p className="mt-1 text-xs text-rose-500">{ruleErrors.mac_address}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-slate-700">MQTT Topics</label>
                    <textarea
                      rows={3}
                      value={ruleValues.mqtt_topics}
                      onChange={(e) => handleChange('mqtt_topics', e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      placeholder="esp32/sensor, esp32/alerts"
                    />
                    <p className="mt-1 text-xs text-slate-500">Separate multiple topics with commas.</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-slate-700">SSID</label>
                    <input
                      type="text"
                      value={ruleValues.ssid}
                      onChange={(e) => handleChange('ssid', e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Max Packet Size (bytes)</label>
                      <input
                        type="number"
                        value={ruleValues.max_packet_size}
                        onChange={(e) => handleChange('max_packet_size', e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      />
                      {ruleErrors.max_packet_size && (
                        <p className="mt-1 text-xs text-rose-500">{ruleErrors.max_packet_size}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">RSSI Threshold (dBm)</label>
                      <input
                        type="number"
                        value={ruleValues.rssi_threshold}
                        onChange={(e) => handleChange('rssi_threshold', e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        placeholder="-70"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(ruleValues.enabled)}
                      onChange={(e) => handleChange('enabled', e.target.checked)}
                      className="h-5 w-5 rounded border border-slate-300 text-sky-500 focus:ring-sky-500"
                    />
                    Rule Enabled
                  </label>

                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={closeDrawer}
                      className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-blue-500 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-sky-600 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default RuleManagementPage
