import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const Login = ({ onSubmit, loading: externalLoading }) => {
  const navigate = useNavigate()
  const [form, setForm] = useState({ identifier: '', password: '', remember: true })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [modal, setModal] = useState({ open: false, message: '' })

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    const performLogin = async () => {
      try {
        if (onSubmit) {
          await onSubmit({
            username: form.identifier.trim(),
            password: form.password,
            remember: form.remember,
          })
        } else {
          await new Promise((resolve) => setTimeout(resolve, 600))
        }

        setModal({ open: true, message: 'Login successful! Redirecting...' })
        setTimeout(() => {
          setModal({ open: false, message: '' })
          navigate('/dashboard')
        }, 1200)
      } catch (err) {
        const message =
          err?.response?.data?.message ??
          err?.message ??
          'Unable to sign in. Please check your credentials and try again.'
        setError(message)
        setLoading(false)
      } finally {
        if (!onSubmit) {
          setLoading(false)
        }
      }
    }

    performLogin()
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gray-100 px-8 py-16"
      style={{ colorScheme: 'light' }}
    >
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
            <h3 className="text-lg font-semibold text-emerald-600">Login Complete</h3>
            <p className="mt-2 text-sm text-slate-600">{modal.message}</p>
            <button
              type="button"
              onClick={() => setModal({ open: false, message: '' })}
              className="mt-5 w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
            >
              OK
            </button>
          </div>
        </div>
      )}
      <div className="flex h-auto w-full max-w-[1200px] min-h-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Left Panel - Blue Section */}
        <div className="hidden w-[48%] min-h-full flex-col bg-gradient-to-br from-blue-400 to-blue-500 p-10 text-white lg:flex">
          <div>
            <h1 className="text-4xl font-bold">TinyIDS</h1>
            <p className="mt-2 text-base font-medium leading-relaxed">
              An Intrusion Detection System for
              <br />
              Resource-Constrained Devices
            </p>
          </div>
          <div className="mt-auto flex flex-col items-center justify-center py-12">
            <img
              src="/assets/logo.png"
              alt="TinyIDS platform illustration"
              className="w-full max-w-sm object-contain drop-shadow-2xl"
            />
          </div>
        </div>

        {/* Right Panel - Login Form */}
        <div className="flex w-full flex-col justify-center bg-white px-10 py-14 lg:w-[52%] lg:px-14">
          <div className="mb-8 lg:-mt-24">
            <h2 className="text-5xl font-bold text-slate-900">Welcome to TinyIDS</h2>
            <p className="mt-2 text-sm text-gray-500">Secure IoT Intrusion Detection Dashboard</p>
          </div>

          <div className="space-y-4">
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
                  <path d="M3 7h18M3 7l9 6 9-6M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
                </svg>
                <input
                  id="identifier"
                  name="identifier"
                  value={form.identifier}
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

            <div className="flex items-center justify-between text-xs text-gray-600">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  name="remember"
                  checked={form.remember}
                  onChange={handleChange}
                  className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300"
                />
                <span>Remember me</span>
              </label>
              <button type="button" className="text-gray-600 hover:text-gray-800">
                Forgot password?
              </button>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="w-full rounded-lg bg-blue-500 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
          <div className="mt-6 border-t border-gray-200 pt-4 text-center text-xs text-gray-600">
            Don't have an account?{' '}
            <Link to="/register" className="font-semibold text-blue-500 hover:text-blue-600">
              Create your own
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
