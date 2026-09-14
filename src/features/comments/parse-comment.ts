/**
 * Turning a raw buyer comment into a reviewable action list.
 *
 * The case asks for AI to propose the list — and for a human to accept each item
 * before anything official exists. This module is the proposal engine only: it
 * never writes to the gateway. The merchandiser review table owns all writes.
 *
 * Two engines sit behind one interface:
 *
 *   - "blocks-ai-agent" — the project's Blocks AI agent (see the portal's AI
 *     Agents section). Preferred, and the one the case means by "AI".
 *   - "local-fallback"  — a deterministic Banglish garment lexicon. It exists so
 *     a cold agent (quota, missing onboarding, network) degrades into a slower
 *     demo instead of a dead one. The review table always shows WHICH engine
 *     produced a list, so a fallback is never passed off as the agent's work.
 */
import { env } from "@/lib/env";
import { getAccessToken } from "@/lib/auth-token";
import type { Department, IssueType, Severity } from "@/features/data/garment-schemas";

export interface ParsedAction {
  What: string;
  Part: string;
  Department: Department;
  Urgency: Severity;
  /** Suggested Issue.Type, so accepting a row needs no guessing. */
  IssueType: IssueType;
}

export interface ParseResult {
  items: ParsedAction[];
  engine: "blocks-ai-agent" | "local-fallback";
  engineNote?: string;
}

/* ------------------------------------------------------------------ agent */

/**
 * Query the configured Blocks AI agent.
 *
 * The endpoint is the portal's own (/blocksai-api/v1/ai-agent/query); the agent
 * id comes from VITE_BLOCKS_AI_AGENT_ID once the agent exists. Failures are
 * thrown to the caller — the UI decides whether to fall back, and says so.
 */
