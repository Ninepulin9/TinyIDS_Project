import { io } from 'socket.io-client'

const SOCKET_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? 'http://localhost:5000'

let socket

export const getSocket = () => {
  if (!socket) {
    socket = io(SOCKET_BASE_URL, {
      transports: ['websocket'],
    })
  }
  return socket
}
