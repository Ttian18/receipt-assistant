import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { extractReceiptQuick, extractReceipt, type ClaudeReceiptQuickResult } from "./claude.js";
import { insertReceipt, type ReceiptData } from "./db.js";

// ── Job Store + Event Bus ────────────────────────────────────────────

export type JobStatus = "queued" | "quick_done" | "processing_full" | "done" | "error";

export interface JobEvent {
  type: "queued" | "quick_done" | "processing_full" | "done" | "error";
  data: any;
}

export interface Job {
  id: string;
  receiptId: string;
  imagePath: string;
  notes?: string;
  status: JobStatus;
  quickResult?: ClaudeReceiptQuickResult;
  fullResult?: ReceiptData;
  error?: string;
  createdAt: string;
}

const jobs = new Map<string, Job>();
const bus = new EventEmitter();
bus.setMaxListeners(100); // allow many SSE clients

const MAX_CONCURRENCY = parseInt(process.env.MAX_CLAUDE_CONCURRENCY || "3");
let running = 0;
const queue: string[] = [];

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

/**
 * Subscribe to events for a specific job.
 * Callback fires for each state change. Returns unsubscribe function.
 */
export function subscribeJob(jobId: string, cb: (event: JobEvent) => void): () => void {
  const handler = (event: JobEvent) => cb(event);
  bus.on(jobId, handler);
  return () => bus.off(jobId, handler);
}

function emit(jobId: string, event: JobEvent) {
  const job = jobs.get(jobId);
  if (job) job.status = event.type;
  bus.emit(jobId, event);
}

// ── Pipeline ─────────────────────────────────────────────────────────

async function runJob(jobId: string) {
  const job = jobs.get(jobId)!;

  try {
    // Phase 1: quick extraction
    const quick = await extractReceiptQuick(job.imagePath);
    job.quickResult = quick;
    emit(jobId, {
      type: "quick_done",
      data: { merchant: quick.merchant, date: quick.date, total: quick.total, currency: quick.currency },
    });

    // Phase 2: full extraction
    emit(jobId, { type: "processing_full", data: null });
    const full = await extractReceipt(job.imagePath);

    const receiptData: ReceiptData = {
      id: job.receiptId,
      ...full,
      image_path: job.imagePath,
      notes: job.notes ?? full.notes,
    };

    insertReceipt(receiptData);
    job.fullResult = receiptData;
    emit(jobId, { type: "done", data: receiptData });
  } catch (err: any) {
    job.error = err.message;
    emit(jobId, { type: "error", data: { error: err.message } });
  } finally {
    running--;
    drainQueue();
  }
}

function drainQueue() {
  while (running < MAX_CONCURRENCY && queue.length > 0) {
    const jobId = queue.shift()!;
    running++;
    runJob(jobId); // fire-and-forget
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Submit a receipt for two-phase extraction.
 * Returns immediately with jobId; results arrive via events.
 */
export function submitJob(imagePath: string, notes?: string): Job {
  const jobId = uuidv4();
  const receiptId = uuidv4();

  const job: Job = {
    id: jobId,
    receiptId,
    imagePath,
    notes,
    status: "queued",
    createdAt: new Date().toISOString(),
  };

  jobs.set(jobId, job);
  queue.push(jobId);
  emit(jobId, { type: "queued", data: { jobId, receiptId } });
  drainQueue();

  return job;
}
