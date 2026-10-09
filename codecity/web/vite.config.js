import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4477",
    },
    // The zone glob matcher is imported from ../lib/glob.mjs (shared with the hooks) rather
    // than copied, so the dev server must be allowed to serve files above web/.
    fs: { allow: [".."] },
  },
  test: {
    environment: "node",
  },
});
