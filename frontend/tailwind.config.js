/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e6f0ff',
          100: '#cce0ff',
          200: '#99c2ff',
          300: '#66a3ff',
          400: '#3385ff',
          500: '#095AE9', // Main theme color
          600: '#0748ba',
          700: '#05368c',
          800: '#04245e',
          900: '#021230',
        },
      },
    },
  },
  plugins: [],
}
