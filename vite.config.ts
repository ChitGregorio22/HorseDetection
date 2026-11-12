import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Older iPhones (iOS 14-16.3 Safari) don't understand some modern CSS that Tailwind 4 writes
// (oklch() colours, color-mix() see-through colours, nesting). Lightning CSS adds plain fallbacks
// for them when the site is built; newer browsers still use the original.
const v = (major: number, minor = 0) => (major << 16) | (minor << 8);
const cssTargets = { ios_saf: v(14), safari: v(14), chrome: v(90), android: v(90), firefox: v(90), samsung: v(15) };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  css: {
    lightningcss: { targets: cssTargets },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    cssMinify: "lightningcss",
    cssTarget: ["safari14", "ios14", "chrome90", "firefox90"],
    chunkSizeWarningLimit: 1500,
  },
});
