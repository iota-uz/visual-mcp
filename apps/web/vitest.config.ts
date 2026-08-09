import { defineConfig } from "vitest/config";

// Deliberately no @vitejs/plugin-react here: vitest bundles its own Vite,
// whose Plugin type doesn't structurally match this repo's Vite version
// (see the removed `plugins: [react()]` line's tsc error before this
// comment existed) — and unlike vite.config.ts's dev/build server, tests
// don't need React Fast Refresh. esbuild's default JSX transform, driven
// by tsconfig.json's `jsx: "react-jsx"`, is enough to run .tsx test files.
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
