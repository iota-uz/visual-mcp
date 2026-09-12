/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentGateway from "../agentGateway.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as canvases from "../canvases.js";
import type * as comments from "../comments.js";
import type * as components_ from "../components.js";
import type * as crons from "../crons.js";
import type * as embedRender from "../embedRender.js";
import type * as embeds from "../embeds.js";
import type * as exports from "../exports.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as lib_artifactInfo from "../lib/artifactInfo.js";
import type * as lib_assetObjects from "../lib/assetObjects.js";
import type * as lib_assetRef from "../lib/assetRef.js";
import type * as lib_assetSecurity from "../lib/assetSecurity.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bytes from "../lib/bytes.js";
import type * as lib_canvasRefs from "../lib/canvasRefs.js";
import type * as lib_devAuth from "../lib/devAuth.js";
import type * as lib_embedCard from "../lib/embedCard.js";
import type * as lib_embedPlaceholder from "../lib/embedPlaceholder.js";
import type * as lib_embedRateLimit from "../lib/embedRateLimit.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_objectStore from "../lib/objectStore.js";
import type * as lib_purge from "../lib/purge.js";
import type * as lib_ref from "../lib/ref.js";
import type * as lib_renderWorkpool from "../lib/renderWorkpool.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_snapshotRender from "../lib/snapshotRender.js";
import type * as lib_staticRenderState from "../lib/staticRenderState.js";
import type * as lib_theme from "../lib/theme.js";
import type * as lib_tokenFormat from "../lib/tokenFormat.js";
import type * as lib_urls from "../lib/urls.js";
import type * as lib_videoAssetMetadata from "../lib/videoAssetMetadata.js";
import type * as lib_videoBytes from "../lib/videoBytes.js";
import type * as lib_videoCritiqueCompletion from "../lib/videoCritiqueCompletion.js";
import type * as lib_videoCritiqueLimits from "../lib/videoCritiqueLimits.js";
import type * as lib_videoDependencies from "../lib/videoDependencies.js";
import type * as lib_videoJobTypes from "../lib/videoJobTypes.js";
import type * as lib_videoLearningSchema from "../lib/videoLearningSchema.js";
import type * as lib_videoMigration from "../lib/videoMigration.js";
import type * as lib_videoObservability from "../lib/videoObservability.js";
import type * as lib_videoPersistence from "../lib/videoPersistence.js";
import type * as lib_videoProcessing from "../lib/videoProcessing.js";
import type * as lib_videoProviderAdapters from "../lib/videoProviderAdapters.js";
import type * as lib_videoPurge from "../lib/videoPurge.js";
import type * as lib_videoReviewSchema from "../lib/videoReviewSchema.js";
import type * as lib_videoWorkflow from "../lib/videoWorkflow.js";
import type * as lib_videoWorkflowSchema from "../lib/videoWorkflowSchema.js";
import type * as lib_worker from "../lib/worker.js";
import type * as migrations from "../migrations.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as staticRenders from "../staticRenders.js";
import type * as tokens from "../tokens.js";
import type * as users from "../users.js";
import type * as video from "../video.js";
import type * as videoCapabilities from "../videoCapabilities.js";
import type * as videoCritique from "../videoCritique.js";
import type * as videoCritiqueRecovery from "../videoCritiqueRecovery.js";
import type * as videoCritiqueRunner from "../videoCritiqueRunner.js";
import type * as videoDurationMigration from "../videoDurationMigration.js";
import type * as videoEvidence from "../videoEvidence.js";
import type * as videoExecuteRecovery from "../videoExecuteRecovery.js";
import type * as videoJobs from "../videoJobs.js";
import type * as videoLearning from "../videoLearning.js";
import type * as videoLearningFixtures from "../videoLearningFixtures.js";
import type * as videoMedia from "../videoMedia.js";
import type * as videoMigration from "../videoMigration.js";
import type * as videoProcessing from "../videoProcessing.js";
import type * as videoProviderRunner from "../videoProviderRunner.js";
import type * as videoProviders from "../videoProviders.js";
import type * as videoRecovery from "../videoRecovery.js";
import type * as videoRender from "../videoRender.js";
import type * as videoReview from "../videoReview.js";
import type * as videoShots from "../videoShots.js";
import type * as videoWorkflow from "../videoWorkflow.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentGateway: typeof agentGateway;
  assets: typeof assets;
  auth: typeof auth;
  canvases: typeof canvases;
  comments: typeof comments;
  components: typeof components_;
  crons: typeof crons;
  embedRender: typeof embedRender;
  embeds: typeof embeds;
  exports: typeof exports;
  http: typeof http;
  inbox: typeof inbox;
  "lib/artifactInfo": typeof lib_artifactInfo;
  "lib/assetObjects": typeof lib_assetObjects;
  "lib/assetRef": typeof lib_assetRef;
  "lib/assetSecurity": typeof lib_assetSecurity;
  "lib/auth": typeof lib_auth;
  "lib/bytes": typeof lib_bytes;
  "lib/canvasRefs": typeof lib_canvasRefs;
  "lib/devAuth": typeof lib_devAuth;
  "lib/embedCard": typeof lib_embedCard;
  "lib/embedPlaceholder": typeof lib_embedPlaceholder;
  "lib/embedRateLimit": typeof lib_embedRateLimit;
  "lib/hash": typeof lib_hash;
  "lib/objectStore": typeof lib_objectStore;
  "lib/purge": typeof lib_purge;
  "lib/ref": typeof lib_ref;
  "lib/renderWorkpool": typeof lib_renderWorkpool;
  "lib/slug": typeof lib_slug;
  "lib/snapshotRender": typeof lib_snapshotRender;
  "lib/staticRenderState": typeof lib_staticRenderState;
  "lib/theme": typeof lib_theme;
  "lib/tokenFormat": typeof lib_tokenFormat;
  "lib/urls": typeof lib_urls;
  "lib/videoAssetMetadata": typeof lib_videoAssetMetadata;
  "lib/videoBytes": typeof lib_videoBytes;
  "lib/videoCritiqueCompletion": typeof lib_videoCritiqueCompletion;
  "lib/videoCritiqueLimits": typeof lib_videoCritiqueLimits;
  "lib/videoDependencies": typeof lib_videoDependencies;
  "lib/videoJobTypes": typeof lib_videoJobTypes;
  "lib/videoLearningSchema": typeof lib_videoLearningSchema;
  "lib/videoMigration": typeof lib_videoMigration;
  "lib/videoObservability": typeof lib_videoObservability;
  "lib/videoPersistence": typeof lib_videoPersistence;
  "lib/videoProcessing": typeof lib_videoProcessing;
  "lib/videoProviderAdapters": typeof lib_videoProviderAdapters;
  "lib/videoPurge": typeof lib_videoPurge;
  "lib/videoReviewSchema": typeof lib_videoReviewSchema;
  "lib/videoWorkflow": typeof lib_videoWorkflow;
  "lib/videoWorkflowSchema": typeof lib_videoWorkflowSchema;
  "lib/worker": typeof lib_worker;
  migrations: typeof migrations;
  search: typeof search;
  seed: typeof seed;
  staticRenders: typeof staticRenders;
  tokens: typeof tokens;
  users: typeof users;
  video: typeof video;
  videoCapabilities: typeof videoCapabilities;
  videoCritique: typeof videoCritique;
  videoCritiqueRecovery: typeof videoCritiqueRecovery;
  videoCritiqueRunner: typeof videoCritiqueRunner;
  videoDurationMigration: typeof videoDurationMigration;
  videoEvidence: typeof videoEvidence;
  videoExecuteRecovery: typeof videoExecuteRecovery;
  videoJobs: typeof videoJobs;
  videoLearning: typeof videoLearning;
  videoLearningFixtures: typeof videoLearningFixtures;
  videoMedia: typeof videoMedia;
  videoMigration: typeof videoMigration;
  videoProcessing: typeof videoProcessing;
  videoProviderRunner: typeof videoProviderRunner;
  videoProviders: typeof videoProviders;
  videoRecovery: typeof videoRecovery;
  videoRender: typeof videoRender;
  videoReview: typeof videoReview;
  videoShots: typeof videoShots;
  videoWorkflow: typeof videoWorkflow;
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

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  renderWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"renderWorkpool">;
};
