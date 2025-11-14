import { Search } from 'lucide-react'
import DeviceRow from './DeviceRow.jsx'
import Button from './ui/Button.jsx'

const skeletonRows = Array.from({ length: 5 })

const DeviceTable = ({
  devices,
  loading,
  error,
  query,
  onQueryChange,
  onRetry,
  onEditWifi,
  onEditMqtt,
  onToggleActive,
  togglingId,
}) => (
  <div className="rounded-2xl bg-white p-6 shadow-lg">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Registered ESP32 Devices</h2>
        <p className="text-sm text-slate-500">Manage Wi-Fi, MQTT, and activation status across your TinyIDS fleet.</p>
      </div>
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange?.(event.target.value)}
          placeholder="Search by name or IP address..."
          className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      </div>
    </div>

    <div className="mt-6 overflow-x-auto">
      <table className="min-w-[820px] divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Device Name</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">IP Address</th>
            <th className="px-4 py-3">Wi-Fi</th>
            <th className="px-4 py-3">MQTT</th>
            <th className="px-4 py-3">Active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading &&
            skeletonRows.map((_, index) => (
              <tr key={index} className="animate-pulse">
                <td className="px-4 py-4">
                  <div className="h-4 w-32 rounded bg-slate-200" />
                </td>
                <td className="px-4 py-4">
                  <div className="h-5 w-20 rounded-full bg-slate-200" />
                </td>
                <td className="px-4 py-4">
                  <div className="h-4 w-28 rounded bg-slate-200" />
                </td>
                <td className="px-4 py-4">
                  <div className="h-9 w-16 rounded-lg bg-slate-200" />
                </td>
                <td className="px-4 py-4">
                  <div className="h-9 w-16 rounded-lg bg-slate-200" />
                </td>
                <td className="px-4 py-4">
                  <div className="h-6 w-12 rounded-full bg-slate-200" />
                </td>
              </tr>
            ))}

          {!loading && error && (
            <tr>
              <td colSpan="6" className="px-4 py-6 text-center text-sm text-rose-500">
                <div className="flex flex-col items-center gap-3">
                  <p>{error}</p>
                  <Button variant="outline" size="sm" onClick={onRetry}>
                    Retry Fetch
                  </Button>
                </div>
              </td>
            </tr>
          )}

          {!loading && !error && devices.length === 0 && (
            <tr>
              <td colSpan="6" className="px-4 py-8 text-center text-sm text-slate-500">
                No devices match your filters. Try adjusting your search or add a new device.
              </td>
            </tr>
          )}

          {!loading &&
            !error &&
            devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                onEditWifi={onEditWifi}
                onEditMqtt={onEditMqtt}
                onToggleActive={onToggleActive}
                toggling={togglingId === device.id}
              />
            ))}
        </tbody>
      </table>
    </div>
  </div>
)

export default DeviceTable
