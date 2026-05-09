import Anthropic, { APIUserAbortError } from "@anthropic-ai/sdk";

import type { GitHubRepoAnalysis } from "@/lib/github";

export type ScorecardSectionBase = {
  score: number;
  headline: string;
  observation: string;
  flag: string | null;
};

export type TechnicalCredibilitySection = ScorecardSectionBase & {
  codeSpecific: string[];
};

export type VerdictSection = {
  score: null;
  headline: string;
  observation: string;
  flag: string | null;
};

export type JudgeReport = {
  overallScore: number;
  sections: {
    firstImpression: ScorecardSectionBase;
    valueProposition: ScorecardSectionBase;
    demoFlow: ScorecardSectionBase;
    technicalCredibility: TechnicalCredibilitySection;
    verdict: VerdictSection;
  };
  judgeQuote: string;
};

export type EvaluationTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: string;
};

export type EvaluationResult = JudgeReport & {
  tokenUsage: EvaluationTokenUsage;
  totalCost: number;
};

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model did not return JSON.");
    }
    const slice = trimmed.slice(start, end + 1);
    return JSON.parse(slice);
  }
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isStdSection(v: unknown): v is ScorecardSectionBase {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.score === "number" &&
    typeof o.headline === "string" &&
    typeof o.observation === "string" &&
    isNullableString(o.flag)
  );
}

function isTechnicalSection(v: unknown): v is TechnicalCredibilitySection {
  if (!isStdSection(v)) return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.codeSpecific)) return false;
  return o.codeSpecific.every((x) => typeof x === "string");
}

function isVerdictSection(v: unknown): v is VerdictSection {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.score !== null) return false;
  return (
    typeof o.headline === "string" &&
    typeof o.observation === "string" &&
    isNullableString(o.flag)
  );
}

function averageOverallScore(
  firstImpression: ScorecardSectionBase,
  valueProposition: ScorecardSectionBase,
  demoFlow: ScorecardSectionBase,
  technicalCredibility: ScorecardSectionBase,
): number {
  const sum =
    firstImpression.score +
    valueProposition.score +
    demoFlow.score +
    technicalCredibility.score;
  return Math.round(sum / 4);
}

function normalizeJudgeReport(raw: unknown): JudgeReport | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.judgeQuote !== "string") return null;
  if (!v.sections || typeof v.sections !== "object") return null;
  const s = v.sections as Record<string, unknown>;

  if (!isStdSection(s.firstImpression)) return null;
  if (!isStdSection(s.valueProposition)) return null;
  if (!isStdSection(s.demoFlow)) return null;
  if (!isTechnicalSection(s.technicalCredibility)) return null;
  if (!isVerdictSection(s.verdict)) return null;

  const firstImpression = s.firstImpression as ScorecardSectionBase;
  const valueProposition = s.valueProposition as ScorecardSectionBase;
  const demoFlow = s.demoFlow as ScorecardSectionBase;
  const technicalCredibility = s.technicalCredibility as TechnicalCredibilitySection;
  const codeSpecific = technicalCredibility.codeSpecific.slice(0, 5);

  const overallScore = averageOverallScore(
    firstImpression,
    valueProposition,
    demoFlow,
    technicalCredibility,
  );

  return {
    overallScore,
    judgeQuote: v.judgeQuote,
    sections: {
      firstImpression,
      valueProposition,
      demoFlow,
      technicalCredibility: {
        ...technicalCredibility,
        codeSpecific,
      },
      verdict: s.verdict as VerdictSection,
    },
  };
}

const TECHNICAL_ANALYSIS_INSTRUCTIONS = `
TECHNICAL ANALYSIS INSTRUCTIONS:
For the technicalCredibility section, you must look for these specific signals in the code provided. For each finding, name the exact file and what you found. Generic observations are not acceptable.

Check for these in order of severity:

CRITICAL (always flag if found):
- Hardcoded API keys or secrets: scan all files for patterns like sk-, pk-, Bearer, api_key =, apiKey: followed by a string literal
- Boilerplate README: does the README contain the phrase 'bootstrapped with create-next-app' or 'This is a Next.js project'
- Empty API routes: any route file that only returns a static object with no real logic (e.g. return Response.json({status:'ok'}))
- TODO or FIXME comments still present in production code

HIGH (flag if found):
- Console.log statements in API route files (not in comments)
- Missing try/catch in async API route handlers
- Dev dependencies that should be production: check if openai, anthropic, axios, or similar are under devDependencies in package.json instead of dependencies
- Placeholder text: 'Lorem ipsum', 'coming soon', 'not implemented' in visible UI files

MEDIUM (note if found):
- No .env.example file when the code references process.env (means other devs cannot run it)
- hasTests is false (no test files anywhere in the codebase)
- Single word or missing repo description

STACK HONESTY CHECK:
- List every AI/ML package found in package.json (openai, anthropic, langchain, huggingface, etc.)
- Cross-reference against what the README or demo claims to use
- Flag any mismatch: claims to use X but X is not in package.json

For codeSpecific, return max 5 items, each must follow this format:
'[SEVERITY] filename: specific finding'
Example: '[CRITICAL] app/api/analyze/route.ts: hardcoded Anthropic API key found on line starting with const client'
Example: '[HIGH] package.json: openai listed under devDependencies, will fail in production deployment'
Example: '[CRITICAL] README.md: still contains default create-next-app boilerplate — no project description'
`.trim();

