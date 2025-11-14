import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import toast from 'react-hot-toast'

import api from '../lib/api'
import Card from '../components/ui/Card.jsx'
import Button from '../components/ui/Button.jsx'
import TimeframeSelector from '../components/settings/TimeframeSelector.jsx'
import WidgetToggleGrid from '../components/settings/WidgetToggleGrid.jsx'

const timeframeOptions = [
  { value: 'seconds', label: 'Seconds' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
  { value: 'months', label: 'Months' },
]

const defaultSettings = {
  graph_timeframe: 'days',
  widgets: {
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
  },
}

const settingsSchema = z.object({
  graph_timeframe: z.enum(['seconds', 'minutes', 'hours', 'days', 'months']),
  widgets: z.object({
    total_detected_attacks: z.boolean(),
    total_packets_analyzed: z.boolean(),
    device_activity_pct: z.boolean(),
    alerts_triggered: z.boolean(),
    detection_accuracy_pct: z.boolean(),
    detection_trend_pct: z.boolean(),
    rule_activation_pct: z.boolean(),
    packets_captured: z.boolean(),
    threat_level_indicator: z.boolean(),
    sensor_health_card: z.boolean(),
    data_pipeline_card: z.boolean(),
  }),
})

const cloneSettings = (settings) => ({
  graph_timeframe: settings.graph_timeframe,
  widgets: { ...settings.widgets },
})

const normalizeSettings = (data) => {
  if (!data) {
    return cloneSettings(defaultSettings)
  }

  const validTimeframe = timeframeOptions.some((option) => option.value === data.graph_timeframe)
    ? data.graph_timeframe
    : defaultSettings.graph_timeframe

  return {
    graph_timeframe: validTimeframe,
    widgets: {
      ...defaultSettings.widgets,
      ...(data.widgets ?? {}),
    },
  }
}

const DashboardSettingsPage = () => {
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [initialSettings, setInitialSettings] = useState(() => cloneSettings(defaultSettings))
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { isDirty },
  } = useForm({
    resolver: zodResolver(settingsSchema),
    defaultValues: cloneSettings(defaultSettings),
  })

  const timeframe = watch('graph_timeframe')

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setFetchError('')
    try {
      const { data } = await api.get('/api/dashboard-settings/me')
      const normalized = normalizeSettings(data)
      setInitialSettings(cloneSettings(normalized))
      reset(normalized)
    } catch (err) {
      if (err?.response?.status === 404) {
        const defaults = cloneSettings(defaultSettings)
        setInitialSettings(defaults)
        reset(defaults)
      } else {
        const message =
          err?.response?.data?.message ??
          err?.message ??
          'Unable to load dashboard settings. Please try again later.'
        setFetchError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [reset])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleTimeframeChange = (nextValue) => {
    setValue('graph_timeframe', nextValue, { shouldDirty: true })
  }

  const dispatchUpdateEvent = (payload) => {
    window.dispatchEvent(new CustomEvent('dashboard:settings-updated', { detail: payload }))
  }

  const onSubmit = handleSubmit(async (values) => {
    setSaving(true)
    try {
      const { data } = await api.put('/api/dashboard-settings/me', values)
      const normalized = normalizeSettings(data)
      setInitialSettings(cloneSettings(normalized))
      reset(normalized)
      toast.success('Dashboard settings updated')
      dispatchUpdateEvent(normalized)
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to save dashboard settings. Please try again.'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  })

  const handleCancel = () => {
    reset(initialSettings)
  }

  const handleResetDefaults = async () => {
    const defaults = cloneSettings(defaultSettings)
    setResetting(true)
    try {
      const { data } = await api.put('/api/dashboard-settings/me', defaults)
      const normalized = normalizeSettings(data ?? defaults)
      setInitialSettings(cloneSettings(normalized))
      reset(normalized)
      toast.success('Settings reset to defaults')
      dispatchUpdateEvent(normalized)
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to reset to defaults. Please try again.'
      toast.error(message)
    } finally {
      setResetting(false)
    }
  }

  const actionButtonsDisabled = saving || resetting

  if (loading) {
    return (
      <div className="min-h-screen space-y-6 bg-slate-100 px-4 pb-12 sm:px-6">
        <Card className="animate-pulse border border-slate-200 !bg-white !text-slate-900 dark:!bg-white dark:!text-slate-900">
          <div className="h-5 w-32 rounded bg-slate-200" />
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="h-9 w-24 rounded-xl bg-slate-200" />
            <div className="h-9 w-24 rounded-xl bg-slate-200" />
            <div className="h-9 w-24 rounded-xl bg-slate-200" />
          </div>
        </Card>
        <Card className="animate-pulse border border-slate-200 !bg-white !text-slate-900 dark:!bg-white dark:!text-slate-900">
          <div className="h-5 w-40 rounded bg-slate-200" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="h-16 rounded-2xl bg-slate-200" />
            <div className="h-16 rounded-2xl bg-slate-200" />
            <div className="h-16 rounded-2xl bg-slate-200" />
            <div className="h-16 rounded-2xl bg-slate-200" />
          </div>
        </Card>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 pb-12 sm:px-6">
        <Card className="border border-slate-200 !bg-white !text-slate-900 dark:!bg-white dark:!text-slate-900">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Unable to load settings</h2>
              <p className="mt-1 text-sm text-slate-500">{fetchError}</p>
            </div>
            <Button variant="outline" onClick={loadSettings}>
              Retry
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen space-y-6 bg-slate-100 px-4 pb-12 text-slate-900 sm:px-6" style={{ colorScheme: 'light' }}>
      <header className="rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="mt-3 text-3xl font-semibold text-white">Dashboard Settings</h1>
            <p className="mt-1 text-sm text-white/80">
              Choose the timeframe and KPIs that matter most for your TinyIDS operations.
            </p>
          </div>
        </div>
      </header>

      <form className="space-y-6" onSubmit={onSubmit}>
        <Card className="border border-slate-200 bg-white shadow-sm !bg-white !text-slate-900 dark:!bg-white dark:!text-slate-900">
          <h2 className="text-lg font-semibold text-slate-900">Graph Time Frame</h2>
          <p className="mt-1 text-sm text-slate-600">
            Select the aggregation window TinyIDS uses across charts and analytics.
          </p>
          <div className="mt-4">
            <TimeframeSelector value={timeframe} onChange={handleTimeframeChange} options={timeframeOptions} />
          </div>
        </Card>

        <Card className="border border-slate-200 bg-white shadow-sm !bg-white !text-slate-900 dark:!bg-white dark:!text-slate-900">
          <h2 className="text-lg font-semibold text-slate-900">Dashboard Content</h2>
          <p className="mt-1 text-sm text-slate-600">
            Enable or disable KPI cards to tailor your operational view. Changes take effect immediately after saving.
          </p>
          <div className="mt-4">
            <WidgetToggleGrid control={control} disabled={actionButtonsDisabled} />
          </div>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" type="button" onClick={handleCancel} disabled={actionButtonsDisabled || !isDirty}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isDirty || actionButtonsDisabled}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleResetDefaults}
            disabled={actionButtonsDisabled}
          >
            {resetting ? 'Resetting...' : 'Reset to Defaults'}
          </Button>
        </div>
      </form>
    </div>
  )
}

export default DashboardSettingsPage
