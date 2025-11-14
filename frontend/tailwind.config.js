/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          400: '#60a5fa',
          500: '#2563eb',
          600: '#1e40af',
          700: '#1d4ed8'
        }
      }
    }
  },
  plugins: []
}
