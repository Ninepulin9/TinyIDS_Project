import { io } from 'socket.io-client'

const resolveSocketBaseUrl = () => {
  const envUrl = import.meta.env.VITE_WS_BASE_URL
  if (envUrl && !envUrl.includes('backend')) {
    return envUrl
  }
  if (typeof window === 'undefined') return 'http://localhost:5000'
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http'
  const port = import.meta.env.VITE_WS_PORT ?? '5000'
  return `${protocol}://${window.location.hostname}:${port}`
}

const SOCKET_BASE_URL = resolveSocketBaseUrl()

let socket

export const getSocket = () => {
  if (!socket) {
    socket = io(SOCKET_BASE_URL, {
      transports: ['websocket', 'polling'],
    })
  }
  return socket
}
