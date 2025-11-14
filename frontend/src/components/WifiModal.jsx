import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'

import api from '../lib/api'
import Button from './ui/Button.jsx'

const wifiSchema = z
  .object({
    ssid: z.string().trim().min(1, 'SSID is required').max(32, 'SSID must be at most 32 characters'),
    password: z
      .string()
      .trim()
      .max(63, 'Password must be at most 63 characters')
      .optional(),
  })
  .refine((data) => !data.password || data.password.length === 0 || data.password.length >= 8, {
    path: ['password'],
    message: 'Password must be at least 8 characters when provided',
  })

const WifiModal = ({ device, open, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testOutcome, setTestOutcome] = useState(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    getValues,
  } = useForm({
    resolver: zodResolver(wifiSchema),
    defaultValues: {
      ssid: device?.wifi?.ssid ?? '',
      password: '',
    },
  })

  useEffect(() => {
    if (open && device) {
      reset({
        ssid: device.wifi?.ssid ?? '',
        password: '',
      })
      setTestOutcome(null)
    }
  }, [device, open, reset])

  if (!open || !device) {
    return null
  }

  const submitHandler = handleSubmit(async (values) => {
    setSaving(true)
    setTestOutcome(null)
    const payload = {
      ssid: values.ssid.trim(),
      password: values.password?.trim() ?? '',
    }

    try {
      const { data } = await api.patch(`/api/devices/${device.id}/wifi`, payload)
      toast.success('Wi-Fi configuration updated')
      if (data?.id) {
        onSaved?.(data)
      } else {
        onSaved?.({
          ...device,
          wifi: { ...(device.wifi ?? {}), ssid: payload.ssid },
        })
      }
      onClose?.()
    } catch (err) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        'Unable to update Wi-Fi configuration. Please try again.'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  })

  const handleTest = async () => {
    const values = getValues()
    const payload = {
      ssid: values.ssid?.trim() ?? '',
      password: values.password?.trim() ?? '',
    }

    setTesting(true)
    setTestOutcome(null)

    try {
      const { data } = await api.post(`/api/devices/${device.id}/wifi/test`, payload)
      const ok = Boolean(data?.ok)
      const message = data?.message ?? (ok ? 'Connection succeeded.' : 'Connection failed.')
      setTestOutcome({ ok, message })
      ok ? toast.success(message) : toast.error(message)
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Wi-Fi connection test failed. Please try again.'
      setTestOutcome({ ok: false, message })
      toast.error(message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <header>
          <h2 className="text-2xl font-semibold text-slate-900">Wi-Fi Configuration</h2>
          <p className="text-sm text-slate-500">Update network credentials for {device.device_name}.</p>
        </header>

        <form className="mt-5 space-y-4" onSubmit={submitHandler}>
          <div>
            <label htmlFor="wifi-ssid" className="text-sm font-medium text-slate-700">
              SSID
            </label>
            <input
              id="wifi-ssid"
              type="text"
              maxLength={32}
              className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                errors.ssid
                  ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                  : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-100'
              }`}
              placeholder="OfficeWiFi"
              {...register('ssid')}
            />
            {errors.ssid && <p className="mt-1 text-xs text-rose-500">{errors.ssid.message}</p>}
          </div>

          <div>
            <label htmlFor="wifi-password" className="text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="wifi-password"
              type="password"
              className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                errors.password
                  ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                  : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-100'
              }`}
              placeholder="********"
              autoComplete="new-password"
              {...register('password')}
            />
            {errors.password && <p className="mt-1 text-xs text-rose-500">{errors.password.message}</p>}
            <p className="mt-1 text-xs text-slate-400">Leave blank to keep the current passphrase.</p>
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

export default WifiModal
