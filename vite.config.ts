import { defineConfig } from "vite";

// Relative base so the build works on GitHub Pages under /<repo>/.
export default defineConfig({
  base: "./",
  // Three.js (about 550 kB) is in its own chunk that only cube mode loads.
  build: { chunkSizeWarningLimit: 600 },
});
