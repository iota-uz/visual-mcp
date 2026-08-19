import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/*
 * VITE_FIXTURES=1 swaps the two Convex client modules for in-memory fakes
 * (src/dev/fixtures/) so the app runs with no backend at all. It is an alias
 * rather than a runtime branch on purpose: the route files stay untouched,
 * and without the flag none of the fixture code is reachable from the module
 * graph, so it cannot end up in a production bundle. See
 * src/dev/fixtures/convexReact.ts for what it is for.
 */
export default defineConfig(({ mode }) => {
  const fixtures = loadEnv(mode, process.cwd(), "VITE_").VITE_FIXTURES === "1";
  const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

  const alias: Record<string, string> = {};
  if (fixtures) {
    alias["convex/react"] = local("./src/dev/fixtures/convexReact.ts");
    alias["@convex-dev/auth/react"] = local("./src/dev/fixtures/authReact.tsx");
  }

  return {
    plugins: [react()],
    server: { port: 5173 },
    resolve: { alias },
  };
});
