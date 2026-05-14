import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Activity, AlertTriangle, BarChart3, Boxes, CircuitBoard, Shield } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import {
  useDashboardData,
  TREND_TIMEFRAMES,
  ATTACK_TIMING_TIMEFRAMES,
} from '../hooks/useDashboardData'
import api from '../lib/api'
import { getSocket } from '../lib/socket'

const metricCards = [
  {
    title: 'Alerts (Last 24h)',
    key: 'detectedAttacks',
    icon: Shield,
    accent: 'text-sky-600 bg-sky-50',
    description: 'Total intrusion events received in the last 24 hours.',
    settingKey: 'total_detected_attacks',
  },
  {
    title: 'Unique Source IPs (24h)',
    key: 'detectionAccuracy',
    icon: BarChart3,
    accent: 'text-amber-600 bg-amber-50',
    description: 'Distinct attacker IPs observed in the last 24 hours.',
    settingKey: 'detection_accuracy_pct',
  },
  {
    title: 'Blocked IPs',
    key: 'packetsCaptured',
    icon: Boxes,
    accent: 'text-emerald-600 bg-emerald-50',
    description: 'Total IPs currently blocked in TinyIDS.',
    settingKey: 'packets_captured',
  },
  {
    title: 'Devices Online',
    key: 'deviceActivity',
    icon: Activity,
    accent: 'text-teal-600 bg-teal-50',
    description: 'Online sensors out of total registered devices.',
    settingKey: 'device_activity_pct',
    isPercentage: false,
  },
]

const formatNumber = (value) => {
  if (value == null) return '--'
  if (value > 999999) return `${(value / 1000000).toFixed(1)}M`
  if (value > 999) return `${(value / 1000).toFixed(1)}K`
  return value.toLocaleString()
}

const formatMetricValue = (value, isPercentage) => {
  if (value == null) return '--'
  if (isPercentage) return `${value}%`
  return formatNumber(value)
}

const ALL_ATTACK_DATES = 'all'
const formatWindowDaysLabel = (days) => `Last ${days} ${days === 1 ? 'Day' : 'Days'}`
const formatHourRange = (hour) => `${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59`

const buildAttackWindowFromRow = (row) => {
  if (!row || row.peakHour == null || Number(row.peakCount ?? 0) <= 0) {
    return null
  }

  return {
    date: row.date,
    fullLabel: row.fullLabel,
    hour: row.peakHour,
    hourLabel: formatHourRange(row.peakHour),
    count: row.peakCount,
  }
}

const buildPeakAttackWindowFromRows = (rows) => {
  let peakWindow = null

  rows.forEach((row) => {
    const hourlyCounts = Array.isArray(row?.hours) ? row.hours : []
    hourlyCounts.forEach((value, hour) => {
      const count = Number(value ?? 0) || 0
      if (count <= 0) return
      if (peakWindow && peakWindow.count >= count) return

      peakWindow = {
        date: row.date,
        fullLabel: row.fullLabel,
        hour,
        hourLabel: formatHourRange(hour),
        count,
      }
    })
  })

  return peakWindow
}

const getHeatmapCellStyle = (count, maxCount) => {
  if (!count || maxCount <= 0) {
    return {
      backgroundColor: '#f8fafc',
      borderColor: '#e2e8f0',
      color: '#94a3b8',
    }
  }

  const intensity = Math.min(1, count / maxCount)
  const alpha = 0.18 + intensity * 0.72
  return {
    backgroundColor: `rgba(2, 132, 199, ${alpha.toFixed(2)})`,
    borderColor: intensity > 0.45 ? 'rgba(3, 105, 161, 0.75)' : '#7dd3fc',
    color: intensity > 0.55 ? '#ffffff' : '#082f49',
  }
}

const defaultWidgetVisibility = {
  total_detected_attacks: true,
  total_packets_analyzed: true,
  device_activity_pct: true,
  alerts_triggered: true,
  detection_accuracy_pct: true,
  detection_trend_pct: true,
  rule_activation_pct: true,
  packets_captured: true,
  threat_level_indicator: true,
  sensor_health_card: true,
  data_pipeline_card: true,
}

