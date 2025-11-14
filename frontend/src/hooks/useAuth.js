import { useCallback, useEffect, useState } from 'react'

import { authApi } from '../lib/api'

const loadStoredUser = () => {
  try {
    const stored = localStorage.getItem('tinyids_user')
    return stored ? JSON.parse(stored) : null
  } catch (err) {
    console.warn('Unable to parse cached user profile', err)
    return null
  }
}

const persistUser = (user) => {
  if (user) {
    localStorage.setItem('tinyids_user', JSON.stringify(user))
  } else {
    localStorage.removeItem('tinyids_user')
  }
}

export const useAuth = () => {
  const [user, setUser] = useState(loadStoredUser)
  const [loading, setLoading] = useState(false)

  const applyUserUpdate = useCallback((updater, { broadcast = true } = {}) => {
    setUser((prevUser) => {
      const nextUser = typeof updater === 'function' ? updater(prevUser) : updater
      persistUser(nextUser)
      if (broadcast && nextUser) {
        window.dispatchEvent(new CustomEvent('auth:user-updated', { detail: nextUser }))
      }
      return nextUser ?? null
    })
  }, [])

  const login = useCallback(
    async (credentials) => {
      setLoading(true)
      try {
        const { data } = await authApi.login(credentials)
        localStorage.setItem('tinyids_token', data.access_token)
        applyUserUpdate(() => data.user)
        return data.user
      } finally {
        setLoading(false)
      }
    },
    [applyUserUpdate],
  )

  const register = useCallback(
    async (payload) => {
      setLoading(true)
      try {
        const { data } = await authApi.register(payload)
        localStorage.setItem('tinyids_token', data.access_token)
        applyUserUpdate(() => data.user)
        return data.user
      } finally {
        setLoading(false)
      }
    },
    [applyUserUpdate],
  )

  const updateUser = useCallback(
    (updater) => {
      applyUserUpdate((prev = {}) => {
        const base = typeof prev === 'object' && prev !== null ? prev : {}
        if (typeof updater === 'function') {
          return updater(base)
        }
        return { ...base, ...(updater ?? {}) }
      })
    },
    [applyUserUpdate],
  )

  const logout = useCallback(
    ({ broadcast = true } = {}) => {
      localStorage.removeItem('tinyids_token')
      applyUserUpdate(() => null, { broadcast: false })
      if (broadcast) {
        window.dispatchEvent(new CustomEvent('auth:logout'))
      }
    },
    [applyUserUpdate],
  )

  useEffect(() => {
    const handleLogout = () => logout({ broadcast: false })
    const handleUserUpdated = (event) => {
      const detail = event.detail
      if (detail) {
        applyUserUpdate(() => detail, { broadcast: false })
      }
    }

    window.addEventListener('auth:logout', handleLogout)
    window.addEventListener('auth:user-updated', handleUserUpdated)

    return () => {
      window.removeEventListener('auth:logout', handleLogout)
      window.removeEventListener('auth:user-updated', handleUserUpdated)
    }
  }, [applyUserUpdate, logout])

  return {
    user,
    loading,
    token: localStorage.getItem('tinyids_token'),
    login,
    register,
    updateUser,
    logout,
    isAuthenticated: Boolean(user),
  }
}

export default useAuth