const SECURITY_AND_RESILIENCE_ANALYSIS = `
SECURITY AND RESILIENCE ANALYSIS:
Check for these specific signals across all provided code files.
Every finding must name the exact file. No generic observations.

CRITICAL:
- API keys or tokens hardcoded in any file (patterns: sk-, pk-, Bearer , apiKey:, api_key =, token = followed by a string that is not process.env)
- Any API route that accepts user input without validation (no zod, no typeof checks, no length limits on incoming strings)
- Exposed sensitive routes with no authentication check (POST routes that anyone on the internet can call freely)

HIGH:
- No rate limiting on API routes (no upstash, no rate-limit package, no manual request counting visible anywhere)
- Missing error boundaries in the frontend (no try/catch around fetch calls in page components)
- Streaming endpoints with no timeout handling (fetch calls to external APIs with no AbortController or timeout)
- process.env variables used in code but no .env.example file exists (means the app only runs on the original developer's machine)

MEDIUM:
- console.log statements left in API route handlers
- No loading or error states visible in the UI code (silent failures look broken to judges)
- CORS set to wildcard on sensitive routes

For each security finding, add it to codeSpecific with format:
'[SECURITY-CRITICAL] filename: specific finding'
'[SECURITY-HIGH] filename: specific finding'
'[SECURITY-MEDIUM] filename: specific finding'

If no GitHub was provided, skip this section entirely and return codeSpecific as empty array.
`.trim();

function formatGitHubContext(g: GitHubRepoAnalysis): string {
  const apiBlock =
    g.apiRouteFiles.length > 0
      ? g.apiRouteFiles
          .map(
            (f) =>
              `--- API route: ${f.path} ---\n${f.content}`,
          )
          .join("\n\n")
      : "(no API route files fetched)";

  const guidanceBlock =
    g.guidanceFiles.length > 0
      ? g.guidanceFiles
          .map((f) => `--- ${f.path} ---\n${f.content}`)
          .join("\n\n")
      : "";

  const envBlock =
    g.envExampleContent != null
      ? `--- .env example (sample) ---\n${g.envExampleContent}`
      : "(no .env.example / .env.sample content fetched)";

  return (
    `README (first 3000 chars): ${g.readmeText}\n` +
    `File tree (sample, first 50 paths of ${g.totalFileCount} files):\n${g.fileTree.join("\n")}\n` +
    `package.json: ${g.packageJson ?? "null"}\n` +
    `Main entry point (${g.mainEntryPoint?.path ?? "null"}): ${g.mainEntryPoint?.content ?? "null"}\n` +
    `defaultBranch: ${g.defaultBranch}\n` +
    `lastCommitDate (repo updated_at): ${g.lastCommitDate}\n` +
    `totalFileCount: ${g.totalFileCount}\n` +
    `hasEnvExample: ${g.hasEnvExample}\n` +
    `hasTests: ${g.hasTests}\n\n` +
    `${envBlock}\n\n` +
    (guidanceBlock ? `${guidanceBlock}\n\n` : "") +
    `API route file contents (up to 10 files, 2000 chars each):\n${apiBlock}\n`
  );
}

