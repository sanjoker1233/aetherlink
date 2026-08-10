import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        glass: {
          light: 'rgba(180,160,140,0.08)',
          medium: 'rgba(180,160,140,0.14)',
          heavy: 'rgba(180,160,140,0.22)',
          border: 'rgba(180,160,140,0.18)',
          dark: 'rgba(0,0,0,0.15)',
        },
        neon: {
          cyan: '#f59e0b',
          magenta: '#ea580c',
          violet: '#d97706',
          blue: '#3b82f6',
          green: '#059669',
          amber: '#d4a373',
          rose: '#e11d48',
        },
        surface: {
          dark: '#120c0a',
          card: '#1c1611',
          overlay: '#261e17',
        },
        mesh: {
          lora: '#059669',
          wifi: '#3b82f6',
          sat: '#d4a373',
          offline: '#6b7280',
        },
      },
      backdropBlur: {
        glass: '24px',
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(120, 80, 60, 0.25)',
        'glass-sm': '0 4px 16px 0 rgba(120, 80, 60, 0.18)',
        'glass-lg': '0 16px 48px 0 rgba(120, 80, 60, 0.30)',
        neon: '0 0 20px rgba(245, 158, 11, 0.25), 0 0 40px rgba(245, 158, 11, 0.08)',
        'neon-magenta': '0 0 20px rgba(234, 88, 12, 0.25), 0 0 40px rgba(234, 88, 12, 0.08)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
        shimmer: 'shimmer 2s linear infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-down': 'slide-down 0.3s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(180,160,140,0.08), rgba(180,160,140,0.04))',
        'neon-gradient': 'linear-gradient(135deg, #f59e0b, #d97706, #ea580c)',
        'mesh-gradient': 'linear-gradient(135deg, #120c0a 0%, #1c1611 50%, #120c0a 100%)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
