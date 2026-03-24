import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";
import { deckApiPlugin } from "./src/server/deckApi";

/**
 * Serve tikzjax .gz files as raw binary, bypassing sirv entirely.
 * sirv sets Content-Encoding: gzip for .gz files, causing the browser to
 * transparently decompress them. TikZJax's Worker expects raw .gz bytes
 * and decompresses via pako — double decompression causes Z_DATA_ERROR (-3).
 */
function tikzjaxGzFixPlugin(): Plugin {
  return {
    name: "tikzjax-gz-fix",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.includes("/tikzjax/") && req.url.endsWith(".gz")) {
          const filePath = path.join(__dirname, "public", req.url);
          if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath);
            res.writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Length": data.length,
              "Cache-Control": "no-cache",
            });
            res.end(data);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // For GitHub Pages: set VITE_BASE_PATH env var (e.g., "/deckode/")
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [
    tikzjaxGzFixPlugin(),
    react(),
    tailwindcss(),
    // Only load the Vite dev server API plugin during dev
    ...(command === "serve" ? [deckApiPlugin()] : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    watch: {
      ignored: [
        path.resolve(__dirname, "projects/**"),
      ],
    },
  },
  test: {
    globals: true,
    environment: "node",
    exclude: ["tests/**", "node_modules/**"],
  },
}));
