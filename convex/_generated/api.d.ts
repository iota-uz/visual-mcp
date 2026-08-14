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
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_artifactInfo from "../lib/artifactInfo.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bytes from "../lib/bytes.js";
import type * as lib_canvasRefs from "../lib/canvasRefs.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_purge from "../lib/purge.js";
import type * as lib_ref from "../lib/ref.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_tokenFormat from "../lib/tokenFormat.js";
import type * as lib_urls from "../lib/urls.js";
import type * as lib_worker from "../lib/worker.js";
import type * as mcp_instructions from "../mcp/instructions.js";
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
  crons: typeof crons;
  http: typeof http;
  "lib/artifactInfo": typeof lib_artifactInfo;
  "lib/auth": typeof lib_auth;
  "lib/bytes": typeof lib_bytes;
  "lib/canvasRefs": typeof lib_canvasRefs;
  "lib/hash": typeof lib_hash;
  "lib/purge": typeof lib_purge;
  "lib/ref": typeof lib_ref;
  "lib/slug": typeof lib_slug;
  "lib/tokenFormat": typeof lib_tokenFormat;
  "lib/urls": typeof lib_urls;
  "lib/worker": typeof lib_worker;
  "mcp/instructions": typeof mcp_instructions;
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
