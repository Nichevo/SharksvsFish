import { defineConfig } from "vite";

// Relative base so the build works on GitHub Pages under /<repo>/.
export default defineConfig({
  base: "./",
  build: {
    // Three.js (about 550 kB) is in its own chunk that only cube mode loads.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      // Ultra Enhanced is a separate page so the Classic and Enhanced app stays untouched.
      input: { main: "index.html", ultra: "ultra.html" },
    },
  },
});
