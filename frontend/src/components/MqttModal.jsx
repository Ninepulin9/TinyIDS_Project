import { useEffect, useMemo, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'

import api from '../lib/api'
import Button from './ui/Button.jsx'
import Toggle from './ui/Toggle.jsx'

const hostRegex =
  /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$|^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

const mqttSchema = z.object({
  broker_host: z
    .string()
    .trim()
    .min(1, 'Broker host is required')
    .refine((value) => hostRegex.test(value), { message: 'Enter a valid hostname or IPv4 address' }),
  broker_port: z
    .coerce.number({ invalid_type_error: 'Port must be a number' })
    .int('Port must be an integer')
    .min(1, 'Port must be between 1 and 65535')
    .max(65535, 'Port must be between 1 and 65535'),
  username: z.string().trim().optional(),
  password: z.string().trim().optional(),
  client_id: z.string().trim().max(64, 'Client ID must be 64 characters or fewer').optional(),
  use_tls: z.coerce.boolean().default(false),
})

const makeClientId = (deviceId) => `tinyids-${deviceId}-${Math.random().toString(36).slice(2, 7)}`

const MqttModal = ({ device, open, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testOutcome, setTestOutcome] = useState(null)

  const defaultValues = useMemo(
    () => ({
      broker_host: device?.mqtt?.broker_host ?? '',
      broker_port: device?.mqtt?.broker_port ?? 1883,
      username: device?.mqtt?.username ?? '',
      password: '',
      client_id: device?.mqtt?.client_id ?? '',
      use_tls: Boolean(device?.mqtt?.use_tls),
    }),
    [device],
  )

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty },
    getValues,
    reset,
  } = useForm({
    resolver: zodResolver(mqttSchema),
    defaultValues,
  })

  useEffect(() => {
    if (open && device) {
      reset(defaultValues)
      setTestOutcome(null)
    }
  }, [defaultValues, device, open, reset])

  if (!open || !device) {
    return null
  }

  const buildPayload = (values) => {
    const clientId = values.client_id?.trim() || makeClientId(device.id)
    return {
      broker_host: values.broker_host.trim(),
      broker_port: values.broker_port,
      username: values.username?.trim() || '',
      password: values.password?.trim() || '',
      client_id: clientId,
      use_tls: Boolean(values.use_tls),
    }
  }

  const submitHandler = handleSubmit(async (values) => {
    setSaving(true)
    setTestOutcome(null)
    const payload = buildPayload(values)

    try {
      const { data } = await api.patch(`/api/devices/${device.id}/mqtt`, payload)
      toast.success('MQTT configuration updated')
      if (data?.id) {
        onSaved?.(data)
      } else {
        onSaved?.({
          ...device,
          mqtt: {
            ...(device.mqtt ?? {}),
            broker_host: payload.broker_host,
            broker_port: payload.broker_port,
            username: payload.username,
            client_id: payload.client_id,
            use_tls: payload.use_tls,
          },
        })
      }
      onClose?.()
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to update MQTT configuration. Please try again.'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  })

  const handleTest = async () => {
    const values = getValues()
    const payload = buildPayload(values)
    setTesting(true)
    setTestOutcome(null)

    try {
      const { data } = await api.post(`/api/devices/${device.id}/mqtt/test`, payload)
      const ok = Boolean(data?.ok)
      const message = data?.message ?? (ok ? 'MQTT broker reachable.' : 'MQTT connection failed.')
      setTestOutcome({ ok, message })
      ok ? toast.success(message) : toast.error(message)
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'MQTT connection test failed. Please try again.'
      setTestOutcome({ ok: false, message })
      toast.error(message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <header>
          <h2 className="text-2xl font-semibold text-slate-900">MQTT Configuration</h2>
          <p className="text-sm text-slate-500">Configure MQTT connectivity for {device.device_name}.</p>
        </header>

        <form className="mt-5 space-y-4" onSubmit={submitHandler}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="mqtt-broker-host" className="text-sm font-medium text-slate-700">
                Broker Host
              </label>
              <input
                id="mqtt-broker-host"
                type="text"
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  errors.broker_host
                    ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                    : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-100'
                }`}
                placeholder="broker.example.io"
                {...register('broker_host')}
              />
              {errors.broker_host && <p className="mt-1 text-xs text-rose-500">{errors.broker_host.message}</p>}
            </div>
            <div>
              <label htmlFor="mqtt-broker-port" className="text-sm font-medium text-slate-700">
                Broker Port
              </label>
              <input
                id="mqtt-broker-port"
                type="number"
                min="1"
                max="65535"
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  errors.broker_port
                    ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                    : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-100'
                }`}
                placeholder="1883"
                {...register('broker_port', { valueAsNumber: true })}
              />
              {errors.broker_port && <p className="mt-1 text-xs text-rose-500">{errors.broker_port.message}</p>}
            </div>
            <div>
              <label htmlFor="mqtt-client-id" className="text-sm font-medium text-slate-700">
                Client ID
              </label>
              <input
                id="mqtt-client-id"
                type="text"
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  errors.client_id
                    ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                    : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-100'
                }`}
                placeholder={`tinyids-${device.id}-abc12`}
                {...register('client_id')}
              />
              {errors.client_id && <p className="mt-1 text-xs text-rose-500">{errors.client_id.message}</p>}
              <p className="mt-1 text-xs text-slate-400">Leave blank to auto-generate a unique client ID.</p>
            </div>
            <div>
              <label htmlFor="mqtt-username" className="text-sm font-medium text-slate-700">
                Username
              </label>
              <input
                id="mqtt-username"
                type="text"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="tinyids"
                {...register('username')}
              />
            </div>
            <div>
              <label htmlFor="mqtt-password" className="text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                id="mqtt-password"
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="********"
                {...register('password')}
              />
              <p className="mt-1 text-xs text-slate-400">Leave blank to keep the existing password.</p>
            </div>
            <div className="flex items-center gap-3">
              <Controller
                name="use_tls"
                control={control}
                render={({ field }) => (
                  <Toggle
                    checked={Boolean(field.value)}
                    onChange={(value) => field.onChange(value)}
                    label="Use TLS encryption"
                  />
                )}
              />
              <div>
                <p className="text-sm font-medium text-slate-700">Use TLS</p>
                <p className="text-xs text-slate-400">Enable secure MQTT over TLS/SSL.</p>
              </div>
            </div>
          </div>

          {testOutcome && (
            <div
              className={`rounded-xl px-3 py-2 text-sm ${
                testOutcome.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
              }`}
            >
              {testOutcome.message}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between sm:gap-3">
            <Button
              variant="secondary"
              type="button"
              onClick={handleTest}
              disabled={saving || testing}
              className="sm:flex-1"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </Button>
            <div className="flex flex-col gap-2 sm:flex-1 sm:flex-row">
              <Button variant="ghost" type="button" onClick={onClose} disabled={saving || testing} className="sm:flex-1">
                Cancel
              </Button>
              <Button type="submit" disabled={saving || testing || !isDirty} className="sm:flex-1">
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default MqttModal
