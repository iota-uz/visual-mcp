import { makeFunctionReference } from "convex/server";

type InternalApi = typeof import("../../../convex/_generated/api.js").internal;

export const internal = new Proxy(
  {},
  {
    get: (_target, moduleName: string) =>
      new Proxy(
        {},
        {
          get: (_module, functionName: string) =>
            makeFunctionReference(`${moduleName}:${functionName}`),
        },
      ),
  },
) as InternalApi;
