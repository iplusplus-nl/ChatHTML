import { execFileSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolveBuildRevision } from "./server/buildRevision.js";

const appCommit = resolveBuildRevision({
  env: process.env,
  readGitCommit: () =>
    execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8"
    })
});

export default defineConfig({
  base: process.env.CHATHTML_BASE_PATH?.trim() || "/",
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit)
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      }
    }
  }
});
