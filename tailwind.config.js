/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
    "./src/app/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        beige: {
          50: "#faf7f2",
          100: "#f3ebdd",
          200: "#e7d8bd",
          300: "#d5bd92",
          400: "#c6a66e",
          500: "#b68f4a",
          600: "#9b783b",
          700: "#7c5f30",
          800: "#5f4724",
          900: "#4b381d"
        }
      }
    },
  },
  plugins: [],
};
