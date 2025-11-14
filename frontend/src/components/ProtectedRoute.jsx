import { Navigate, useLocation } from 'react-router-dom'

const ProtectedRoute = ({ isAllowed, redirectPath = '/login', children }) => {
  const location = useLocation()
  if (!isAllowed) {
    return <Navigate to={redirectPath} replace state={{ from: location }} />
  }
  return children
}

export default ProtectedRoute
