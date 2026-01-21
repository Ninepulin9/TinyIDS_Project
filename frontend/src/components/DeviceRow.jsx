import dayjs from 'dayjs'
import Badge from './ui/Badge.jsx'
import Toggle from './ui/Toggle.jsx'

const statusVariant = (status) => {
  if (!status) return 'muted'
  return status.toLowerCase() === 'connected' ? 'success' : 'danger'
}

const DeviceRow = ({ device, onEditWifi, onEditMqtt, onToggleActive, toggling = false }) => {
  const handleToggle = () => {
    onToggleActive?.(device)
  }

  return (
    <tr className="border-b border-slate-100 last:border-none hover:bg-slate-50/70 transition">
      <td className="px-4 py-4 align-middle text-sm font-semibold text-slate-900">{device.device_name}</td>
      <td className="px-4 py-4 align-middle">
        <Badge variant={statusVariant(device.status)}>{device.status ?? 'Unknown'}</Badge>
        {device.last_seen && (
          <p className="mt-1 text-xs text-slate-400">Last seen {dayjs(device.last_seen).format('MMM D, YYYY HH:mm')}</p>
        )}
      </td>
      <td className="px-4 py-4 align-middle text-sm text-slate-600">
        <div className="font-medium text-slate-700">{device.ip_address ?? '--'}</div>
        {device.mac_address && <p className="text-xs text-slate-400">MAC {device.mac_address}</p>}
      </td>
      <td className="px-4 py-4 align-middle hidden">
        <span className="text-xs text-slate-400">Coming soon</span>
      </td>
      <td className="px-4 py-4 align-middle hidden">
        <span className="text-xs text-slate-400">Coming soon</span>
      </td>
      <td className="px-4 py-4 align-middle">
        <Toggle
          checked={Boolean(device.active)}
          onChange={handleToggle}
          disabled={toggling}
          label={`Toggle ${device.device_name} active`}
        />
      </td>
    </tr>
  )
}

export default DeviceRow
