const TimeframeSelector = ({ value, onChange, options }) => {
  const handleKeyDown = (event, optionValue) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChange(optionValue)
    }
  }

  return (
    <div role="radiogroup" aria-label="Graph time frame" className="flex flex-wrap gap-3">
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, option.value)}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 ${
              isActive
                ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 shadow-sm hover:border-indigo-300 hover:text-indigo-600'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default TimeframeSelector
