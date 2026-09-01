/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#F2F9FD',
          100: '#E0F2FB',
          200: '#BCE3F6',
          300: '#8FD1F0',
          400: '#59C4E8',
          500: '#35ACE4',
          600: '#1C96CE',
          700: '#177CAB',
          800: '#125F82',
          900: '#0C3E55',
        },
        // CSS-variable-backed so these flip meaning under .dark without needing
        // dark: variants sprinkled through every className — see index.css.
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
        'surface-hover': 'var(--color-surface-hover)',
        border: 'var(--color-border)',
        ink: 'var(--color-text-primary)',
        'ink-secondary': 'var(--color-text-secondary)',
        'ink-tertiary': 'var(--color-text-tertiary)',
      },
    },
  },
  plugins: [],
}
