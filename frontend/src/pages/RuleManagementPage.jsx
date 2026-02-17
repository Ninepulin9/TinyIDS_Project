import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { Loader2, Settings } from 'lucide-react'
import toast from 'react-hot-toast'

import api from '../api/axios'
import { getSocket } from '../lib/socket'
import Badge from '../components/ui/Badge.jsx'

const defaultRuleState = {
  token: '',
  cfg_rate_limit_count: '',
  cfg_rate_limit_seconds: '',
  cfg_oversized_threshold: '',
  cfg_http_url_max_len: '',
  cfg_rssi_diff_threshold: '',
  cfg_syn_flood_threshold: '',
  cfg_syn_flood_seconds: '',
  cfg_syn_timeout: '',
  cfg_http_bf_threshold: '',
  cfg_http_bf_window: '',
  cfg_http_bf_block_time: '',
  cfg_deauth_cooldown_ms: '',
  g_trusted_channel: '',
  g_target_trusted_mac: '',
  g_mqtt_whitelist: '',
  blocked_ips: '',
  xss_patterns: '',
}

const ruleSections = [
  {
    id: 'rate_limit',
    title: 'Rate Limiting',
    subtitle: 'CFG_RATE_LIMIT_COUNT / CFG_RATE_LIMIT_SECONDS',
    description: 'Limit how many events are allowed in a time window to avoid flooding.',
    fields: [
      { key: 'cfg_rate_limit_count', label: 'Requests per Window', helper: 'CFG_RATE_LIMIT_COUNT', type: 'number', required: true },
      { key: 'cfg_rate_limit_seconds', label: 'Window (seconds)', helper: 'CFG_RATE_LIMIT_SECONDS', type: 'number', required: true },
    ],
  },
  {
    id: 'oversize_http',
    title: 'Oversized & HTTP Constraints',
    subtitle: 'Payload and URL safety',
    description: 'Protect against oversized payloads and long URLs; tune RSSI threshold.',
    fields: [
      { key: 'cfg_oversized_threshold', label: 'Oversized Threshold (bytes)', helper: 'CFG_OVERSIZED_THRESHOLD', type: 'number' },
      { key: 'cfg_http_url_max_len', label: 'HTTP URL Max Length', helper: 'CFG_HTTP_URL_MAX_LEN', type: 'number' },
      { key: 'cfg_rssi_diff_threshold', label: 'RSSI Diff Threshold', helper: 'CFG_RSSI_DIFF_THRESHOLD', type: 'number' },
    ],
  },
  {
    id: 'syn',
    title: 'SYN Flood Protection',
    subtitle: 'SYN thresholds and timeout',
    description: 'Detect and react to SYN flood attempts.',
    fields: [
      { key: 'cfg_syn_flood_threshold', label: 'SYN Flood Threshold', helper: 'CFG_SYN_FLOOD_THRESHOLD', type: 'number' },
      { key: 'cfg_syn_flood_seconds', label: 'SYN Flood Window (seconds)', helper: 'CFG_SYN_FLOOD_SECONDS', type: 'number' },
      { key: 'cfg_syn_timeout', label: 'SYN Timeout (seconds)', helper: 'CFG_SYN_TIMEOUT', type: 'number' },
    ],
  },
  {
    id: 'http_bf',
    title: 'HTTP Brute Force',
    subtitle: 'Threshold, window, block time',
    description: 'Set limits for HTTP brute-force detection and block duration.',
    fields: [
      { key: 'cfg_http_bf_threshold', label: 'HTTP BF Threshold', helper: 'CFG_HTTP_BF_THRESHOLD', type: 'number' },
      { key: 'cfg_http_bf_window', label: 'HTTP BF Window (seconds)', helper: 'CFG_HTTP_BF_WINDOW', type: 'number' },
      { key: 'cfg_http_bf_block_time', label: 'HTTP BF Block Time (seconds)', helper: 'CFG_HTTP_BF_BLOCK_TIME', type: 'number' },
    ],
  },
  {
    id: 'deauth',
    title: 'Deauth Cooldown',
    subtitle: 'Cooldown after detection',
    description: 'Delay before accepting new auth attempts after deauth events.',
    fields: [{ key: 'cfg_deauth_cooldown_ms', label: 'Deauth Cooldown (ms)', helper: 'CFG_DEAUTH_COOLDOWN_MS', type: 'number', fullWidth: true }],
  },
  {
    id: 'trust',
    title: 'Trusted Channels & MACs',
    subtitle: 'g_trusted_channel / g_target_trusted_mac',
    description: 'Comma separated lists of Wi‑Fi channels and MAC addresses that are allowed.',
    fields: [
      {
        key: 'g_trusted_channel',
        label: 'Trusted Channels',
        helper: 'g_trusted_channel (comma-separated)',
        placeholder: '8, 9, 11',
        type: 'text',
      },
      {
        key: 'g_target_trusted_mac',
        label: 'Trusted MACs',
        helper: 'g_target_trusted_mac (comma-separated)',
        placeholder: '00:00:00:00:00:00',
        type: 'text',
      },
    ],
  },
  {
    id: 'whitelist',
    title: 'MQTT Whitelist & Blocked IPs',
    subtitle: 'g_mqtt_whitelist / blocked_ips',
    description: 'Topics allowed to publish/subscribe and IPs blocked by IDS.',
    fields: [
      {
        key: 'g_mqtt_whitelist',
        label: 'MQTT Whitelist Topics',
        helper: 'g_mqtt_whitelist (comma-separated)',
        placeholder: 'test/data, device/status',
        type: 'text',
      },
      {
        key: 'blocked_ips',
        label: 'Blocked IPs',
        helper: 'blocked_ips (comma-separated)',
        placeholder: '192.168.1.10, 192.168.1.11',
        type: 'text',
      },
    ],
  },
  {
    id: 'xss',
    title: 'XSS Patterns',
    subtitle: 'xss_patterns',
    description: 'Comma separated list of XSS patterns to detect/block.',
    fields: [
      {
        key: 'xss_patterns',
        label: 'XSS Patterns',
        helper: 'xss_patterns (comma-separated)',
        placeholder: '<script>, javascript:, onerror=',
        type: 'text',
        fullWidth: true,
      },
    ],
  },
]

