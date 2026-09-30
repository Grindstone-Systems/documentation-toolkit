import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Production pages carry a restrictive content security policy: the app may
 * only load its own bundled files and never connects anywhere. The preview
 * iframe inherits it, so scripts inside a generated reference can't run there.
 * (Dev mode skips it because Vite injects inline scripts.) See docs/PRIVACY.md.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "documentation-toolkit-csp",
  apply: "build",
  transformIndexHtml: (html) => html.replace(/(<meta charset="UTF-8" \/>)/, `$1\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// Static build: everything runs client-side, so any static host works.
// BASE lets the same build serve from a sub-path (GitHub Pages: /documentation-toolkit/).
export default defineConfig({
  root: "app",
  base: process.env.BASE ?? "/",
  plugins: [react(), csp()],
  server: { host: "127.0.0.1", fs: { allow: [".."] } },
  preview: { host: "127.0.0.1" },
  worker: { format: "es" },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022", sourcemap: true },
});
