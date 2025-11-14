const AuthHero = () => (
  <div className="flex flex-col items-center justify-between rounded-3xl bg-gradient-to-b from-brand-500 via-brand-600 to-slate-950 p-10 text-white shadow-2xl">
    <div className="w-full">
      <p className="text-sm uppercase tracking-[0.3em] text-white/80">TinyIDS</p>
      <h1 className="mt-3 text-3xl font-bold leading-tight">An Intrusion Detection System for Resource-Constrained Devices</h1>
      <p className="mt-4 text-sm text-white/80">
        Connect ESP32 sensors, stream MQTT telemetry, and block malicious actors from a single control plane.
      </p>
    </div>
    <div className="mt-10 w-full max-w-sm rounded-3xl bg-white/10 p-6 backdrop-blur">
      <svg
        viewBox="0 0 240 160"
        className="h-40 w-full text-white"
        role="img"
        aria-label="TinyIDS illustration"
      >
        <defs>
          <linearGradient id="shield" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9ed2ff" />
            <stop offset="100%" stopColor="#4c8dff" />
          </linearGradient>
        </defs>
        <rect x="5" y="90" width="80" height="45" rx="8" fill="none" stroke="currentColor" strokeWidth="6" />
        <circle cx="35" cy="112" r="6" fill="currentColor" />
        <rect x="95" y="40" width="130" height="100" rx="12" fill="none" stroke="currentColor" strokeWidth="6" />
        <line x1="110" y1="60" x2="210" y2="60" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <line x1="110" y1="90" x2="210" y2="90" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <line x1="110" y1="120" x2="210" y2="120" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <circle cx="55" cy="60" r="40" fill="url(#shield)" stroke="#e3f2ff" strokeWidth="6" />
        <polyline points="35,60 50,75 80,35" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="mt-4 text-sm leading-relaxed text-white/90">
        ESP32 → Mosquitto → Flask Socket.IO → Live dashboards. Harden your IoT edge without extra overhead.
      </p>
    </div>
  </div>
)

export default AuthHero
