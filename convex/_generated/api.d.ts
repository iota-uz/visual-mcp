/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as canvases from "../canvases.js";
import type * as http from "../http.js";
import type * as lib_artifactInfo from "../lib/artifactInfo.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bytes from "../lib/bytes.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_tokenFormat from "../lib/tokenFormat.js";
import type * as lib_worker from "../lib/worker.js";
import type * as mcp_tools from "../mcp/tools.js";
import type * as tokens from "../tokens.js";
import type * as users from "../users.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  canvases: typeof canvases;
  http: typeof http;
  "lib/artifactInfo": typeof lib_artifactInfo;
  "lib/auth": typeof lib_auth;
  "lib/bytes": typeof lib_bytes;
  "lib/hash": typeof lib_hash;
  "lib/slug": typeof lib_slug;
  "lib/tokenFormat": typeof lib_tokenFormat;
  "lib/worker": typeof lib_worker;
  "mcp/tools": typeof mcp_tools;
  tokens: typeof tokens;
  users: typeof users;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
