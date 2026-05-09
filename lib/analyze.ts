import Anthropic from "@anthropic-ai/sdk";

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

function normalizeJudgeReport(raw: unknown): JudgeReport | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.overallScore !== "number") return null;
  if (typeof v.judgeQuote !== "string") return null;
  if (!v.sections || typeof v.sections !== "object") return null;
  const s = v.sections as Record<string, unknown>;

  if (!isStdSection(s.firstImpression)) return null;
  if (!isStdSection(s.valueProposition)) return null;
  if (!isStdSection(s.demoFlow)) return null;
  if (!isTechnicalSection(s.technicalCredibility)) return null;
  if (!isVerdictSection(s.verdict)) return null;

  const tech = s.technicalCredibility as TechnicalCredibilitySection;
  const codeSpecific = tech.codeSpecific.slice(0, 3);

  return {
    overallScore: v.overallScore,
    judgeQuote: v.judgeQuote,
    sections: {
      firstImpression: s.firstImpression as ScorecardSectionBase,
      valueProposition: s.valueProposition as ScorecardSectionBase,
      demoFlow: s.demoFlow as ScorecardSectionBase,
      technicalCredibility: {
        ...(s.technicalCredibility as TechnicalCredibilitySection),
        codeSpecific,
      },
      verdict: s.verdict as VerdictSection,
    },
  };
}

export async function analyzeSubmission(input: {
  url: string;
  screenshotBase64: string;
  githubUrl?: string;
  githubAnalysis?: GitHubRepoAnalysis | null;
  mode?: "judge" | "builder";
  customCriteria?: string;
}): Promise<JudgeReport> {
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

    const githubBlock = githubAnalysis
      ? `README (first 3000 chars): ${githubAnalysis.readmeText}\n` +
        `File tree:\n${githubAnalysis.fileTree.join("\n")}\n` +
        `package.json: ${githubAnalysis.packageJson ?? "null"}\n` +
        `Main entry point (${githubAnalysis.mainEntryPoint?.path ?? "null"}): ${githubAnalysis.mainEntryPoint?.content ?? "null"}\n`
      : "";

    const userText =
      "Evaluate this hackathon submission as a senior judge would.\n\n" +
      `Submission URL: ${url}\n` +
      `${modeLine}\n` +
      (githubUrl ? `GitHub Repo URL: ${githubUrl}\n` : "") +
      (customBlock ? `\n${customBlock}` : "") +
      (githubBlock ? `\n${githubBlock}\n` : "") +
      "\nAnalyse the screenshot provided. Then return ONLY a valid JSON object with exactly this structure, no markdown, no preamble:\n\n" +
      "{\n" +
      '  "overallScore": number (1-10),\n' +
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
      '      "codeSpecific": [string] (max 3 -- each must name a specific file, line pattern, or finding. No generic observations. Examples of good specifics: "console.log found in app/api/analyze/route.ts line 45", "package.json lists openai as devDependency not production", "README still contains default create-next-app boilerplate text". If no GitHub provided, return empty array.)\n' +
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

    const candidates = [
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4-20250514",
    ] as const;

    let lastError: unknown = null;
    let message: Anthropic.Messages.Message | null = null;
    let usedModel: string | null = null;

    for (const model of candidates) {
      try {
        message = await client.messages.create({
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
        });
        usedModel = model;
        break;
      } catch (e) {
        lastError = e;
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

    const parsed = extractJsonObject(text);
    const report = normalizeJudgeReport(parsed);
    if (!report) {
      throw new Error(
        `Model returned JSON but not the expected scorecard schema.${
          usedModel ? ` (model: ${usedModel})` : ""
        }`,
      );
    }
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Claude evaluation failed: ${message}`);
  }
}