export async function analyzeSubmission(input: {
  url: string;
  screenshotBase64: string;
  githubUrl?: string;
  githubAnalysis?: GitHubRepoAnalysis | null;
  mode?: "judge" | "builder";
  customCriteria?: string;
}): Promise<EvaluationResult> {
  try {
    const {
      url,
      screenshotBase64,
      githubUrl,
      githubAnalysis,
      mode,
      customCriteria,
    } = input;
    if (!url || !screenshotBase64) {
      throw new Error("Missing required input: url, screenshotBase64.");
    }

    const system =
      "You are a senior hackathon judge with experience evaluating hundreds of submissions. " +
      "You give honest, specific, evidence-based verdicts. You do not give generic feedback. " +
      "Every observation must be tied to something you actually saw in the screenshot or read in the code. " +
      "If you cannot find evidence for a claim, do not make it.";

    const modeLine = mode
      ? `Mode: ${mode === "builder" ? "builder (self-test before judging)" : "judge (official evaluation)"}`
      : "Mode: not specified";

    const customBlock = customCriteria?.trim()
      ? `Additional judging criteria: ${customCriteria.trim()}\n`
      : "";

    const githubBlock = githubAnalysis ? `${formatGitHubContext(githubAnalysis)}\n` : "";

    const userText =
      "Evaluate this hackathon submission as a senior judge would.\n\n" +
      `Submission URL: ${url}\n` +
      `${modeLine}\n` +
      (githubUrl ? `GitHub Repo URL: ${githubUrl}\n` : "") +
      (customBlock ? `\n${customBlock}` : "") +
      (githubBlock ? `\n${githubBlock}\n` : "") +
      (githubBlock
        ? `${TECHNICAL_ANALYSIS_INSTRUCTIONS}\n\n${SECURITY_AND_RESILIENCE_ANALYSIS}\n\n`
        : "") +
      "overallScore must be the mathematical average of firstImpression.score, valueProposition.score, demoFlow.score, and technicalCredibility.score, rounded to nearest integer. Do not invent a separate score.\n\n" +
      "Analyse the screenshot provided. Then return ONLY a valid JSON object with exactly this structure, no markdown, no preamble:\n\n" +
      "{\n" +
      '  "overallScore": number (1-10, must equal round average of the four scored sections),\n' +
      '  "sections": {\n' +
      '    "firstImpression": {\n' +
      '      "score": number (1-10),\n' +
      '      "headline": string (one sharp sentence -- what a judge says after 3 seconds),\n' +
      '      "observation": string (2-3 sentences of specific evidence-based observations),\n' +
      '      "flag": string | null (one critical issue if exists, else null)\n' +
      "    },\n" +
      '    "valueProposition": {\n' +
      '      "score": number (1-10),\n' +
      '      "headline": string,\n' +
      '      "observation": string,\n' +
      '      "flag": string | null\n' +
      "    },\n" +
      '    "demoFlow": {\n' +
      '      "score": number (1-10),\n' +
      '      "headline": string,\n' +
      '      "observation": string,\n' +
      '      "flag": string | null\n' +
      "    },\n" +
      '    "technicalCredibility": {\n' +
      '      "score": number (1-10),\n' +
      '      "headline": string,\n' +
      '      "observation": string,\n' +
      '      "flag": string | null,\n' +
      '      "codeSpecific": [string] (max 5 -- include technical [CRITICAL|HIGH|MEDIUM] and security [SECURITY-CRITICAL|SECURITY-HIGH|SECURITY-MEDIUM] prefixes as instructed; each line names a file and a specific finding. If no GitHub provided, return empty array.)\n' +
      "    },\n" +
      '    "verdict": {\n' +
      '      "score": null,\n' +
      '      "headline": string (the one thing that makes or breaks this submission),\n' +
      '      "observation": string (what this team should do in the next 30 minutes if they want to win),\n' +
      '      "flag": string | null\n' +
      "    }\n" +
      "  },\n" +
      '  "judgeQuote": string (one punchy sentence a tired judge would actually say out loud, honest and direct)\n' +
      "}\n\n" +
      "Be specific. Be honest. Do not soften findings. A generic observation like 'the UI could be improved' is not acceptable -- name exactly what you saw.\n" +
      "Return only valid JSON. No markdown backticks. No preamble.";

    const client = getAnthropicClient();

    const candidates = ["claude-sonnet-4-6"] as const;

    let lastError: unknown = null;
    let message: Anthropic.Messages.Message | null = null;
    let usedModel: string | null = null;

    const timeoutMs = Number(process.env.CLAUDE_TIMEOUT_MS ?? "90000");

    for (const model of candidates) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        message = await client.messages.create(
          {
            model,
            max_tokens: 4096,
            system,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: userText },
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/jpeg",
                      data: screenshotBase64,
                    },
                  },
                ],
              },
            ],
          },
          { signal: controller.signal },
        );
        usedModel = model;
        break;
      } catch (e) {
        if (
          e instanceof APIUserAbortError ||
          (e instanceof Error && e.name === "AbortError")
        ) {
          lastError = new Error(
            `Analysis timed out after ${Math.round(timeoutMs / 1000)} seconds`,
          );
        } else {
          lastError = e;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!message) {
      const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(
        `No available Claude model succeeded. Tried: ${candidates.join(
          ", ",
        )}. Last error: ${errMsg}`,
      );
    }

    const text =
      message.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim() || "";

    const inputTokens = message.usage.input_tokens ?? 0;
    const outputTokens = message.usage.output_tokens ?? 0;
    const inputCost = (inputTokens / 1_000_000) * 3.0;
    const outputCost = (outputTokens / 1_000_000) * 15.0;
    const totalCost = inputCost + outputCost;

    console.log(
      JSON.stringify({
        event: "evaluation_complete",
        timestamp: new Date().toISOString(),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUSD: totalCost.toFixed(4),
        hasGithub: githubAnalysis !== null,
        url: url.substring(0, 50),
      }),
    );

    const parsed = extractJsonObject(text);
    const report = normalizeJudgeReport(parsed);
    if (!report) {
      throw new Error(
        `Model returned JSON but not the expected scorecard schema.${
          usedModel ? ` (model: ${usedModel})` : ""
        }`,
      );
    }

    const estimatedCostUSD = totalCost.toFixed(4);
    return {
      ...report,
      tokenUsage: {
        inputTokens,
        outputTokens,
        estimatedCostUSD,
      },
      totalCost,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Claude evaluation failed: ${message}`);
  }
}
