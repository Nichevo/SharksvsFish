import { defineConfig } from "vite";

// Relative base so the build works on GitHub Pages under /<repo>/.
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      // Ultra Enhanced is a separate page so the Classic and Enhanced app stays untouched.
      input: { main: "index.html", ultra: "ultra.html" },
    },
  },
});
