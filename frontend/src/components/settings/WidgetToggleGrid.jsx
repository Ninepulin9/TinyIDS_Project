import { Controller } from 'react-hook-form'
import { Info } from 'lucide-react'

import Switch from '../ui/Switch.jsx'

const widgetDescriptions = {
  alerts_triggered: {
    label: 'Alerts Triggered',
    description: 'Count of alert notifications generated in the selected window.',
  },
  detection_trend_pct: {
    label: 'Detection Trend (%)',
    description: 'Day-over-day swing in detection accuracy to monitor drift.',
  },
  packets_captured: {
    label: 'Packets Captured',
    description: 'Raw packets collected before preprocessing for IDS analysis.',
  },
  sensor_health_card: {
    label: 'Sensor Fleet Status',
    description: 'Card summarizing online devices, rules active, and recent alerts.',
  },
  data_pipeline_card: {
    label: 'Packets & Throughput',
    description: 'Shows packet capture/analysis counts and detection accuracy.',
  },
}

const WidgetToggleGrid = ({ control, disabled = false }) => (
  <div className="grid gap-4 sm:grid-cols-2">
    {Object.entries(widgetDescriptions).map(([key, meta]) => (
      <Controller
        key={key}
        name={`widgets.${key}`}
        control={control}
        render={({ field }) => {
          const isEnabled = Boolean(field.value)
          return (
            <div
              className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition shadow-sm focus-within:ring-2 focus-within:ring-indigo-100 ${
                isEnabled
                  ? 'border-indigo-200 bg-indigo-50'
                  : 'border-slate-200 bg-white hover:border-indigo-200'
              }`}
            >
              <Switch
                checked={isEnabled}
                onChange={(next) => field.onChange(next)}
                disabled={disabled}
                label={`Toggle ${meta.label}`}
                className="mt-1"
              />
              <div className="flex flex-1 flex-col text-left">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (disabled) return
                      field.onChange(!isEnabled)
                    }}
                    className="text-sm font-semibold text-slate-800 transition hover:text-indigo-600 focus:outline-none"
                    disabled={disabled}
                  >
                    {meta.label}
                  </button>
                  <Info className="h-4 w-4 text-slate-400" aria-hidden="true" title={meta.description} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{meta.description}</p>
              </div>
            </div>
          )
        }}
      />
    ))}
  </div>
)

export default WidgetToggleGrid
