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
  onToggleLed,
  onDelete,
  onRename,
  onRetoken,
  togglingId,
  ledStates = {},
  ledTogglingIds = new Set(),
  aliveCheckAt,
  nowTs,
  showHeader = true,
  withContainer = true,
}) => {
  const tableWrapperClass = `overflow-x-auto ${showHeader ? 'mt-6' : ''}`.trim()

  const headerContent = showHeader ? (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Registered Devices</h2>
        <p className="mt-1 text-[0.95rem] text-slate-500">Manage registration, Wi-Fi, MQTT, and activation status across your TinyIDS fleet.</p>
      </div>
      <div className="relative w-full sm:w-72 lg:w-80">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[1.1rem] w-[1.1rem] -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange?.(event.target.value)}
          placeholder="Search by name or IP address..."
          className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-base text-slate-700 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      </div>
    </div>
  ) : null

  const content = (
    <>
      {headerContent}
      <div className={tableWrapperClass}>
        <table className="w-full divide-y divide-slate-100 text-[0.95rem]">
          <thead className="bg-slate-50 text-left text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-5 py-3.5">Device Name</th>
              <th className="px-5 py-3.5">Device Status</th>
              <th className="px-5 py-3.5">Online Status</th>
              <th className="px-5 py-3.5">IP / MAC</th>
              <th className="px-5 py-3.5 hidden">Wi-Fi</th>
              <th className="px-5 py-3.5 hidden">MQTT</th>
              <th className="px-5 py-3.5">Alert Mode</th>
              <th className="px-5 py-3.5">LED Check</th>
              <th className="px-5 py-3.5 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading &&
              skeletonRows.map((_, index) => (
                <tr key={index} className="animate-pulse">
                  <td className="px-5 py-5">
                    <div className="h-5 w-36 rounded bg-slate-200" />
                  </td>
                  <td className="px-5 py-5">
                    <div className="h-7 w-24 rounded-full bg-slate-200" />
                  </td>
                  <td className="px-5 py-5">
                    <div className="h-5 w-28 rounded bg-slate-200" />
                  </td>
                  <td className="px-5 py-5">
                    <div className="h-5 w-32 rounded bg-slate-200" />
                  </td>
                  <td className="px-5 py-5">
                    <div className="h-10 w-20 rounded-xl bg-slate-200" />
                  </td>
                  <td className="px-5 py-5">
                    <div className="h-10 w-20 rounded-xl bg-slate-200" />
                  </td>
                  <td className="px-5 py-5">
                    <div className="h-7 w-16 rounded-full bg-slate-200" />
                  </td>
                  <td className="px-5 py-5">
                    <div className="ml-auto h-10 w-20 rounded-full bg-slate-200" />
                  </td>
                  <td className="px-5 py-5">
                    <div className="h-7 w-16 rounded-full bg-slate-200" />
                  </td>
                </tr>
              ))}

            {!loading && error && (
              <tr>
                <td colSpan="9" className="px-5 py-7 text-center text-base text-rose-500">
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
                <td colSpan="9" className="px-5 py-10 text-center text-base text-slate-500">
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
                  aliveCheckAt={aliveCheckAt}
                  onEditWifi={onEditWifi}
                  onEditMqtt={onEditMqtt}
                  onToggleActive={onToggleActive}
                  onToggleLed={onToggleLed}
                  onDelete={onDelete}
                  onRename={onRename}
                  onRetoken={onRetoken}
                  toggling={togglingId === device.id}
                  ledState={ledStates?.[device.id]}
                  ledToggling={ledTogglingIds?.has?.(device.id)}
                  nowTs={nowTs}
                />
              ))}
          </tbody>
        </table>
      </div>
    </>
  )

  if (withContainer) {
    return <div className="rounded-[1.75rem] bg-white p-7 shadow-lg">{content}</div>
  }

  return content
}

export default DeviceTable
