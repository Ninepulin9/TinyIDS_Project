const Card = ({ className = '', children }) => (
  <div className={`rounded-2xl bg-white shadow-lg p-6 ${className}`.trim()}>{children}</div>
)

export default Card