async function queryBlocksAgent(prompt: string, signal?: AbortSignal): Promise<string> {
  const agentId = (import.meta.env.VITE_BLOCKS_AI_AGENT_ID ?? "").trim();
  if (!agentId) throw new Error("No VITE_BLOCKS_AI_AGENT_ID configured");
  const token = getAccessToken();
  const res = await fetch(`${env.apiUrl}/blocksai-api/v1/ai-agent/query`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-blocks-key": env.projectKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ agentId, query: prompt, stream: false }),
  });
  if (!res.ok) {
    throw new Error(`Blocks AI agent ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { response?: string; output?: string; answer?: string };
  return data.response ?? data.output ?? data.answer ?? JSON.stringify(data);
}

/** Pull the first JSON array out of an agent reply, however it is wrapped. */
function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) throw new Error("Agent reply had no JSON list");
  return JSON.parse(text.slice(start, end + 1)) as unknown[];
}

const AGENT_PROMPT = (comment: string) =>
  "You are a garment factory quality coordinator. Read this knit-garment buyer comment " +
  "(it is often mixed Bangla and English, 'Banglish') and propose the corrective actions. " +
  "Reply with ONLY a JSON array, no prose. Each element: " +
  '{"What": string (imperative, e.g. "Reduce CB length by 1cm"), ' +
  '"Part": string (garment part), ' +
  '"Department": one of Pattern|Cutting|Dyeing|Sewing|Finishing|QA, ' +
  '"Urgency": one of Critical|High|Medium|Low, ' +
  '"IssueType": one of Shade|Stitch|Measurement|Trim|Finishing|Other}. ' +
  "Ignore praise ('thik ache', 'ok') — only problems become actions.\n\nCOMMENT:\n" + comment;

/* ------------------------------------------------------- local fallback */

interface PartRule {
  part: string;
  re: RegExp;
  issueType: IssueType;
  department: Department;
}

/** Ordered: the first matching rule owns the clause. 'collar tipping' before 'collar'. */
const PART_RULES: PartRule[] = [
  { part: "Collar tipping", re: /tipping/i, issueType: "Shade", department: "Dyeing" },
  { part: "CB length", re: /cb\s*length|center\s*back/i, issueType: "Measurement", department: "Pattern" },
  { part: "Body length", re: /body\s*length/i, issueType: "Measurement", department: "Pattern" },
  { part: "Sleeve", re: /sleeve|hatar/i, issueType: "Measurement", department: "Pattern" },
  { part: "Placket", re: /placket/i, issueType: "Measurement", department: "Pattern" },
  { part: "Collar", re: /collar|gala/i, issueType: "Measurement", department: "Pattern" },
  { part: "Cuff", re: /cuff/i, issueType: "Measurement", department: "Pattern" },
  { part: "Hem", re: /hem/i, issueType: "Measurement", department: "Pattern" },
  { part: "Neck tape", re: /neck/i, issueType: "Measurement", department: "Pattern" },
  { part: "Buttonhole", re: /button/i, issueType: "Trim", department: "Cutting" },
  { part: "Stitching", re: /stitch|suto|seam|seui/i, issueType: "Stitch", department: "Sewing" },
  { part: "Shade", re: /shad(e|ing)|colou?r|moyla|dag/i, issueType: "Shade", department: "Dyeing" },
  { part: "Finishing", re: /finishing|press|iron/i, issueType: "Finishing", department: "Finishing" },
  { part: "Trim", re: /trim|label|tag/i, issueType: "Trim", department: "Cutting" },
];

interface Direction { re: RegExp; toWhat: (part: string, qty?: string) => string }

const DIRECTIONS: Direction[] = [
  {
    re: /(\d+(?:\.\d+)?)\s*(cm|inch(?:es)?|")?\s*(kom|short|chhoto|komche|less)/i,
    toWhat: (p, q) => `${p} measures ${q} short — reduce by ${q}`,
  },
  {
    re: /(\d+(?:\.\d+)?)\s*(cm|inch(?:es)?|")?\s*(beshi|berai|long|boro|extra)/i,
    toWhat: (p, q) => `${p} measures ${q} long — increase by ${q}`,
  },
  { re: /wide|chaudio|bepat|pachta/i, toWhat: (p) => `${p} is wide — narrow it` },
  { re: /tight|fita|i?snug/i, toWhat: (p) => `${p} is tight — loosen it` },
  { re: /loose|dhila/i, toWhat: (p) => `${p} is loose — tighten it` },
  { re: /shad(e|ing)|colou?r|moyla|dag/i, toWhat: (p) => `${p} shows shading — match the approved swatch` },
  { re: /open|khe(ng)?e|gap/i, toWhat: (p) => `${p} shows gaps — correct the workmanship` },
  { re: /twist|bengka|baka/i, toWhat: (p) => `${p} is twisted — correct alignment` },
];

/** Praise and asides that must not become actions. */
const SKIP_CLAUSE = /thik\s*ache|thik\s*ase|ok(\s*ache)?|valo|good|perfect|no\s*problem|nice|bhalo/i;

function urgencyOf(clause: string): Severity {
  if (/ekdom|urgent|asap|serious|must|immediately/i.test(clause)) return "Critical";
  if (/\d+(\.\d+)?\s*(cm|inch|")/i.test(clause)) return "High";
  if (/ektu|little|slight|minor/i.test(clause)) return "Low";
  return "Medium";
}

function parseLocally(raw: string): ParsedAction[] {
  const clauses = raw
    .split(/[,.;!?]+|\bbut\b|\bkintu\b|\bar ki\b|\bohho\b/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 3 && !SKIP_CLAUSE.test(c));

  const out: ParsedAction[] = [];
  for (const clause of clauses) {
    const rule = PART_RULES.find((r) => r.re.test(clause));
    if (!rule) continue;
    const dir = DIRECTIONS.find((d) => d.re.test(clause));
    const m = clause.match(/(\d+(?:\.\d+)?)\s*(cm|inch(?:es)?|")?/i);
    const qty = m ? `${m[1]}${/inch/i.test(m[2] ?? "") ? "″" : "cm"}` : undefined;
    out.push({
      What: dir ? dir.toWhat(rule.part, qty) : `${rule.part} flagged by buyer — review spec`,
      Part: rule.part,
      Department: rule.department,
      Urgency: urgencyOf(clause),
      IssueType: rule.issueType,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ api */

export async function parseBuyerComment(rawText: string, signal?: AbortSignal): Promise<ParseResult> {
  const trimmed = rawText.trim();
  if (!trimmed) return { items: [], engine: "local-fallback", engineNote: "Empty comment" };
  try {
    const reply = await queryBlocksAgent(AGENT_PROMPT(trimmed), signal);
    const arr = extractJsonArray(reply);
    const items = arr.map((a): ParsedAction => {
      const o = a as Partial<ParsedAction>;
      return {
        What: String(o.What ?? "").trim(),
        Part: String(o.Part ?? "Unspecified").trim(),
        Department: (o.Department ?? "QA") as Department,
        Urgency: (o.Urgency ?? "Medium") as Severity,
        IssueType: (o.IssueType ?? "Other") as IssueType,
      };
    }).filter((a) => a.What);
    return { items, engine: "blocks-ai-agent" };
  } catch (e) {
    return {
      items: parseLocally(trimmed),
      engine: "local-fallback",
      engineNote: `Blocks AI agent unavailable (${e instanceof Error ? e.message : "error"}) — parsed with the built-in Banglish lexicon.`,
    };
  }
}
