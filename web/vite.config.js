import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The island is one script and one stylesheet with fixed names: the server-rendered page links them directly
// (/web/assets/topmenu.js, /web/assets/topmenu.css), so there is no manifest to read. The build lands in
// ../dist/web, next to the compiled server, and the main agent serves it from there.
export default defineConfig({
  plugins: [react()],
  base: "/web/",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: "src/main.jsx",
      output: {
        entryFileNames: "assets/topmenu.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) => (asset.names?.some((n) => n.endsWith(".css")) ? "assets/topmenu.css" : "assets/[name]-[hash][extname]"),
      },
    },
  },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js" },
});
