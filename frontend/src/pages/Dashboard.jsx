import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Activity, AlertTriangle, BarChart3, Boxes, CircuitBoard, ListChecks, PackageSearch, RefreshCw, Shield } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { useDashboardData, DASHBOARD_TIMEFRAMES } from '../hooks/useDashboardData'
import api from '../lib/api'
import { getSocket } from '../lib/socket'
import Button from '../components/ui/Button.jsx'

const metricCards = [
  {
    title: 'Total Detected Attacks',
    key: 'detectedAttacks',
    icon: Shield,
    accent: 'text-sky-600 bg-sky-50',
    description: 'Intrusion events TinyIDS automatically blocked across the fleet.',
    settingKey: 'total_detected_attacks',
  },
  {
    title: 'Total Packets Analyzed',
    key: 'packetsAnalyzed',
    icon: PackageSearch,
    accent: 'text-indigo-600 bg-indigo-50',
    description: 'Inbound packets inspected by ESP32 sensors and backend engines.',
    settingKey: 'total_packets_analyzed',
  },
  {
    title: 'Detection Accuracy (%)',
    key: 'detectionAccuracy',
    icon: BarChart3,
    accent: 'text-emerald-600 bg-emerald-50',
    description: 'Signal-to-noise ratio of detection rules for the selected window.',
    settingKey: 'detection_accuracy_pct',
  },
  {
    title: 'Device Activity (%)',
    key: 'deviceActivity',
    icon: Activity,
    accent: 'text-teal-600 bg-teal-50',
    description: 'Share of ESP32 units currently online and reporting telemetry.',
    settingKey: 'device_activity_pct',
  },
  {
    title: 'Alerts Triggered',
    key: 'alertsTriggered',
    icon: AlertTriangle,
    accent: 'text-amber-600 bg-amber-50',
    description: 'Automated notifications dispatched to analysts and systems.',
    settingKey: 'alerts_triggered',
  },
  // {
  //   title: 'Rule Activation (%)',
  //   key: 'ruleActivation',
  //   icon: ListChecks,
  //   accent: 'text-purple-600 bg-purple-50',
  //   description: 'Percentage of IDS signatures currently active across devices.',
  //   settingKey: 'rule_activation_pct',
  // },
  {
    title: 'Packets Captured',
    key: 'packetsCaptured',
    icon: Boxes,
    accent: 'text-rose-600 bg-rose-50',
    description: 'Raw traffic samples stored for retrospective analysis.',
    settingKey: 'packets_captured',
  },
]