const Dashboard = () => {
  const {
    metrics,
    loading,
    error,
    trendWindowDays,
    setTrendWindowDays,
    attackWindowDays,
    setAttackWindowDays,
    trendData,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    selectedDevice,
    refresh,
    attackTiming,
  } = useDashboardData()
  const [widgetVisibility, setWidgetVisibility] = useState(defaultWidgetVisibility)
  const [selectedAttackDate, setSelectedAttackDate] = useState(ALL_ATTACK_DATES)
  const [selectedAttackWindow, setSelectedAttackWindow] = useState(null)
  const refreshTimeoutRef = useRef(null)
  const lastRealtimeRefreshRef = useRef(0)

  const normalizeVisibility = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return defaultWidgetVisibility
    return {
      ...defaultWidgetVisibility,
      ...(payload.widgets ?? payload),
    }
  }, [])

  const loadVisibility = useCallback(async () => {
    try {
      const { data } = await api.get('/api/dashboard-settings/me')
      setWidgetVisibility(normalizeVisibility(data?.widgets ? data : data?.widgets))
    } catch (err) {
      console.warn('Unable to fetch dashboard widget visibility, using defaults.', err)
      setWidgetVisibility(defaultWidgetVisibility)
    }
  }, [normalizeVisibility])

  useEffect(() => {
    loadVisibility()
  }, [loadVisibility])

  useEffect(() => {
    const handleSettingsUpdated = (event) => {
      setWidgetVisibility(normalizeVisibility(event.detail?.widgets ?? event.detail))
    }
    window.addEventListener('dashboard:settings-updated', handleSettingsUpdated)
    return () => window.removeEventListener('dashboard:settings-updated', handleSettingsUpdated)
  }, [normalizeVisibility])

  useEffect(() => {
    const socket = getSocket()

    const handleLogNew = () => {
      const now = Date.now()
      const elapsed = now - lastRealtimeRefreshRef.current
      if (elapsed > 1500) {
        lastRealtimeRefreshRef.current = now
        refresh().catch(() => {})
        return
      }
      if (refreshTimeoutRef.current) return
      refreshTimeoutRef.current = setTimeout(() => {
        refreshTimeoutRef.current = null
        lastRealtimeRefreshRef.current = Date.now()
        refresh().catch(() => {})
      }, Math.max(1500 - elapsed, 0))
    }

    socket.on('log:new', handleLogNew)
    return () => {
      socket.off('log:new', handleLogNew)
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
        refreshTimeoutRef.current = null
      }
    }
  }, [refresh])

  const visibleMetricCards = useMemo(
    () => metricCards.filter(({ settingKey }) => widgetVisibility[settingKey] !== false),
    [widgetVisibility],
  )

  const contextDeviceName = selectedDevice?.device_name ?? 'All Devices'
  const contextMac = selectedDevice?.mac_address ?? '?'

  const handleDeviceChange = (event) => {
    const nextValue = event.target.value
    setSelectedDeviceId(nextValue)
    try {
      localStorage.setItem('tinyids:selectedDeviceId', String(nextValue))
    } catch {
      // ignore storage errors
    }
  }

  const devicesWithToken = useMemo(() => devices.filter((device) => device?.token), [devices])
  const aggregatedOnline = metrics.devicesOnline ?? Math.floor((metrics.totals?.deviceActivity ?? 0) / 10)
  const totalDevices = metrics.deviceCount ?? Math.max(aggregatedOnline, devicesWithToken.length)
  const nodesOnline = selectedDevice ? (selectedDevice.active ? 1 : 0) : aggregatedOnline
  const nodesDisplay = selectedDevice ? (selectedDevice.active ? 'Online' : 'Offline') : `${nodesOnline}/${totalDevices}`
  const deviceOnlineDisplay = selectedDevice ? `${nodesOnline}/1` : `${nodesOnline}/${totalDevices}`
  const alertsLast24h = metrics.totals?.detectedAttacks ?? 0
  const lastAlertAt = metrics.totals?.lastAlertAt
  const lastAlertLabel = lastAlertAt ? new Date(lastAlertAt).toLocaleString() : '--'
  const showTrendChart = widgetVisibility.detection_trend_pct !== false
  const showSensorCard = widgetVisibility.sensor_health_card !== false
  const attackTimingRows = Array.isArray(attackTiming?.rows) ? attackTiming.rows : []
  const attackTimingWindowRows = useMemo(() => {
    const days = Number(attackWindowDays ?? 0) || 0
    if (days <= 0) return attackTimingRows
    return attackTimingRows.slice(-days)
  }, [attackTimingRows, attackWindowDays])
  const attackTimingTotalAlerts = useMemo(
    () => attackTimingWindowRows.reduce((total, row) => total + (Number(row.total ?? 0) || 0), 0),
    [attackTimingWindowRows],
  )
  const attackTimingMax = useMemo(
    () =>
      attackTimingWindowRows.reduce((maxCount, row) => {
        const rowMax = Math.max(...(Array.isArray(row.hours) ? row.hours : [0]))
        return Math.max(maxCount, rowMax)
      }, 0),
    [attackTimingWindowRows],
  )
  const peakWindow = useMemo(
    () => buildPeakAttackWindowFromRows(attackTimingWindowRows),
    [attackTimingWindowRows],
  )
  const hasAttackTimingData = attackTimingWindowRows.length > 0 && attackTimingTotalAlerts > 0
  const attackTimingDateOptions = useMemo(
    () =>
      attackTimingWindowRows
        .slice()
        .reverse()
        .map((row) => ({
          date: row.date,
          fullLabel: row.fullLabel,
          total: Number(row.total ?? 0) || 0,
        })),
    [attackTimingWindowRows],
  )
  const selectedAttackDateRow = useMemo(
    () => attackTimingWindowRows.find((row) => row.date === selectedAttackDate) ?? null,
    [attackTimingWindowRows, selectedAttackDate],
  )
  const visibleAttackTimingRows = useMemo(() => {
    if (selectedAttackDate === ALL_ATTACK_DATES) {
      return attackTimingWindowRows
    }
    return attackTimingWindowRows.filter((row) => row.date === selectedAttackDate)
  }, [attackTimingWindowRows, selectedAttackDate])
  const visibleAttackTimingTotalAlerts = useMemo(
    () =>
      visibleAttackTimingRows.reduce((total, row) => total + (Number(row.total ?? 0) || 0), 0),
    [visibleAttackTimingRows],
  )
  const visibleAttackTimingMax = useMemo(() => {
    if (selectedAttackDate === ALL_ATTACK_DATES) {
      return attackTimingMax
    }

    return visibleAttackTimingRows.reduce((maxCount, row) => {
      const rowMax = Math.max(...(Array.isArray(row.hours) ? row.hours : [0]))
      return Math.max(maxCount, rowMax)
    }, 0)
  }, [attackTimingMax, selectedAttackDate, visibleAttackTimingRows])
  const activePeakWindow = useMemo(() => {
    if (selectedAttackDate === ALL_ATTACK_DATES) {
      return peakWindow
    }
    return buildAttackWindowFromRow(selectedAttackDateRow)
  }, [peakWindow, selectedAttackDate, selectedAttackDateRow])
  const showAttackTimingGrid =
    selectedAttackDate === ALL_ATTACK_DATES ? hasAttackTimingData : visibleAttackTimingRows.length > 0

  useEffect(() => {
    if (!attackTimingWindowRows.length) {
      setSelectedAttackDate(ALL_ATTACK_DATES)
      return
    }

    setSelectedAttackDate((current) => {
      if (current === ALL_ATTACK_DATES) {
        return current
      }
      return attackTimingWindowRows.some((row) => row.date === current) ? current : ALL_ATTACK_DATES
    })
  }, [attackTimingWindowRows])

  useEffect(() => {
    if (!visibleAttackTimingRows.length) {
      setSelectedAttackWindow(null)
      return
    }

    setSelectedAttackWindow((current) => {
      const matchingRow = visibleAttackTimingRows.find((row) => row.date === current?.date)
      const hour = Number.isInteger(current?.hour) ? current.hour : null

      if (matchingRow && hour != null) {
        const nextCount = Number(matchingRow.hours?.[hour] ?? 0) || 0
        return {
          date: matchingRow.date,
          fullLabel: matchingRow.fullLabel,
          hour,
          hourLabel: formatHourRange(hour),
          count: nextCount,
        }
      }

      return activePeakWindow
    })
  }, [activePeakWindow, visibleAttackTimingRows])

  const handleDownloadReport = () => {
    const pdf = new jsPDF()
    const generatedAt = new Date()

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    pdf.text('TinyIDS Threat Report', 14, 20)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(11)
    pdf.setTextColor(80)
    pdf.setDrawColor(37, 99, 235)
    pdf.setLineWidth(0.5)
    pdf.line(14, 24, 195, 24)

    pdf.setFontSize(10)
    pdf.text(`Report Issued: ${generatedAt.toLocaleString()}`, 14, 32)
    pdf.text(`Reporting Window: ${formatWindowDaysLabel(trendWindowDays)}`, 14, 38)
    pdf.text(`Device Context: ${contextDeviceName}`, 14, 44)
    pdf.text(`MAC Address: ${contextMac}`, 14, 50)
    pdf.text(`Current Threat Level: ${metrics.totals?.threatLevel ?? 0}%`, 14, 56)
    pdf.text('Prepared by: TinyIDS Security Operations Center', 14, 62)

    const metricRows = visibleMetricCards.map(({ title, key, description, isPercentage }) => {
      const rawValue = metrics.totals?.[key] ?? metrics.widgets?.[key]
      const displayValue =
        key === 'deviceActivity' ? deviceOnlineDisplay : formatMetricValue(rawValue, isPercentage)
      return [title, displayValue, description]
    })

    autoTable(pdf, {
      startY: 56,
      head: [['Metric', 'Value', 'Description']],
      body: metricRows,
      styles: { textColor: [20, 24, 33] },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    })

    const trendRows =
      widgetVisibility.detection_trend_pct === false
        ? []
        : trendData.map((entry) => [entry.fullLabel ?? entry.label, entry.value ?? 0])
    if (trendRows.length) {
      autoTable(pdf, {
        startY: (pdf.lastAutoTable?.finalY ?? 66) + 12,
        head: [[`Trend (${formatWindowDaysLabel(trendWindowDays)})`, 'Value']],
        body: trendRows,
        styles: { textColor: [20, 24, 33] },
        headStyles: { fillColor: [14, 165, 233], textColor: 255, fontStyle: 'bold' },
      })
    }

    pdf.setFontSize(10)
    pdf.setTextColor(120)
    pdf.text(
      'Report generated by TinyIDS dashboard. Awaiting live ESP32 telemetry for production data.',
      14,
      pdf.internal.pageSize.getHeight() - 12,
    )

    pdf.save(`tinyids-threat-report-${generatedAt.getTime()}.pdf`)
  }

  return (
    <div className="space-y-6 text-slate-900" style={{ colorScheme: 'light' }}>
      <header className="rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">TinyIDS - Real-time Intrusion Detection Dashboard</h1>
          </div>
          <div className="flex flex-col gap-3 text-sm lg:items-end">
            <div className="rounded-2xl bg-white/20 px-4 py-2 backdrop-blur">
              Last updated:{' '}
              <span className="font-semibold">{new Date(metrics?.lastUpdated ?? Date.now()).toLocaleString()}</span>
            </div>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/70">
                Device Context
                <select
                  value={selectedDeviceId}
                  onChange={handleDeviceChange}
                  className="rounded-full border border-white/40 bg-white/30 px-4 py-2 text-sm font-medium text-slate-900 shadow-sm backdrop-blur transition hover:border-white focus:border-white focus:outline-none focus:ring-2 focus:ring-white/40"
                  style={{
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                    appearance: 'none',
                    backgroundImage:
                    'linear-gradient(45deg, transparent 50%, rgba(255,255,255,0.8) 50%), linear-gradient(135deg, rgba(255,255,255,0.8) 50%, transparent 50%)',
                    backgroundPosition: 'calc(100% - 18px) calc(50% - 3px), calc(100% - 12px) calc(50% - 3px)',
                    backgroundSize: '6px 6px, 6px 6px',
                    backgroundRepeat: 'no-repeat',
                    paddingRight: '2rem',
                    color: '#0f172a',
                  }}
                  onFocus={(e) => {
                    e.target.style.backgroundColor = '#ffffff';
                    e.target.style.color = '#0f172a';
                  }}
                  onBlur={(e) => {
                    e.target.style.backgroundColor = 'rgba(255,255,255,0.3)';
                    e.target.style.color = '#0f172a';
                  }}
                >
                  <option value="all">All Devices</option>
                  {devicesWithToken.map((device) => (
                    <option key={device.id} value={String(device.id)}>
                    {device.device_name ?? `Device ${device.id}`}
                    {device.mac_address ? ` (${device.mac_address})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

        {error && (
          <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visibleMetricCards.map(({ title, key, icon: Icon, accent, description, isPercentage }) => {
            const rawValue = metrics.totals?.[key] ?? metrics.widgets?.[key]
            const displayValue =
              key === 'deviceActivity' ? deviceOnlineDisplay : formatMetricValue(rawValue, isPercentage)

            return (
              <div key={key} className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${accent}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
                    <p className="text-2xl font-semibold text-slate-900">{displayValue}</p>
                    <p className="mt-1 text-xs text-slate-500">{description}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </section>

        {(showTrendChart || showSensorCard) && (
          <section className="mt-8 grid gap-6 lg:grid-cols-2">
            {showTrendChart && (
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Detected Attacks</p>
                    <p className="text-lg font-semibold text-slate-900">
                      Alerts observed in the {formatWindowDaysLabel(trendWindowDays).toLowerCase()}
                    </p>
                  </div>
                  {TREND_TIMEFRAMES.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {TREND_TIMEFRAMES.map((frame) => (
                        <button
                          key={frame}
                          type="button"
                          onClick={() => setTrendWindowDays(frame)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
                            trendWindowDays === frame
                              ? 'border-sky-500 bg-sky-50 text-sky-600'
                              : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {formatWindowDaysLabel(frame)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-4 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100" />
                      <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} />
                      <YAxis stroke="#94a3b8" fontSize={12} />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', borderColor: '#e2e8f0' }}
                        labelStyle={{ color: '#0f172a' }}
                      />
                      <Line type="monotone" dataKey="value" stroke="#0284c7" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {showSensorCard && (
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <CircuitBoard className="h-10 w-10 text-slate-400" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">System Health</p>
                    <p className="text-lg font-semibold">ESP32 Fleet Status</p>
                  </div>
                </div>
                <ul className="mt-4 space-y-3 text-sm">
                  <li className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                    <span className="text-slate-500">{selectedDevice ? 'Device Status' : 'ESP32 Nodes Online'}</span>
                    <span className="font-semibold text-slate-900">{nodesDisplay}</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                    <span className="text-slate-500">Threat Level (24h)</span>
                    <span className="font-semibold text-slate-900">{metrics.totals?.threatLevel ?? 0}%</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                    <span className="text-slate-500">Alerts (24h)</span>
                    <span className="font-semibold text-slate-900">{alertsLast24h}</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                    <span className="text-slate-500">Last Alert Seen</span>
                    <span className="font-semibold text-slate-900">{lastAlertLabel}</span>
                  </li>
                  {selectedDevice && (
                    <li className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                      <span className="text-slate-500">Device MAC</span>
                      <span className="font-semibold text-slate-900">{contextMac}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Attack Activity Heatmap</p>
                  <p className="text-lg font-semibold text-slate-900">
                    View attack spikes by day and hour
                  </p>
                  {ATTACK_TIMING_TIMEFRAMES.length > 1 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {ATTACK_TIMING_TIMEFRAMES.map((frame) => (
                        <button
                          key={`heatmap-window-${frame}`}
                          type="button"
                          onClick={() => setAttackWindowDays(frame)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
                            attackWindowDays === frame
                              ? 'border-sky-500 bg-sky-50 text-sky-600'
                              : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {formatWindowDaysLabel(frame)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
                Day Filter
                <select
                  value={selectedAttackDate}
                  onChange={(event) => setSelectedAttackDate(event.target.value)}
                  disabled={!attackTimingRows.length}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value={ALL_ATTACK_DATES}>All days</option>
                  {attackTimingDateOptions.map((row) => (
                    <option key={row.date} value={row.date}>
                      {row.fullLabel} ({formatNumber(row.total)} alerts)
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{formatNumber(visibleAttackTimingTotalAlerts)}</span>{' '}
                alerts mapped{' '}
                {selectedAttackDate === ALL_ATTACK_DATES
                  ? `across the ${formatWindowDaysLabel(attackWindowDays).toLowerCase()}`
                  : `on ${selectedAttackDateRow?.fullLabel ?? 'the selected day'}`}
              </div>
              {activePeakWindow && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <span className="font-semibold">Peak window:</span>{' '}
                  {activePeakWindow.fullLabel} at {activePeakWindow.hourLabel} with{' '}
                  {formatNumber(activePeakWindow.count)} alerts
                </div>
              )}
            </div>
          </div>

          {showAttackTimingGrid && selectedAttackWindow && (
            <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              <span className="font-semibold">Focused window:</span>{' '}
              {selectedAttackWindow.fullLabel} at {selectedAttackWindow.hourLabel} with{' '}
              {formatNumber(selectedAttackWindow.count)} alerts
            </div>
          )}

          {showAttackTimingGrid ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span className="font-semibold uppercase tracking-wide text-slate-400">Legend</span>
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-6 rounded border border-slate-200 bg-slate-50" />
                  Low
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-6 rounded border border-sky-300 bg-sky-300/60" />
                  Medium
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-6 rounded border border-sky-700 bg-sky-700" />
                  High
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Day
                  </th>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <th
                      key={`hour-${hour}`}
                      className="px-1 py-2 text-center text-[11px] font-semibold text-slate-400"
                    >
                      {String(hour).padStart(2, '0')}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleAttackTimingRows.map((row) => (
                  <tr key={row.date}>
                    <td className="whitespace-nowrap rounded-l-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                      <div className="flex flex-col">
                        <span>{row.label}</span>
                        <span className="text-xs font-medium text-slate-400">
                          Peak {row.peakHour == null ? '--' : formatHourRange(row.peakHour)}
                        </span>
                      </div>
                    </td>
                    {(Array.isArray(row.hours) ? row.hours : []).map((count, hour) => {
                      const style = getHeatmapCellStyle(count, visibleAttackTimingMax)
                      const isSelected =
                        selectedAttackWindow?.date === row.date && selectedAttackWindow?.hour === hour
                      return (
                        <td key={`${row.date}-${hour}`} className="p-0">
                          <button
                            type="button"
                            title={`${row.fullLabel} • ${formatHourRange(hour)} • ${count} alerts`}
                            onClick={() =>
                              setSelectedAttackWindow({
                                date: row.date,
                                fullLabel: row.fullLabel,
                                hour,
                                hourLabel: formatHourRange(hour),
                                count,
                              })
                            }
                            className={`flex h-9 w-9 items-center justify-center rounded-lg border text-[11px] font-semibold transition hover:scale-[1.04] ${
                              isSelected ? 'ring-2 ring-sky-500 ring-offset-1' : ''
                            }`}
                            style={style}
                          >
                            {count > 0 ? count : ''}
                          </button>
                        </td>
                      )
                    })}
                    <td className="rounded-r-xl bg-white px-3 py-2 text-right text-sm font-semibold text-slate-700 shadow-sm">
                      {formatNumber(row.total ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-800">No attack activity mapped yet</h3>
              <p className="mt-2 text-sm text-slate-500">
                No attack alerts were grouped into the selected {attackWindowDays}-day window yet.
              </p>
            </div>
          )}
        </section>

        {loading && (
          <p className="mt-6 text-center text-sm text-slate-500">Loading dashboard metrics and charts...</p>
        )}
    </div>
  )
}

export default Dashboard
