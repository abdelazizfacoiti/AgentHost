import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { type ScheduledJobActivationRequest, type ScheduledJobActivationReview, type ScheduledJobActivationSummary, type ScheduledJobReview, type ScheduledJobSpec } from "@agenthost/core";
const now = () => new Date().toISOString();
async function save(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, file); }
export class SchedulerStore {
  readonly #jobs: string; readonly #reviews: string; readonly #activations: string; readonly #activationReviews: string;
  constructor(home: string) { this.#jobs = path.join(home, "scheduler", "jobs"); this.#reviews = path.join(home, "scheduler", "reviews"); this.#activations = path.join(home, "scheduler", "activations"); this.#activationReviews = path.join(home, "scheduler", "activation-reviews"); }
  async ensureStructure() { await mkdir(this.#jobs, { recursive: true, mode: 0o700 }); await mkdir(this.#reviews, { recursive: true, mode: 0o700 }); await mkdir(this.#activations, { recursive: true, mode: 0o700 }); await mkdir(this.#activationReviews, { recursive: true, mode: 0o700 }); }
  async getJob(jobId: string) { return this.#read<ScheduledJobSpec>(this.#jobPath(jobId), "scheduler_job_not_found"); }
  async getReview(reviewId: string) { return this.#read<ScheduledJobReview>(this.#reviewPath(reviewId), "scheduler_review_not_found"); }
  async listJobs(status?: ScheduledJobSpec["status"]) { return (await this.#list<ScheduledJobSpec>(this.#jobs)).filter((x) => status === undefined || x.status === status).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async saveJob(job: ScheduledJobSpec) { const safeJob = { ...job, name: "[redacted]", description: "[redacted]", parametersSummary: job.parametersSummary.map((item) => ({ name: "[redacted]", provided: item.provided, redacted: true as const })) }; await save(this.#jobPath(job.jobId), safeJob); return safeJob; }
  async saveReview(review: ScheduledJobReview) { await save(this.#reviewPath(review.reviewId), review); return review; }
  async getActivation(activationRequestId: string) { return this.#read<ScheduledJobActivationRequest>(this.#activationPath(activationRequestId), "scheduler_activation_not_found"); }
  async getActivationReview(reviewId: string) { return this.#read<ScheduledJobActivationReview>(this.#activationReviewPath(reviewId), "scheduler_activation_review_not_found"); }
  async listActivations(input: { jobId?: string; status?: ScheduledJobActivationRequest["status"] } = {}) { return (await this.#list<ScheduledJobActivationRequest>(this.#activations)).filter((item) => (input.jobId === undefined || item.jobId === input.jobId) && (input.status === undefined || item.status === input.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async listActivationReviews(activationRequestId?: string) { return (await this.#list<ScheduledJobActivationReview>(this.#activationReviews)).filter((item) => activationRequestId === undefined || item.activationRequestId === activationRequestId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async saveActivation(request: ScheduledJobActivationRequest) { await save(this.#activationPath(request.activationRequestId), request); return request; }
  async saveActivationReview(review: ScheduledJobActivationReview) { await save(this.#activationReviewPath(review.reviewId), review); return review; }
  async latestActivationSummary(jobId: string): Promise<ScheduledJobActivationSummary | undefined> { const latest = (await this.listActivations({ jobId }))[0]; return latest === undefined ? undefined : { activationRequestId: latest.activationRequestId, status: latest.status, jobVersion: latest.jobVersion, updatedAt: latest.updatedAt, executable: false, scheduledExecutionEnabled: false, actualExecutionSupported: false }; }
  async activeActivation(jobId: string) { return (await this.listActivations({ jobId })).find((item) => item.status === "activation_review_required" || item.status === "activation_approved"); }
  async archive(jobId: string) { const job = await this.getJob(jobId); if (job.status !== "archived") { job.status = "archived"; job.archivedAt = now(); job.updatedAt = job.archivedAt; await this.saveJob(job); } return job; }
  async disable(jobId: string) { const job = await this.getJob(jobId); if (job.status !== "disabled" && job.status !== "archived") { job.status = "disabled"; job.updatedAt = now(); await this.saveJob(job); } return job; }
  #jobPath(id: string) { return path.join(this.#jobs, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); } #reviewPath(id: string) { return path.join(this.#reviews, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); } #activationPath(id: string) { return path.join(this.#activations, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); } #activationReviewPath(id: string) { return path.join(this.#activationReviews, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); }
  async #read<T>(file: string, code: string) { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { throw new Error(code); } }
  async #list<T>(dir: string) { const files = await readdir(dir, { withFileTypes: true }).catch(() => []); return Promise.all(files.filter((f) => f.isFile() && f.name.endsWith(".json")).map((f) => this.#read<T>(path.join(dir, f.name), "scheduler_record_invalid"))); }
}
