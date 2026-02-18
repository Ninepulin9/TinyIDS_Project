import dayjs from 'dayjs'
import { Pencil } from 'lucide-react'
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
      <td className="px-4 py-4 align-middle text-sm font-semibold text-slate-900">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900">{device.device_name}</span>
          <button
            type="button"
            onClick={() => onRename?.(device)}
            title="Rename"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-sky-300 hover:text-sky-600"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
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
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              IP
            </span>
            {device.ip_address ? (
              <span className="font-mono text-sm font-semibold text-slate-800">
                {device.ip_address}
              </span>
            ) : device.mac_address ? (
              <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300" />
                Loading...
              </span>
            ) : (
              <span className="font-mono text-sm font-semibold text-slate-500">--</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              MAC
            </span>
            <span className="font-mono text-xs font-semibold text-slate-600">
              {device.mac_address ?? '--'}
            </span>
          </div>
        </div>
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
      <td className="px-4 py-4 align-middle">
        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
          <button
            type="button"
            className="rounded-full border border-sky-500 bg-white px-4 py-2 text-xs font-semibold text-sky-600 transition hover:bg-sky-50 hover:text-sky-700"
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
        </div>
      </td>
    </tr>
  )
}

export default DeviceRow
