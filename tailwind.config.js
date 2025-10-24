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
          50: "#091223",
          100: "#0c1a2f",
          200: "#0f243f",
          300: "#122d52",
          400: "#173a6f",
          500: "#1d4f96",
          600: "#2564bf",
          700: "#3d82e2",
          800: "#6ba8ff",
          900: "#cce4ff"
        }
      }
    },
  },
  plugins: [],
};
