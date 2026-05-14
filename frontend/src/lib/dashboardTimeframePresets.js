export const DASHBOARD_TIMEFRAME_PRESETS = [
  { value: '60', label: '1 Hour', minutes: 60 },
  { value: '360', label: '6 Hours', minutes: 360 },
  { value: '720', label: '12 Hours', minutes: 720 },
  { value: '1440', label: '1 Day', minutes: 1440 },
  { value: '10080', label: '7 Days', minutes: 10080 },
  { value: '43200', label: '30 Days', minutes: 43200 },
]

export const DASHBOARD_TIMEFRAME_PRESET_VALUES = DASHBOARD_TIMEFRAME_PRESETS.map(({ value }) => value)
export const DEFAULT_DASHBOARD_TIMEFRAME_PRESET = '1440'

const presetByValue = new Map(DASHBOARD_TIMEFRAME_PRESETS.map((preset) => [preset.value, preset]))
const presetByMinutes = new Map(DASHBOARD_TIMEFRAME_PRESETS.map((preset) => [preset.minutes, preset]))

export const getDashboardTimeframeMinutes = (presetValue) =>
  presetByValue.get(String(presetValue))?.minutes ?? presetByValue.get(DEFAULT_DASHBOARD_TIMEFRAME_PRESET)?.minutes ?? 1440

export const getDashboardTimeframeLabel = (presetValue) =>
  presetByValue.get(String(presetValue))?.label ?? presetByValue.get(DEFAULT_DASHBOARD_TIMEFRAME_PRESET)?.label ?? '1 Day'

export const resolveDashboardTimeframePreset = (minutes) =>
  presetByMinutes.get(Number(minutes))?.value ?? DEFAULT_DASHBOARD_TIMEFRAME_PRESET
