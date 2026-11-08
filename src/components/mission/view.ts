import type { Job, Step } from "./types";

// Everything the agents write into the JSON columns is read here, defensively: a missing or oddly shaped field
// just drops out of the UI instead of throwing.

type Rec = Record<string, unknown>;

export const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** JSON columns arrive as strings from the SpacetimeDB client; a value that is already parsed passes through. */
export function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export type PlanItem = { id: string; text: string };
export type Plan = { items: PlanItem[]; criteria: string[] };

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return str(value);
  if (isRec(value)) return str(value.text) ?? str(value.title) ?? str(value.label) ?? str(value.step);
  return undefined;
}

export function readPlan(step: Step): Plan {
  const out = isRec(step.output) ? step.output : {};
  const raw = list(out.plan ?? out.items ?? out.steps);
  const items = raw.flatMap((entry, i): PlanItem[] => {
    const text = textOf(entry);
    if (!text) return [];
    const id = isRec(entry) ? (str(entry.id) ?? `p${i + 1}`) : `p${i + 1}`;
    return [{ id, text }];
  });
  const criteria = list(out.criteria ?? out.success ?? out.successCriteria).flatMap((c) => textOf(c) ?? []);
  return { items, criteria };
}

export type Verdict = "approve" | "revise" | "reject";
export type CriticReading = { verdict: Verdict; reasons: string[]; revision?: number };

export function readCritic(step: Step): CriticReading | undefined {
  if (step.role !== "critic") return undefined;
  const out = isRec(step.output) ? step.output : {};
  const raw = str(out.verdict)?.toLowerCase() ?? "";
  const verdict: Verdict | undefined = /^(approve|accept|pass|ok)/.test(raw) ? "approve" : /^(reject|fail)/.test(raw) ? "reject" : /^(revise|revision|retry)/.test(raw) ? "revise" : undefined;
  if (!verdict) return undefined;
  const reasons = list(out.reasons ?? out.reason).flatMap((r) => textOf(r) ?? []);
  const single = str(out.reasons) ?? str(out.reason);
  return { verdict, reasons: reasons.length ? reasons : single ? [single] : [], revision: num(out.revision) };
}

export type RevisionChange = { revision: number; what?: string; metric?: string; from?: string; to?: string };

const show = (value: unknown): string | undefined => str(value) ?? (num(value) !== undefined ? String(value) : undefined);

/** An executor step that redoes earlier work after a critic said revise. */
export function readRevision(step: Step): RevisionChange | undefined {
  if (step.role === "critic" || !isRec(step.output)) return undefined;
  const revision = num(step.output.revision);
  if (revision === undefined) return undefined;
  const change = isRec(step.output.change) ? step.output.change : {};
  return { revision, what: str(change.what), metric: str(change.metric), from: show(change.from), to: show(change.to) };
}

export function revisionCount(steps: readonly Step[]): number {
  return steps.filter((s) => readCritic(s)?.verdict === "revise").length;
}

export function toolCallCount(steps: readonly Step[]): number {
  return steps.filter((s) => Boolean(s.tool)).length;
}

export function modelsOf(steps: readonly Step[]): string[] {
  return [...new Set(steps.flatMap((s) => (s.model ? [s.model] : [])))];
}

/** "nvidia/nemotron-nano-9b" and "Nemotron Lightning" both come out as something a person can read. */
export function prettyModel(model: string): string {
  const name = model.split("/").pop() ?? model;
  if (/\s/.test(name)) return name;
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bV(\d)/, "v$1");
}

function compact(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => compact(v)).join(", ");
  if (isRec(value)) {
    return Object.entries(value)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(" · ");
  }
  return "";
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** One line for a step's input or output: its own `summary`, else the flat fields. */
export function summarize(value: unknown, max = 140): string {
  const parsed = parseJson(value);
  if (isRec(parsed)) {
    const own = str(parsed.summary) ?? str(parsed.text) ?? str(parsed.message) ?? str(parsed.error);
    if (own) return truncate(own, max);
  }
  return truncate(compact(parsed), max);
}

export function rawJson(value: unknown): string {
  const parsed = parseJson(value);
  if (parsed === undefined || parsed === null || parsed === "") return "{}";
  try {
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return String(parsed);
  }
}

export type Verification = { label: string; ok: boolean };
export type BomLine = { part: string; store?: string; price: number; qty: number; url?: string };
export type LabTarget = { kind: "drone" | "board" | "robotics"; id: string };
export type MissionResult = {
  summary?: string;
  verification: Verification[];
  bom: BomLine[];
  budget?: number;
  total?: number;
  lab?: LabTarget;
};

const LAB_KINDS = ["drone", "board", "robotics"] as const;

function readBom(raw: unknown): BomLine[] {
  return list(raw).flatMap((entry): BomLine[] => {
    if (!isRec(entry)) return [];
    const part = str(entry.part) ?? str(entry.name) ?? str(entry.title);
    const price = num(entry.price) ?? num(Number(entry.price));
    if (!part || price === undefined) return [];
    const url = str(entry.url) ?? str(entry.link);
    return [{ part, store: str(entry.store) ?? str(entry.seller), price, qty: Math.max(1, Math.round(num(entry.qty) ?? 1)), url: url && /^https?:\/\//.test(url) ? url : undefined }];
  });
}

export function bomTotal(bom: readonly BomLine[]): number {
  return bom.reduce((sum, line) => sum + line.price * line.qty, 0);
}

export function readResult(raw: unknown): MissionResult | undefined {
  const parsed = parseJson(raw);
  if (!isRec(parsed)) return undefined;
  const verification = list(parsed.verification ?? parsed.checks).flatMap((entry): Verification[] => {
    if (typeof entry === "string") return [{ label: entry, ok: true }];
    if (!isRec(entry)) return [];
    const label = str(entry.label) ?? str(entry.name);
    return label ? [{ label, ok: entry.ok !== false && entry.passed !== false }] : [];
  });
  const bom = readBom(parsed.bom ?? parsed.parts);
  const labRaw = isRec(parsed.lab) ? parsed.lab : undefined;
  const kind = LAB_KINDS.find((k) => k === labRaw?.kind);
  const id = str(labRaw?.id);
  return {
    summary: str(parsed.summary),
    verification,
    bom,
    budget: num(parsed.budget),
    total: num(parsed.total) ?? (bom.length ? bomTotal(bom) : undefined),
    lab: kind && id && /^[a-z0-9-]+$/.test(id) ? { kind, id } : undefined,
  };
}

export type ProposalView = { title: string; detail?: string; delta?: string };

export function readProposal(kind: string, payload: unknown): ProposalView {
  const parsed = parseJson(payload);
  const rec = isRec(parsed) ? parsed : {};
  return {
    title: str(rec.title) ?? str(rec.summary) ?? kind.replace(/[_-]+/g, " "),
    detail: str(rec.detail) ?? str(rec.reason) ?? str(rec.description),
    delta: str(rec.delta) ?? str(rec.effect),
  };
}

/** Plan items a finished (ok) step points at with `planItem`. */
export function donePlanItems(steps: readonly Step[]): Set<string> {
  const done = new Set<string>();
  for (const step of steps) {
    if (step.status !== "ok" || !isRec(step.output)) continue;
    const id = str(step.output.planItem);
    if (id) done.add(id);
  }
  return done;
}

export function jobElapsed(job: Job, now: number): number {
  const end = job.status === "done" || job.status === "failed" || job.status === "cancelled" ? job.updatedAt : now;
  return Math.max(0, end - job.createdAt);
}

export function formatDuration(ms: number, locale: string): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatMoney(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(amount);
}
