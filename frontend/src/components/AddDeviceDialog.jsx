import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'

import api from '../lib/api'
import Button from './ui/Button.jsx'
import Toggle from './ui/Toggle.jsx'

const ipv4Regex =
  /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

const addDeviceSchema = z.object({
  device_name: z.string().trim().min(1, 'Device name is required').max(60, 'Device name must be under 60 characters'),
  ip_address: z
    .string()
    .trim()
    .min(1, 'IP address is required')
    .refine((value) => ipv4Regex.test(value), { message: 'Enter a valid IPv4 address (e.g. 192.168.1.10)' }),
  active: z.coerce.boolean().default(true),
})

const AddDeviceDialog = ({ open, onClose, onCreated }) => {
  const [submitting, setSubmitting] = useState(false)

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm({
    resolver: zodResolver(addDeviceSchema),
    defaultValues: {
      device_name: '',
      ip_address: '',
      active: true,
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        device_name: '',
        ip_address: '',
        active: true,
      })
    }
  }, [open, reset])

  if (!open) {
    return null
  }

  const submitHandler = handleSubmit(async (values) => {
    setSubmitting(true)
    const payload = {
      device_name: values.device_name.trim(),
      ip_address: values.ip_address.trim(),
      active: Boolean(values.active),
    }

    try {
      const { data } = await api.post('/api/devices', payload)
      toast.success('Device registered successfully')
      onCreated?.(data)
      onClose?.()
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Unable to create device. Please try again.'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <header>
          <h2 className="text-2xl font-semibold text-slate-900">Add New ESP32 Device</h2>
          <p className="text-sm text-slate-500">Register a new TinyIDS sensor and bootstrap default configs.</p>
        </header>

        <form className="mt-5 space-y-4" onSubmit={submitHandler}>
          <div>
            <label htmlFor="device-name" className="text-sm font-medium text-slate-700">
              Device Name
            </label>
            <input
              id="device-name"
              type="text"
              maxLength={60}
              className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                errors.device_name
                  ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                  : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-100'
              }`}
              placeholder="TinyIDS Sensor"
              {...register('device_name')}
            />
            {errors.device_name && <p className="mt-1 text-xs text-rose-500">{errors.device_name.message}</p>}
          </div>

          <div>
            <label htmlFor="device-ip" className="text-sm font-medium text-slate-700">
              IP Address
            </label>
            <input
              id="device-ip"
              type="text"
              className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                errors.ip_address
                  ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                  : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-100'
              }`}
              placeholder="192.168.1.50"
              {...register('ip_address')}
            />
            {errors.ip_address && <p className="mt-1 text-xs text-rose-500">{errors.ip_address.message}</p>}
          </div>

          <div className="flex items-center gap-3">
            <Controller
              name="active"
              control={control}
              render={({ field }) => (
                <Toggle
                  checked={Boolean(field.value)}
                  onChange={(value) => field.onChange(value)}
                  label="Set device active"
                />
              )}
            />
            <div>
              <p className="text-sm font-medium text-slate-700">Activate Immediately</p>
              <p className="text-xs text-slate-400">Enable device participation in detection right after onboarding.</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
            <Button variant="ghost" type="button" onClick={onClose} disabled={submitting} className="sm:w-32">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="sm:w-40">
              {submitting ? 'Adding...' : 'Add Device'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddDeviceDialog

