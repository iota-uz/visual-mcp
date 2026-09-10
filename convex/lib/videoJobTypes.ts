import type { JobRequest } from "../../packages/video/src/jobs";
import type { Doc } from "../_generated/dataModel";
export type ClaimedVideoJob<K extends JobRequest["kind"] = JobRequest["kind"]> = Omit<
  Doc<"videoJobs">,
  "request"
> & { request: Extract<JobRequest, { kind: K }> };
