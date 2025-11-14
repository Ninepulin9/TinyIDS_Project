const variantClasses = {
  success: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  danger: 'bg-rose-100 text-rose-700 ring-rose-200',
  warning: 'bg-amber-100 text-amber-700 ring-amber-200',
  muted: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const Badge = ({ variant = 'muted', className = '', children }) => {
  const base = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset'
  const variantClass = variantClasses[variant] ?? variantClasses.muted

  return <span className={`${base} ${variantClass} ${className}`.trim()}>{children}</span>
}

export default Badge

