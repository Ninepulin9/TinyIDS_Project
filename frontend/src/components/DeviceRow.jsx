import dayjs from 'dayjs'
import Badge from './ui/Badge.jsx'
import Toggle from './ui/Toggle.jsx'

const statusVariant = (status) => {
  if (!status) return 'muted'
  return status.toLowerCase() === 'connected' || status.toLowerCase() === 'online' ? 'success' : 'danger'
}

const DeviceRow = ({ device, aliveCheckAt, onEditWifi, onEditMqtt, onToggleActive, onDelete, onReregister, onRename, toggling = false }) => {
  const lastSeen = device?.last_seen ? dayjs(device.last_seen) : null
  const pendingWindowSec = 30
  const requestMoment = aliveCheckAt ? dayjs(aliveCheckAt) : null
  const awaitingAlive =
    Boolean(device?.token) &&
    !lastSeen &&
    requestMoment &&
    dayjs().diff(requestMoment, 'second') <= pendingWindowSec
  const isOnline = lastSeen ? dayjs().diff(lastSeen, 'minute') <= 30 : false
  const handleToggle = () => {
    onToggleActive?.(device)
  }
  const handleDelete = () => {
    onDelete?.(device)
  }
  const handleReregister = () => {
    onReregister?.(device)
  }

  return (
    <tr className="border-b border-slate-100 last:border-none hover:bg-slate-50/70 transition">
      <td
        className="px-4 py-4 align-middle text-sm font-semibold text-slate-900"
        onDoubleClick={() => onRename?.(device)}
        title="Double click to rename"
      >
        {device.device_name}
      </td>
      <td className="px-4 py-4 align-middle">
        <Badge variant={statusVariant(device.status)}>
          {device.active ? 'Alert ON' : 'Alert OFF'}
        </Badge>
        {device.last_seen && (
          <p className="mt-1 text-xs text-slate-400">Last seen {dayjs(device.last_seen).format('MMM D, YYYY HH:mm')}</p>
        )}
      </td>
      <td className="px-4 py-4 align-middle">
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
        <p className="mt-1 text-xs text-slate-400">
          {awaitingAlive ? 'Waiting for alive response' : 'Alive check within 30 min'}
        </p>
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
          label={`Toggle ${device.device_name} alert mode`}
        />
      </td>
      <td className="px-4 py-4 align-middle text-right pr-6 whitespace-nowrap">
        <button
          type="button"
          className="mr-2 rounded-full border border-sky-500 bg-white px-4 py-2 text-xs font-semibold text-sky-600 transition hover:bg-sky-50 hover:text-sky-700"
          onClick={handleReregister}
        >
          Re-register
        </button>
        <button
          type="button"
          className="rounded-full border border-rose-500 bg-white px-4 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 hover:text-rose-700"
          onClick={handleDelete}
        >
          Delete
        </button>
      </td>
    </tr>
  )
}

export default DeviceRow
