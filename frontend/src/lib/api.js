import axios from 'axios'

const resolveApiBase = () => {
  const fromEnv = import.meta.env.VITE_API_BASE_URL
  if (fromEnv && !fromEnv.includes('backend')) {
    return fromEnv
  }
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
  const port = import.meta.env.VITE_API_PORT ?? '5000'
  return `${protocol}//${hostname}:${port}`
}

export const api = axios.create({
  baseURL: resolveApiBase(),
  withCredentials: false,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('tinyids_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('tinyids_token')
      window.dispatchEvent(new CustomEvent('auth:logout'))
    }
    return Promise.reject(error)
  },
)

export const authApi = {
  login: (data) => api.post('/api/auth/login', data),
  register: (data) => api.post('/api/auth/register', data),
}

export default api
