import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50:"#eef6ff",100:"#d9ebff",200:"#bcdcff",300:"#8ec6ff",400:"#59a6ff",500:"#3385fb",600:"#1f66f0",700:"#1a51dc",800:"#1c44b2",900:"#1d3d8c" },
        ink: { 50:"#f6f7f9",100:"#eceef2",200:"#d5d9e2",300:"#b0b8c9",400:"#8490a9",500:"#65728e",600:"#505b74",700:"#424a5e",800:"#394050",900:"#232834" },
      },
      boxShadow: { card: "0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1)" },
    },
  },
  plugins: [],
} satisfies Config;
