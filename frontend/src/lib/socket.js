import { io } from 'socket.io-client'

const resolveSocketBase = () => {
  const fromEnv = import.meta.env.VITE_WS_BASE_URL
  if (fromEnv && !fromEnv.includes('backend')) {
    return fromEnv
  }
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
  const port = import.meta.env.VITE_WS_PORT ?? '5000'
  return `${protocol}//${hostname}:${port}`
}

const SOCKET_BASE_URL = resolveSocketBase()

let socket

export const getSocket = () => {
  if (!socket) {
    socket = io(SOCKET_BASE_URL, {
      transports: ['polling'],
    })
  }
  return socket
}
