import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import api from '../lib/api'

export const DASHBOARD_TIMEFRAMES = ['seconds', 'minutes', 'hours', 'days', 'months']
const AUTO_REFRESH_INTERVAL_MS = 4 * 1000

const createEmptyTrends = () => ({
  seconds: [],
  minutes: [],
  hours: [],
  days: [],
  months: [],
})

const defaultTotals = {
  detectedAttacks: 0,
  packetsAnalyzed: 0,
  detectionAccuracy: 0,
  deviceActivity: 0,
  alertsTriggered: 0,
  ruleActivation: 0,
  packetsCaptured: 0,
  threatLevel: 0,
}

const defaultWidgets = {
  totalDetectedAttacks: 0,
  totalPacketsAnalyzed: 0,
  detectionAccuracy: 0,
  deviceActivity: 0,
  alertsTriggered: 0,
  ruleActivation: 0,
  packetsCaptured: 0,
}

const buildDefaultMetrics = () => ({
  totals: { ...defaultTotals },
  widgets: { ...defaultWidgets },
  trends: createEmptyTrends(),
  lastUpdated: null,
  devicesOnline: 0,
  deviceCount: 0,
})

const normalizeDashboardPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return {
      metrics: buildDefaultMetrics(),
      devices: [],
      selectedDevice: null,
    }
  }

  const baseMetrics = buildDefaultMetrics()
  const normalizedTotals =
    payload.totals && typeof payload.totals === 'object'
      ? { ...baseMetrics.totals, ...payload.totals }
      : baseMetrics.totals
  const normalizedWidgets =
    payload.widgets && typeof payload.widgets === 'object'
      ? { ...baseMetrics.widgets, ...payload.widgets }
      : baseMetrics.widgets

  const trendsPayload = payload.trends && typeof payload.trends === 'object' ? payload.trends : {}
  const normalizedTrends = { ...createEmptyTrends(), ...trendsPayload }

  return {
    metrics: {
      totals: normalizedTotals,
      widgets: normalizedWidgets,
      trends: normalizedTrends,
      lastUpdated: payload.lastUpdated ?? baseMetrics.lastUpdated,
      devicesOnline:
        typeof payload.devicesOnline === 'number' ? payload.devicesOnline : baseMetrics.devicesOnline,
      deviceCount: typeof payload.deviceCount === 'number' ? payload.deviceCount : baseMetrics.deviceCount,
    },
    devices: Array.isArray(payload.available_devices) ? payload.available_devices : [],
    selectedDevice: payload.selected_device ?? null,
  }
}

const resolveDeviceQueryParams = (deviceKey) => {
  if (!deviceKey || deviceKey === 'all') {
    return {}
  }

  const trimmed = String(deviceKey).trim()
  if (!trimmed || trimmed === 'all') {
    return {}
  }

  const numericId = Number(trimmed)
  if (!Number.isNaN(numericId) && Number.isFinite(numericId)) {
    return { device_id: numericId }
  }

  return { mac_address: trimmed }
}

const useDashboardData = () => {
  const [metrics, setMetrics] = useState(buildDefaultMetrics)
  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('all')
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timeframe, setTimeframe] = useState('days')
  const [lastManualRefresh, setLastManualRefresh] = useState(null)

  const isMountedRef = useRef(false)
  const requestIdRef = useRef(0)

  const updateSelectedDeviceId = useCallback((value) => {
    if (value === null || value === undefined || value === '' || value === 'all') {
      setSelectedDeviceId('all')
    } else {
      setSelectedDeviceId(String(value))
    }
  }, [])

  const fetchMetrics = useCallback(
    async ({ silent = false, deviceId } = {}) => {
      const targetDeviceKey = deviceId ?? selectedDeviceId
      const params = resolveDeviceQueryParams(targetDeviceKey)

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      if (!silent) {
        setLoading(true)
        setError('')
      }

      try {
        const { data } = await api.get('/api/dashboard', { params })
        if (!isMountedRef.current || requestId !== requestIdRef.current) {
          return null
        }

        const normalized = normalizeDashboardPayload(data)
        setMetrics(normalized.metrics)
        setDevices(normalized.devices)
        setSelectedDevice(normalized.selectedDevice)
        setError('')

        if (targetDeviceKey !== 'all') {
          if (normalized.selectedDevice?.id) {
            const idString = String(normalized.selectedDevice.id)
            if (idString !== targetDeviceKey) {
              updateSelectedDeviceId(idString)
            }
          } else if (!params.device_id && !params.mac_address) {
            updateSelectedDeviceId('all')
          } else if (!normalized.selectedDevice) {
            updateSelectedDeviceId('all')
          }
        }

        return normalized.metrics
      } catch (err) {
        if (!isMountedRef.current || requestId !== requestIdRef.current) {
          return null
        }

        const message =
          err?.response?.data?.message ?? err?.message ?? 'Unable to load dashboard metrics. Please try again.'
        setError(message)
        throw err
      } finally {
        if (!silent && isMountedRef.current && requestId === requestIdRef.current) {
          setLoading(false)
        }
      }
    },
    [selectedDeviceId, updateSelectedDeviceId],
  )

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    fetchMetrics({ silent: false }).catch(() => {})
  }, [fetchMetrics])

  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchMetrics({ silent: true }).catch(() => {})
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => clearInterval(intervalId)
  }, [fetchMetrics])

  const refresh = useCallback(async () => {
    try {
      const result = await fetchMetrics({ silent: true })
      if (result && isMountedRef.current) {
        setLastManualRefresh(Date.now())
      }
      return result
    } catch {
      return null
    }
  }, [fetchMetrics])

  const trendData = useMemo(() => {
    if (!metrics?.trends) {
      return []
    }
    const data = metrics.trends[timeframe]
    return Array.isArray(data) ? data : []
  }, [metrics.trends, timeframe])

  return {
    metrics,
    devices,
    selectedDeviceId,
    setSelectedDeviceId: updateSelectedDeviceId,
    selectedDevice,
    loading,
    error,
    timeframe,
    setTimeframe,
    trendData,
    refresh,
    lastManualRefresh,
  }
}

export { useDashboardData }

export default useDashboardData