const Spinner = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-slate-500">
    <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
    {label && <p>{label}</p>}
  </div>
)

const RuleManagementPage = () => {
  const [devices, setDevices] = useState([])
  const [loadingDevices, setLoadingDevices] = useState(true)
  const [devicesError, setDevicesError] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [ruleValues, setRuleValues] = useState(defaultRuleState)
  const [ruleErrors, setRuleErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [loadingRules, setLoadingRules] = useState(false)
  const [awaitingToken, setAwaitingToken] = useState('')
  const [aliveCheckAt, setAliveCheckAt] = useState(null)
  const pollRef = useRef({ timer: null, attempts: 0 })
  const requestMetaRef = useRef({ token: '', requestedAt: 0 })
  const lastSettingsRequestRef = useRef({ token: '', time: 0 })
  const pingIntervalRef = useRef(null)
  const initialPingRef = useRef(false)
  const requestThrottleMs = 15000
  const pollIntervalMs = 3000
  const maxPollAttempts = 8
  const [expanded, setExpanded] = useState(() =>
    ruleSections.reduce((acc, section, idx) => ({ ...acc, [section.id]: idx === 0 }), {})
  )

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true)
    setDevicesError('')
    try {
      const { data } = await api.get('/api/devices')
      const list = Array.isArray(data) ? data : []
      setDevices(list.filter((device) => device?.token))
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Unable to load devices. Please try again.'
      setDevicesError(message)
      toast.error(message)
    } finally {
      setLoadingDevices(false)
    }
  }, [])

  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  useEffect(() => {
    const socket = getSocket()
    const handleLogNew = (payload) => {
      const data = payload?.payload ?? payload
      if (!data || typeof data !== 'object') return
      const topic = String(data._mqtt_topic ?? '').toLowerCase()
      if (topic === 'esp/alive' || data.ip || data.ip_address || data.device_ip) {
        loadDevices()
      }
    }
    const handleDeviceUpdated = () => {
      loadDevices()
    }
    socket.on('log:new', handleLogNew)
    socket.on('device:updated', handleDeviceUpdated)
    return () => {
      socket.off('log:new', handleLogNew)
      socket.off('device:updated', handleDeviceUpdated)
    }
  }, [loadDevices])

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
      loadDevices()
    }, 20000)
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
      }
    }
  }, [devices, pingDevices, loadDevices])

  useEffect(() => {
    if (initialPingRef.current) return
    const liveDevices = devices.filter((d) => d?.id && d.token)
    if (!liveDevices.length) return
    initialPingRef.current = true
    const needsCheck = liveDevices.some((device) => !device?.last_seen)
    setAliveCheckAt(needsCheck ? Date.now() : null)
    pingDevices()
  }, [devices, pingDevices])

  const openDrawer = (device) => {
    setSelectedDevice(device)
    setRuleErrors({})
    setDrawerOpen(true)
    setLoadingRules(true)
    // Pre-fill token from device
    setRuleValues((prev) => ({
      ...defaultRuleState,
      token: device?.token ?? '',
    }))
    setLoadingRules(false)
    if (device?.token) {
      handleLoadFromDevice(device)
    }
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setSelectedDevice(null)
    setRuleValues(defaultRuleState)
    setRuleErrors({})
  }

  const handleChange = (field, value) => {
    setRuleValues((prev) => ({ ...prev, [field]: value }))
    setRuleErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const coerceList = (value) => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join(', ')
    }
    if (value == null) return ''
    return String(value)
  }

  const mapPayloadToRules = (payload, fallbackToken) => ({
    token: payload?.token ?? fallbackToken ?? '',
    cfg_rate_limit_count: payload?.CFG_RATE_LIMIT_COUNT ?? payload?.cfg_rate_limit_count ?? '',
    cfg_rate_limit_seconds: payload?.CFG_RATE_LIMIT_SECONDS ?? payload?.cfg_rate_limit_seconds ?? '',
    cfg_oversized_threshold: payload?.CFG_OVERSIZED_THRESHOLD ?? payload?.cfg_oversized_threshold ?? '',
    cfg_http_url_max_len: payload?.CFG_HTTP_URL_MAX_LEN ?? payload?.cfg_http_url_max_len ?? '',
    cfg_rssi_diff_threshold: payload?.CFG_RSSI_DIFF_THRESHOLD ?? payload?.cfg_rssi_diff_threshold ?? '',
    cfg_syn_flood_threshold: payload?.CFG_SYN_FLOOD_THRESHOLD ?? payload?.cfg_syn_flood_threshold ?? '',
    cfg_syn_flood_seconds: payload?.CFG_SYN_FLOOD_SECONDS ?? payload?.cfg_syn_flood_seconds ?? '',
    cfg_syn_timeout: payload?.CFG_SYN_TIMEOUT ?? payload?.cfg_syn_timeout ?? '',
    cfg_http_bf_threshold: payload?.CFG_HTTP_BF_THRESHOLD ?? payload?.cfg_http_bf_threshold ?? '',
    cfg_http_bf_window: payload?.CFG_HTTP_BF_WINDOW ?? payload?.cfg_http_bf_window ?? '',
    cfg_http_bf_block_time: payload?.CFG_HTTP_BF_BLOCK_TIME ?? payload?.cfg_http_bf_block_time ?? '',
    cfg_deauth_cooldown_ms: payload?.CFG_DEAUTH_COOLDOWN_MS ?? payload?.cfg_deauth_cooldown_ms ?? '',
    g_trusted_channel: coerceList(payload?.g_trusted_channel ?? payload?.G_TRUSTED_CHANNEL),
    g_target_trusted_mac: coerceList(payload?.g_target_trusted_mac ?? payload?.G_TARGET_TRUSTED_MAC),
    g_mqtt_whitelist: coerceList(payload?.g_mqtt_whitelist ?? payload?.G_MQTT_WHITELIST),
    blocked_ips: coerceList(payload?.blocked_ips ?? payload?.BLOCKED_IPS),
    xss_patterns: coerceList(payload?.xss_patterns ?? payload?.XSS_PATTERNS),
  })

  const stopPolling = () => {
    if (pollRef.current.timer) {
      clearInterval(pollRef.current.timer)
      pollRef.current.timer = null
    }
    pollRef.current.attempts = 0
  }

  const pollSettingsOnce = async (deviceToken, deviceId) => {
    try {
      const { data } = await api.get(`/api/devices/${deviceId}/settings/latest`)
      if (!data) return false
      if (!isFreshSettingsPayload(data, deviceToken)) return false
      const hasSettings =
        data.CFG_RATE_LIMIT_COUNT != null ||
        data.CFG_RATE_LIMIT_SECONDS != null ||
        data.cfg_rate_limit_count != null ||
        data.cfg_rate_limit_seconds != null
      if (!hasSettings) return false
      setRuleValues(mapPayloadToRules(data, deviceToken))
      setAwaitingToken('')
      setLoadingRules(false)
      toast.success('Loaded settings from device')
      return true
    } catch {
      return false
    }
  }

  const validate = () => {
    const errors = {}
    if (!ruleValues.token.trim()) errors.token = 'Token is required'
    if (!Number(ruleValues.cfg_rate_limit_count)) errors.cfg_rate_limit_count = 'Required'
    if (!Number(ruleValues.cfg_rate_limit_seconds)) errors.cfg_rate_limit_seconds = 'Required'
    return errors
  }

  const toArray = (text) =>
    text
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

  const handleSave = async () => {
    const errors = validate()
    if (Object.keys(errors).length) {
      setRuleErrors(errors)
      return
    }
    if (!selectedDevice) return

    const payload = {
      token: ruleValues.token.trim(),
      CFG_RATE_LIMIT_COUNT: Number(ruleValues.cfg_rate_limit_count),
      CFG_RATE_LIMIT_SECONDS: Number(ruleValues.cfg_rate_limit_seconds),
      CFG_OVERSIZED_THRESHOLD:
        ruleValues.cfg_oversized_threshold === '' ? undefined : Number(ruleValues.cfg_oversized_threshold),
      CFG_HTTP_URL_MAX_LEN:
        ruleValues.cfg_http_url_max_len === '' ? undefined : Number(ruleValues.cfg_http_url_max_len),
      CFG_RSSI_DIFF_THRESHOLD:
        ruleValues.cfg_rssi_diff_threshold === '' ? undefined : Number(ruleValues.cfg_rssi_diff_threshold),
      CFG_SYN_FLOOD_THRESHOLD:
        ruleValues.cfg_syn_flood_threshold === '' ? undefined : Number(ruleValues.cfg_syn_flood_threshold),
      CFG_SYN_FLOOD_SECONDS:
        ruleValues.cfg_syn_flood_seconds === '' ? undefined : Number(ruleValues.cfg_syn_flood_seconds),
      CFG_SYN_TIMEOUT: ruleValues.cfg_syn_timeout === '' ? undefined : Number(ruleValues.cfg_syn_timeout),
      CFG_HTTP_BF_THRESHOLD:
        ruleValues.cfg_http_bf_threshold === '' ? undefined : Number(ruleValues.cfg_http_bf_threshold),
      CFG_HTTP_BF_WINDOW:
        ruleValues.cfg_http_bf_window === '' ? undefined : Number(ruleValues.cfg_http_bf_window),
      CFG_HTTP_BF_BLOCK_TIME:
        ruleValues.cfg_http_bf_block_time === '' ? undefined : Number(ruleValues.cfg_http_bf_block_time),
      CFG_DEAUTH_COOLDOWN_MS:
        ruleValues.cfg_deauth_cooldown_ms === '' ? undefined : Number(ruleValues.cfg_deauth_cooldown_ms),
      g_trusted_channel: toArray(ruleValues.g_trusted_channel).map((x) => Number(x)).filter((x) => !Number.isNaN(x)),
      g_target_trusted_mac: toArray(ruleValues.g_target_trusted_mac),
      g_mqtt_whitelist: toArray(ruleValues.g_mqtt_whitelist),
      blocked_ips: toArray(ruleValues.blocked_ips),
      xss_patterns: toArray(ruleValues.xss_patterns),
    }

    setSaving(true)
    try {
      await api.post(`/api/devices/${selectedDevice.id}/publish`, {
        topic_base: 'esp/setting/Control',
        payload,
        append_token: false,
      })
      toast.success('Settings sent to device')
    } catch (err) {
      const message = err?.response?.data?.message ?? err?.message ?? 'Unable to send settings'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const handleLoadFromDevice = async (deviceOverride) => {
    const targetDevice = deviceOverride ?? selectedDevice
    if (!targetDevice) return
    const deviceToken = (deviceOverride?.token ?? ruleValues.token)?.trim() || targetDevice.token
    if (!deviceToken) {
      toast.error('No token found for this device.')
      return
    }
    const now = Date.now()
    if (
      lastSettingsRequestRef.current.token === deviceToken &&
      now - lastSettingsRequestRef.current.time < requestThrottleMs
    ) {
      return
    }
    lastSettingsRequestRef.current = { token: deviceToken, time: now }
    requestMetaRef.current = { token: deviceToken, requestedAt: Date.now() }
    setLoadingRules(true)
    setAwaitingToken(deviceToken)
    try {
      await api.post(`/api/devices/${targetDevice.id}/publish`, {
        topic_base: 'esp/setting/Control',
        message: `showsetting-${deviceToken}`,
        append_token: false,
      })
      stopPolling()
      pollRef.current.timer = setInterval(async () => {
        pollRef.current.attempts += 1
        if (pollRef.current.attempts >= maxPollAttempts) {
          stopPolling()
          setAwaitingToken('')
          setLoadingRules(false)
          toast.error('Device did not respond in time.')
          return
        }
        const done = await pollSettingsOnce(deviceToken, targetDevice.id)
        if (done) {
          stopPolling()
        }
      }, pollIntervalMs)
    } catch (err) {
      const message = err?.response?.data?.message ?? err?.message ?? 'Unable to request settings'
      toast.error(message)
      setAwaitingToken('')
      stopPolling()
      setLoadingRules(false)
    } finally {
      // keep loading until settings arrive
    }
  }

  useEffect(() => {
    if (!awaitingToken) return
    setLoadingRules(true)
    const socket = getSocket()
    const handleLogNew = (payload) => {
      const data = payload?.payload ?? payload
      if (!data || typeof data !== 'object') return
      const token = String(data.token ?? '').trim()
      const topic = String(data._mqtt_topic ?? '').toLowerCase()
      if (token !== awaitingToken) return
      if (topic !== 'esp/setting/now') return
      if (!isFreshSettingsPayload(data, awaitingToken)) return
      const hasSettings =
        data.CFG_RATE_LIMIT_COUNT != null ||
        data.CFG_RATE_LIMIT_SECONDS != null ||
        data.cfg_rate_limit_count != null ||
        data.cfg_rate_limit_seconds != null
      if (hasSettings) {
        setRuleValues(mapPayloadToRules(data, awaitingToken))
        setAwaitingToken('')
        setLoadingRules(false)
        stopPolling()
        toast.success('Loaded settings from device')
      }
    }
    socket.on('log:new', handleLogNew)
    return () => {
      socket.off('log:new', handleLogNew)
    }
  }, [awaitingToken])

  const handleSetDefault = async () => {
    if (!selectedDevice) return
    const deviceToken = (selectedDevice?.token ?? ruleValues.token)?.trim()
    if (!deviceToken) {
      toast.error('No token found for this device.')
      return
    }
    const now = Date.now()
    if (
      lastSettingsRequestRef.current.token === deviceToken &&
      now - lastSettingsRequestRef.current.time < requestThrottleMs
    ) {
      return
    }
    lastSettingsRequestRef.current = { token: deviceToken, time: now }
    requestMetaRef.current = { token: deviceToken, requestedAt: Date.now() }
    setLoadingRules(true)
    setRuleValues({ ...defaultRuleState, token: deviceToken })
    try {
      await api.post(`/api/devices/${selectedDevice.id}/publish`, {
        topic_base: 'esp/setting/Control',
        message: `showsetting-default-${deviceToken}`,
        append_token: false,
      })
      // Ask for the full settings payload after default reset (delayed)
      setAwaitingToken(deviceToken)
      stopPolling()
      setTimeout(() => {
        api.post(`/api/devices/${selectedDevice.id}/publish`, {
          topic_base: 'esp/setting/Control',
          message: `showsetting-${deviceToken}`,
          append_token: false,
        })
        pollRef.current.timer = setInterval(async () => {
          pollRef.current.attempts += 1
          if (pollRef.current.attempts >= maxPollAttempts) {
            stopPolling()
            setAwaitingToken('')
            setLoadingRules(false)
            toast.error('Device did not respond in time.')
            return
          }
          const done = await pollSettingsOnce(deviceToken, selectedDevice.id)
          if (done) {
            stopPolling()
          }
        }, pollIntervalMs)
      }, 5000)
    } catch (err) {
      const message = err?.response?.data?.message ?? err?.message ?? 'Unable to request defaults'
      toast.error(message)
      setLoadingRules(false)
    }
  }

  const isFreshSettingsPayload = (payload, token) => {
    if (!payload || typeof payload !== 'object') return false
    const payloadToken = String(payload.token ?? '').trim()
    if (token && payloadToken && payloadToken !== token) return false
    const receivedAtRaw = payload._received_at || payload.received_at || payload.time || payload.timestamp
    if (!receivedAtRaw) return true
    const parsed = new Date(receivedAtRaw)
    if (Number.isNaN(parsed.getTime())) return true
    const requestedAt = requestMetaRef.current.requestedAt || 0
    if (!requestedAt) return true
    return parsed.getTime() >= requestedAt - 1000
  }

  const deviceRows = useMemo(() => devices, [devices])

  const renderOnlineStatus = (device) => {
    const lastSeen = device?.last_seen ? dayjs(device.last_seen) : null
    const pendingWindowSec = 30
    const requestMoment = aliveCheckAt ? dayjs(aliveCheckAt) : null
    const awaitingAlive =
      Boolean(device?.token) &&
      !lastSeen &&
      requestMoment &&
      dayjs().diff(requestMoment, 'second') <= pendingWindowSec
    const isOnline = lastSeen ? dayjs().diff(lastSeen, 'minute') <= 30 : false

    return (
      <div className="flex flex-col">
        <Badge variant={awaitingAlive ? 'muted' : isOnline ? 'success' : 'muted'}>
          {awaitingAlive ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
              Checking...
            </span>
          ) : isOnline ? (
            'Online'
          ) : (
            'Offline'
          )}
        </Badge>
        <span className="mt-1 text-xs text-slate-400">
          {awaitingAlive ? 'Waiting for alive response' : 'Alive check within 30 min'}
        </span>
      </div>
    )
  }

  const toggleSection = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const renderField = (field) => {
    const inputType = field.type === 'number' ? 'number' : 'text'
    return (
      <div key={field.key} className={field.fullWidth ? 'sm:col-span-2' : ''}>
        <label className="text-sm font-semibold text-slate-700">{field.label}</label>
        <p className="text-xs text-slate-500">{field.helper}</p>
        <input
          type={inputType}
          value={ruleValues[field.key]}
          onChange={(e) => handleChange(field.key, e.target.value)}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder={field.placeholder}
        />
        {ruleErrors[field.key] && <p className="mt-1 text-xs text-rose-500">{ruleErrors[field.key]}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-6 bg-gray-50 px-4 pb-12 text-slate-900 sm:px-6">
      <header className="flex flex-col gap-2 rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-6 text-white shadow-sm">
        <h1 className="text-3xl font-semibold">Rule Management</h1>
        <p className="text-sm text-white/80">Configure per-device settings via MQTT with tokenized topics.</p>
      </header>

      <section className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Devices</h2>
            <p className="text-sm text-slate-500">Select a device to view and configure its settings.</p>
          </div>
        </div>

        {loadingDevices ? (
          <Spinner label="Loading devices..." />
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
                  <th className="px-4 py-3">Online Status</th>
                  <th className="px-4 py-3">IP Address</th>
                  <th className="px-4 py-3 text-right">Setting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deviceRows.map((device) => (
                  <tr key={device.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {device.device_name ?? device.name ?? `Device ${device.id}`}
                    </td>
                    <td className="px-4 py-3">{renderOnlineStatus(device)}</td>
                    <td className="px-4 py-3 text-slate-600">{device.ip_address ?? '--'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openDrawer(device)}
                        className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-sky-600 hover:to-blue-600"
                      >
                        <Settings className="h-4 w-4" />
                        View / Configure
                      </button>
                    </td>
                  </tr>
                ))}
                {!deviceRows.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                      No devices available for configuration.
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
          <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Settings Editor</p>
                <h3 className="text-lg font-semibold text-slate-900">
                  {selectedDevice?.device_name ?? selectedDevice?.name ?? 'Device'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <span className="block px-1 text-lg leading-none">×</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {loadingRules ? (
                <Spinner label="Loading settings..." />
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Token</label>
                      <input
                        type="text"
                        value={ruleValues.token}
                        readOnly
                        className="mt-2 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        placeholder="Auto-filled from device registration"
                      />
                      <p className="mt-1 text-xs text-slate-500">Token is stored when the board registers.</p>
                      {ruleErrors.token && <p className="mt-1 text-xs text-rose-500">{ruleErrors.token}</p>}
                    </div>
                    <div className="flex items-end justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-sky-600 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                        aria-label="Send settings to device"
                      >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={handleSetDefault}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        aria-label="Reset settings to default"
                      >
                        Set to Default
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {ruleSections.map((section) => (
                      <div key={section.id} className="rounded-xl border border-slate-200 bg-slate-50/60">
                        <div className="flex items-start justify-between gap-4 px-4 py-3">
                          <div>
                            <h3 className="text-base font-semibold text-slate-900">{section.title}</h3>
                            <p className="text-xs font-semibold text-indigo-600">{section.subtitle}</p>
                            <p className="mt-1 text-sm text-slate-600">{section.description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleSection(section.id)}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-white"
                          >
                            <Settings className="h-4 w-4" />
                            {expanded[section.id] ? 'Hide' : 'Configure'}
                          </button>
                        </div>
                        {expanded[section.id] && (
                          <div className="border-t border-slate-200 bg-white px-4 py-4">
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                              {section.fields.map((field) => renderField(field))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
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
