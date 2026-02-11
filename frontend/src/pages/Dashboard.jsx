import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Activity, AlertTriangle, BarChart3, Boxes, CircuitBoard, Shield } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { useDashboardData, DASHBOARD_TIMEFRAMES } from '../hooks/useDashboardData'
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

const defaultWidgetVisibility = {
  total_detected_attacks: true,
  total_packets_analyzed: true,
  device_activity_pct: true,
  alerts_triggered: true,
  detection_accuracy_pct: true,
  detection_trend_pct: false,
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
    timeframe,
    setTimeframe,
    trendData,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    selectedDevice,
    refresh,
  } = useDashboardData()
  const [widgetVisibility, setWidgetVisibility] = useState(defaultWidgetVisibility)
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
    pdf.text(`Reporting Window: ${timeframe}`, 14, 38)
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

    const trendRows = widgetVisibility.detection_trend_pct === false ? [] : trendData.map((entry) => [entry.label, entry.value ?? 0])
    if (trendRows.length) {
      autoTable(pdf, {
        startY: (pdf.lastAutoTable?.finalY ?? 66) + 12,
        head: [[`Trend (${timeframe})`, 'Value']],
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

        {showTrendChart && (
          <section
            className="mt-8 grid gap-6 lg:grid-cols-1"
          >
            {showTrendChart && (
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Alert Trend</p>
                    <p className="text-lg font-semibold text-slate-900">Alerts observed in the last 12 days</p>
                  </div>
                  {DASHBOARD_TIMEFRAMES.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {DASHBOARD_TIMEFRAMES.map((frame) => (
                        <button
                          key={frame}
                          onClick={() => setTimeframe(frame)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
                            timeframe === frame
                              ? 'border-sky-500 bg-sky-50 text-sky-600'
                              : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {frame}
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
          </section>
        )}

        {showSensorCard && (
          <section className="mt-8 grid gap-6">
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

        {loading && (
          <p className="mt-6 text-center text-sm text-slate-500">Loading dashboard metrics and charts...</p>
        )}
    </div>
  )
}

export default Dashboard

