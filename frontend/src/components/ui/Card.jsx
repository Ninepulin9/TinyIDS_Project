const Card = ({ className = '', children }) => (
  <div className={`rounded-[1.75rem] bg-white p-7 shadow-lg ${className}`.trim()}>{children}</div>
)

export default Card
