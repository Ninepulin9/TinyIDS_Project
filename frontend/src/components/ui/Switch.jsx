const Switch = ({
  checked = false,
  disabled = false,
  onChange,
  className = '',
  label,
  id,
}) => {
  const handleToggle = () => {
    if (disabled) return
    onChange?.(!checked)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleToggle()
    }
  }

  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
        checked ? 'bg-indigo-600' : 'bg-slate-300'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`.trim()}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default Switch
