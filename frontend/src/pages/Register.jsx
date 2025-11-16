import { useState, useMemo, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'

const ChecklistItem = ({ label, passed }) => (
  <li className={`flex items-center text-xs font-medium ${passed ? 'text-emerald-600' : 'text-rose-600'}`}>
    <span className="mr-2 flex h-4 w-4 items-center justify-center">
      {passed ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          className="h-4 w-4 text-emerald-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 10l3 3 7-7" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          className="h-4 w-4 text-rose-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 6l8 8m0-8-8 8" />
        </svg>
      )}
    </span>
    {label}
  </li>
)

const Register = () => {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [modal, setModal] = useState({ open: false, type: 'success', message: '' })

  useEffect(() => {
    localStorage.removeItem('tinyids_registered_emails')
  }, [])

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const passwordChecks = useMemo(
    () => ({
      length: form.password.length >= 8,
      upperLower: /(?=.*[a-z])(?=.*[A-Z])/.test(form.password),
      number: /[0-9]/.test(form.password),
      special: /[^A-Za-z0-9]/.test(form.password),
    }),
    [form.password],
  )

  const allChecksPassed = useMemo(() => Object.values(passwordChecks).every(Boolean), [passwordChecks])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    const normalizedEmail = form.email.trim().toLowerCase()
    if (!normalizedEmail) {
      const message = 'Email is required.'
      setError(message)
      setModal({ open: true, type: 'error', message })
      return
    }
    if (!allChecksPassed) {
      const message = 'Please make sure the password meets every requirement.'
      setError(message)
      setModal({ open: true, type: 'error', message })
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match')
      setModal({ open: true, type: 'error', message: 'Passwords do not match.' })
      return
    }
    setLoading(true)
    try {
      const payload = {
        username: form.username.trim(),
        email: normalizedEmail,
        password: form.password,
      }
      const { data } = await authApi.register(payload)

      if (data?.access_token) {
        localStorage.setItem('tinyids_token', data.access_token)
      }

      setModal({ open: true, type: 'success', message: 'Account created successfully!' })
      setTimeout(() => {
        setModal((prev) => ({ ...prev, open: false }))
        navigate('/login')
      }, 1200)
    } catch (registrationError) {
      const message =
        registrationError?.response?.data?.message ?? 'Registration failed. Please try again.'
      setError(message)
      setModal({ open: true, type: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  const closeModal = () => setModal((prev) => ({ ...prev, open: false }))

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 relative">
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div
            className={`w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl ${
              modal.type === 'success' ? 'bg-white text-emerald-700' : 'bg-white text-rose-700'
            }`}
          >
            <h3 className="text-lg font-semibold">
              {modal.type === 'success' ? 'Registration Complete' : 'Something went wrong'}
            </h3>
            <p className="mt-2 text-sm text-slate-600">{modal.message}</p>
            <button
              type="button"
              onClick={closeModal}
              className={`mt-6 w-full rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                modal.type === 'success' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600'
              } transition`}
            >
              OK
            </button>
          </div>
        </div>
      )}
      <div className="flex h-auto w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-lg">
        {/* Left Panel - Blue Section */}
        <div className="hidden w-[45%] flex-col bg-gradient-to-br from-blue-400 to-blue-500 p-8 text-white lg:flex">
          <div>
            <h1 className="text-4xl font-bold">TinyIDS</h1>
            <p className="mt-2 text-sm leading-relaxed">
              An Intrusion Detection System for
              <br />
              Resource-Constrained Devices
            </p>
          </div>
          <div className="mt-auto flex flex-col items-center justify-center py-8">
            <img
              src="/assets/logo.png"
              alt="TinyIDS illustration"
              className="w-full max-w-xs object-contain drop-shadow-2xl"
            />
            
          </div>
        </div>

        {/* Right Panel - Register Form */}
        <div className="flex w-full flex-col justify-center bg-white px-8 py-8 lg:w-[55%] lg:px-10">
          <div className="mb-4">
            <h2 className="text-3xl font-bold text-gray-900">Create your TinyIDS account</h2>
            <p className="mt-1 text-xs text-gray-600">Secure IOT Intrusion Detection Dashboard</p>
          </div>

          <div className="space-y-3">
            {error && (
              <p className="rounded-lg border border-red-400 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
            )}

            <div className="space-y-1">
              <div className="flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2.5 focus-within:border-blue-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="mr-2 h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  id="username"
                  name="username"
                  value={form.username}
                  onChange={handleChange}
                  placeholder="User name"
                  className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2.5 focus-within:border-blue-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="mr-2 h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 7h18M3 7l9 6 9-6M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
                </svg>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="Email Address"
                  className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2.5 focus-within:border-blue-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="mr-2 h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Password"
                  className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="ml-2 text-gray-400 transition hover:text-gray-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-5 0-9.27-3.11-11-7.5a11.78 11.78 0 0 1 4.46-5.44" />
                      <path d="M1 1l22 22" />
                      <path d="M9.53 9.53A3 3 0 0 0 12 15a3 3 0 0 0 2.47-4.78" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2.5 focus-within:border-blue-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="mr-2 h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  placeholder="Confirm password"
                  className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((prev) => !prev)}
                  className="ml-2 text-gray-400 transition hover:text-gray-600"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-5 0-9.27-3.11-11-7.5a11.78 11.78 0 0 1 4.46-5.44" />
                      <path d="M1 1l22 22" />
                      <path d="M9.53 9.53A3 3 0 0 0 12 15a3 3 0 0 0 2.47-4.78" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 text-xs">
              <ChecklistItem label="At least 8 characters" passed={passwordChecks.length} />
              <ChecklistItem label="Contains both uppercase and lowercase letters" passed={passwordChecks.upperLower} />
              <ChecklistItem label="Contains numbers" passed={passwordChecks.number} />
              <ChecklistItem label="Contains special characters (e.g., !@#$%^&*)" passed={passwordChecks.special} />
            </div>

            <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
              <div 
                className="h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 transition-all duration-300"
                style={{ 
                  width: `${(Object.values(passwordChecks).filter(Boolean).length / 4) * 100}%` 
                }}
              />
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !allChecksPassed}
              className="w-full rounded-lg bg-gradient-to-r from-blue-400 to-cyan-400 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Creating account...' : 'Sign up'}
            </button>
          </div>

          <div className="mt-6 border-t border-gray-200 pt-4 text-center text-xs text-gray-600">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-blue-500 hover:text-blue-600">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Register
