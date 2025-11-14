import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import toast from 'react-hot-toast'

import useAuth from '../hooks/useAuth.js'
import api from '../lib/api'
import Card from '../components/ui/Card.jsx'
import Button from '../components/ui/Button.jsx'

const settingsSchema = z
  .object({
    username: z.string().trim().optional(),
    currentPassword: z.string().trim().optional(),
    newPassword: z.string().trim().optional(),
    confirmPassword: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.username && data.username.length === 0) {
      ctx.addIssue({
        path: ['username'],
        code: z.ZodIssueCode.custom,
        message: 'Username cannot be empty',
      })
    }

    const hasPasswordInput = data.currentPassword || data.newPassword || data.confirmPassword
    if (hasPasswordInput) {
      if (!data.currentPassword || data.currentPassword.length < 8) {
        ctx.addIssue({
          path: ['currentPassword'],
          code: z.ZodIssueCode.custom,
          message: 'Current password must be at least 8 characters',
        })
      }
      if (!data.newPassword || data.newPassword.length < 8) {
        ctx.addIssue({
          path: ['newPassword'],
          code: z.ZodIssueCode.custom,
          message: 'New password must be at least 8 characters',
        })
      }
      if (!data.confirmPassword || data.confirmPassword !== data.newPassword) {
        ctx.addIssue({
          path: ['confirmPassword'],
          code: z.ZodIssueCode.custom,
          message: 'Passwords do not match',
        })
      }
    }
  })

const UserSettingsPage = () => {
  const { user, updateUser } = useAuth()
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [initialUsername, setInitialUsername] = useState('')

  const form = useForm({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      username: '',
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  const errors = form.formState.errors

  const userId = user?.id ?? null

  useEffect(() => {
    const fetchProfile = async () => {
      setLoadingProfile(true)
      try {
        const { data } = await api.get('/api/users/me')
        if (data) {
          const resolvedUsername = data.username ?? user?.username ?? ''
          setInitialUsername(resolvedUsername)
          form.reset({
            username: resolvedUsername,
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
          })
          if (resolvedUsername && resolvedUsername !== (user?.username ?? '')) {
            updateUser((prev) => ({ ...prev, username: resolvedUsername }))
          }
        } else {
          throw new Error('Profile payload is empty')
        }
      } catch (err) {
        console.warn('Unable to load profile, falling back to auth context.', err)
        const fallback = {
          username: user?.username ?? 'operator',
        }
        setInitialUsername(fallback.username)
        form.reset({
          username: fallback.username,
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        })
      } finally {
        setLoadingProfile(false)
      }
    }

    fetchProfile()
  }, [form, updateUser, userId])

  const renderError = (error) =>
    error ? <p className="mt-1 text-xs text-rose-500">{error.message}</p> : null

  const handleSubmit = form.handleSubmit(async (values) => {
    const usernameChanged = values.username && values.username !== initialUsername
    const passwordPayload =
      values.currentPassword && values.newPassword && values.confirmPassword
        ? {
            currentPassword: values.currentPassword,
            newPassword: values.newPassword,
          }
        : null

    if (!usernameChanged && !passwordPayload) {
      toast('No changes detected', { icon: 'i' })
      return
    }

    try {
      if (usernameChanged) {
        const { data: updatedUser } = await api.put('/api/users/me', { username: values.username })
        const nextUsername = updatedUser?.username ?? values.username
        setInitialUsername(nextUsername)
        updateUser((prev) => ({ ...prev, ...(updatedUser ?? {}), username: nextUsername }))
        toast.success('Username updated')
      }

      if (passwordPayload) {
        await api.post('/api/users/me/password', passwordPayload)
        toast.success('Password changed successfully')
      }

      form.reset({
        username: values.username ?? initialUsername,
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
    } catch (err) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Unable to update settings. Please try again.'
      toast.error(message)
    }
  })

  return (
    <div className="min-h-screen space-y-6 bg-slate-100 px-4 pb-12 text-slate-900 sm:px-6" style={{ colorScheme: 'light' }}>
      <header className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-sky-500 px-6 py-6 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold sm:text-4xl">User Settings</h1>
          <p className="mt-2 text-sm text-white/80">
            Update your TinyIDS profile and rotate credentials securely.
          </p>
        </div>
      </header>

      <Card className="border border-slate-200 bg-white shadow-sm text-slate-900 sm:mx-auto sm:max-w-5xl">
        <h2 className="text-lg font-semibold text-slate-900">Profile &amp; Credentials</h2>
        <p className="text-sm text-slate-600">
          Update your display name or rotate console credentials. Leave fields blank to keep the current values.
        </p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-10">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Basic Details</p>
            <div className="max-w-md space-y-2">
              <label className="block text-sm font-medium text-slate-900">
                Username
                <input
                  {...form.register('username')}
                  placeholder={initialUsername}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </label>
              {renderError(errors.username)}
            </div>
          </div>

          <fieldset className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Password</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-900">
                  Current Password
                  <input
                    type="password"
                    {...form.register('currentPassword')}
                    placeholder="Leave blank to keep current password"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </label>
                {renderError(errors.currentPassword)}
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-900">
                  New Password
                  <input
                    type="password"
                    {...form.register('newPassword')}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </label>
                {renderError(errors.newPassword)}
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-medium text-slate-900">
                  Confirm New Password
                  <input
                    type="password"
                    {...form.register('confirmPassword')}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </label>
                {renderError(errors.confirmPassword)}
              </div>
            </div>
          </fieldset>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" disabled={form.formState.isSubmitting || loadingProfile}>
              Save Changes
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                form.reset({
                  username: initialUsername,
                  currentPassword: '',
                  newPassword: '',
                  confirmPassword: '',
                })
              }
            >
              Reset
            </Button>
          </div>
        </form>
      </Card>

    </div>
  )
}

export default UserSettingsPage
