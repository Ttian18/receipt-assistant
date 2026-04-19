import { z } from "zod";
import "./common.js";

export const JobStatus = z
  .enum(["queued", "processing", "done", "error"])
  .openapi("JobStatus");

export const JobUploadResponse = z
  .object({
    jobId: z.string(),
    receiptId: z.string(),
    status: z.literal("processing"),
    stream: z.string().openapi({ example: "/jobs/abc/stream" }),
    poll: z.string().openapi({ example: "/jobs/abc" }),
  })
  .openapi("JobUploadResponse");

export const JobStatusResponse = z
  .object({
    jobId: z.string(),
    receiptId: z.string(),
    status: JobStatus,
    error: z.string().nullable(),
  })
  .openapi("JobStatusResponse");