const formatNumber = (value) => {
  if (value == null) return '--'
  if (value > 999999) return `${(value / 1000000).toFixed(1)}M`
  if (value > 999) return `${(value / 1000).toFixed(1)}K`
  return value.toLocaleString()
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
    lastManualRefresh,
  } = useDashboardData()
  const [widgetVisibility, setWidgetVisibility] = useState(defaultWidgetVisibility)
  const [refreshing, setRefreshing] = useState(false)

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
    const handleLogUpdate = () => {
      refresh()
    }
    socket.on('log:new', handleLogUpdate)
    return () => {
      socket.off('log:new', handleLogUpdate)
    }
  }, [refresh])

  const visibleMetricCards = useMemo(
    () => metricCards.filter(({ settingKey }) => widgetVisibility[settingKey] !== false),
    [widgetVisibility],
  )

  const contextDeviceName = selectedDevice?.device_name ?? 'All Devices'
  const contextMac = selectedDevice?.mac_address ?? '?'

  const handleDeviceChange = (event) => {
    setSelectedDeviceId(event.target.value)
  }

  const aggregatedOnline = metrics.devicesOnline ?? Math.floor((metrics.totals?.deviceActivity ?? 0) / 10)
  const totalDevices = metrics.deviceCount ?? Math.max(aggregatedOnline, devices.length)
  const nodesOnline = selectedDevice ? (selectedDevice.active ? 1 : 0) : aggregatedOnline
  const nodesDisplay = selectedDevice ? (selectedDevice.active ? 'Online' : 'Offline') : `${nodesOnline}/${totalDevices}`
  const alertsTriggered = metrics.totals?.alertsTriggered ?? 0
  const showTrendChart = widgetVisibility.detection_trend_pct !== false
  const showSensorCard = widgetVisibility.sensor_health_card !== false
  const showDataPipeline = widgetVisibility.data_pipeline_card !== false

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

    const metricRows = visibleMetricCards.map(({ title, key, description }) => {
      const rawValue = metrics.totals?.[key] ?? metrics.widgets?.[key]
      const isPercentage = key.includes('Accuracy') || key.includes('Activity') || key.includes('Activation')
      const displayValue =
        rawValue == null ? '--' : isPercentage ? `${rawValue}%` : formatNumber(rawValue)
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
                className="rounded-full border border-white/40 bg-white/30 px-4 py-2 text-sm font-medium text-white shadow-sm backdrop-blur transition hover:border-white focus:border-white focus:outline-none focus:ring-2 focus:ring-white/40"
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
                }}
              >
                <option value="all">All Devices</option>
                {devices.map((device) => (
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

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          className="border border-slate-200 bg-white text-slate-600 hover:border-indigo-400 hover:bg-indigo-50"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            try {
              await refresh()
            } finally {
              setRefreshing(false)
            }
          }}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh Dashboard'}
        </Button>
          <p className="text-xs text-slate-500">
            Last manual refresh:{' '}
            <span className="font-semibold">
              {lastManualRefresh ? new Date(lastManualRefresh).toLocaleTimeString() : 'Never'}
            </span>
          </p>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visibleMetricCards.map(({ title, key, icon: Icon, accent, description, settingKey }) => {
            const rawValue = metrics.totals?.[key] ?? metrics.widgets?.[key]
            const isPercentage = key.includes('Accuracy') || key.includes('Activity') || key.includes('Activation')
            const displayValue =
              rawValue == null ? '--' : isPercentage ? `${rawValue}%` : formatNumber(rawValue)

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
                    <p className="text-xs uppercase tracking-wide text-slate-500">Detection Trend</p>
                    <p className="text-lg font-semibold text-slate-900">Events observed via MQTT ingestion</p>
                  </div>
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

        {(showSensorCard || showDataPipeline) && (
          <section className={`mt-8 grid gap-6 ${showSensorCard && showDataPipeline ? 'md:grid-cols-2' : ''}`}>
            {showSensorCard && (
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <CircuitBoard className="h-10 w-10 text-slate-400" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">System Health</p>
                    <p className="text-lg font-semibold">Sensor Fleet Status</p>
                  </div>
                </div>
                <ul className="mt-4 space-y-3 text-sm">
                  <li className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                    <span className="text-slate-500">{selectedDevice ? 'Device Status' : 'ESP32 Nodes Online'}</span>
                    <span className="font-semibold text-slate-900">{nodesDisplay}</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                    <span className="text-slate-500">Rules Active</span>
                    <span className="font-semibold text-slate-900">{metrics.totals?.ruleActivation ?? '--'}%</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                    <span className="text-slate-500">Alerts Triggered (24h)</span>
                    <span className="font-semibold text-slate-900">{alertsTriggered}</span>
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

            {showDataPipeline && (
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <Activity className="h-10 w-10 text-slate-400" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Data Pipeline</p>
                    <p className="text-lg font-semibold">Packets &amp; Throughput</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                  <div className="rounded-xl border border-slate-100 px-4 py-3">
                    <p className="text-slate-500">Packets Captured</p>
                    <p className="text-xl font-semibold text-slate-900">
                      {formatNumber(metrics.totals?.packetsCaptured)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-100 px-4 py-3">
                    <p className="text-slate-500">Packets Analyzed</p>
                    <p className="text-xl font-semibold text-slate-900">
                      {formatNumber(metrics.totals?.packetsAnalyzed)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-100 px-4 py-3">
                    <p className="text-slate-500">Detection Accuracy</p>
                    <p className="text-xl font-semibold text-emerald-600">
                      {metrics.totals?.detectionAccuracy ?? '--'}%
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-100 px-4 py-3">
                    <p className="text-slate-500">Device Activity</p>
                    <p className="text-xl font-semibold text-sky-600">
                      {metrics.totals?.deviceActivity ?? '--'}%
                    </p>
                  </div>
                </div>
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

