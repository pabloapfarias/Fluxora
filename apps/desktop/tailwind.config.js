/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#030303",
          deep: "#060606",
          surface: "#0b0b0d",
          elevated: "#111114",
          card: "#151518",
          input: "#0b0b0d",
          "card-hover": "#1a1a1f",
          primary: "#030303",
          hover: "#0b0b0d",
        },
        accent: {
          DEFAULT: "#7c5bf5",
          hover: "#9074f5",
          muted: "#5e41c4",
          soft: "rgba(124, 91, 245, 0.12)",
          ring: "rgba(124, 91, 245, 0.3)",
        },
        "accent-terminal": {
          DEFAULT: "#f5a524",
          muted: "rgba(245, 165, 36, 0.16)",
        },
        violet: {
          DEFAULT: "#7c5bf5",
          soft: "rgba(124, 91, 245, 0.12)",
        },
        success: {
          DEFAULT: "#22c55e",
          soft: "rgba(34, 197, 94, 0.12)",
        },
        warning: {
          DEFAULT: "#f5a524",
          soft: "rgba(245, 165, 36, 0.12)",
        },
        error: {
          DEFAULT: "#ff4d4d",
          soft: "rgba(255, 77, 77, 0.12)",
        },
        danger: {
          DEFAULT: "#ff4d4d",
          soft: "rgba(255, 77, 77, 0.12)",
        },
        "blue-info": "#38bdf8",
        text: {
          primary: "#f7f7f5",
          secondary: "#a6a6a6",
          muted: "#6f6f76",
          faint: "#4a4a52",
        },
        border: {
          DEFAULT: "rgba(255, 255, 255, 0.08)",
          subtle: "rgba(255, 255, 255, 0.08)",
          strong: "rgba(255, 255, 255, 0.16)",
          hover: "rgba(255, 255, 255, 0.16)",
        },
      },
      borderColor: {
        DEFAULT: "#243050",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "18px",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "0.55", transform: "scale(0.95)" },
          "50%": { opacity: "1", transform: "scale(1)" },
        },
        bar: {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        spin: {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        bar: "bar 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
