import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'brand-green': 'var(--color-botanical, #2D5A27)',
        botanical: 'var(--color-botanical, #2D5A27)',
        'brand-orange': 'var(--color-energy, #FF8C42)',
        energy: 'var(--color-energy, #FF8C42)',
        ivory: 'var(--color-ivory, #FDFBF7)',
        paper: 'var(--color-paper, #F7F7F2)',
        mist: 'var(--color-mist, #EEF4EC)',
        'accent-gold': 'var(--color-accent-gold, #D4A843)',
        'dark-bg': 'var(--color-dark-bg, #0F172A)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', ...defaultTheme.fontFamily.sans],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        soft: '0 2px 16px 0 rgb(0 0 0 / 0.08)',
        layered: '0 4px 32px 0 rgb(0 0 0 / 0.12)',
        lift: '0 18px 60px rgba(45, 90, 39, 0.18)',
      },
      backgroundImage: {
        grid: 'linear-gradient(rgba(45,90,39,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(45,90,39,0.04) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '40px 40px',
      },
      maxWidth: {
        container: '1200px',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'badge-pulse': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.03)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'badge-pulse': 'badge-pulse 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.5s ease-in-out',
      },
    },
  },
  plugins: [],
};

export default config;
