import Anthropic from "@anthropic-ai/sdk";

import type { GitHubRepoAnalysis } from "@/lib/github";

type JudgeReport = {
  overallScore: number;
  firstImpression: string;
  topBlockers: Array<{
    issue: string;
    severity: "high" | "medium" | "low";
    fix: string;
  }>;
  strengths: string[];
  judgeVerdict: string;
  codeInsights: {
    qualitySignals: string[];
    completenessScore: number;
    honestyFlags: string[];
  } | null;
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
    // Some models occasionally add leading/trailing text. Try to recover by
    // extracting the first top-level JSON object.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model did not return JSON.");
    }
    const slice = trimmed.slice(start, end + 1);
    return JSON.parse(slice);
  }
}

function isJudgeReport(value: unknown): value is JudgeReport {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<JudgeReport>;
  if (typeof v.overallScore !== "number") return false;
  if (typeof v.firstImpression !== "string") return false;
  if (!Array.isArray(v.topBlockers)) return false;
  if (!Array.isArray(v.strengths)) return false;
  if (typeof v.judgeVerdict !== "string") return false;
  if (
    v.codeInsights !== null &&
    (typeof v.codeInsights !== "object" || v.codeInsights === undefined)
  ) {
    return false;
  }
  return true;
}

export async function analyzeSubmission(input: {
  url: string;
  focus: string;
  screenshotBase64: string;
  githubUrl?: string;
  githubAnalysis?: GitHubRepoAnalysis | null;
}): Promise<JudgeReport> {
  try {
    const { url, focus, screenshotBase64, githubUrl, githubAnalysis } = input;
    if (!url || !focus || !screenshotBase64) {
      throw new Error("Missing required input: url, focus, screenshotBase64.");
    }

    const system =
      "You are an expert hackathon judge. You evaluate live demo submissions quickly, fairly, and concretely. " +
      "You focus on what a judge can infer from a single above-the-fold screenshot: clarity, UX, value proposition, credibility, and obvious product/technical gaps. " +
      "You provide actionable feedback with severity and specific fixes. " +
      "You also evaluate three additional layers when code context is provided: " +
      "(a) code quality signals (error handling patterns, hardcoded secrets, incomplete/placeholder functions, console.log left in production), " +
      "(b) completeness signals (real/specific README, placeholder files, whether it looks like a real built product), " +
      "(c) honesty signals (does code match what demo/README claims).";

    const userText =
      `Evaluation focus: ${focus}\n` +
      `Submission URL: ${url}\n` +
      (githubUrl ? `GitHub Repo URL: ${githubUrl}\n` : "") +
      (githubAnalysis
        ? "\nGitHub Analysis:\n" +
          `- README: ${githubAnalysis.readmeText}\n` +
          `- File tree:\n${githubAnalysis.fileTree.join("\n")}\n` +
          `- package.json: ${githubAnalysis.packageJson ?? "null"}\n` +
          `- Main entry point (${githubAnalysis.mainEntryPoint?.path ?? "null"}): ${
            githubAnalysis.mainEntryPoint?.content ?? "null"
          }\n`
        : "") +
      "\nAnalyze the screenshot image provided. " +
      "Return ONLY a JSON object with this exact structure:\n" +
      '{\n' +
      '  "overallScore": number from 1-10,\n' +
      '  "firstImpression": string (2-3 sentences),\n' +
      '  "topBlockers": [\n' +
      '    { "issue": string, "severity": "high" | "medium" | "low", "fix": string }\n' +
      "  ] (max 3),\n" +
      '  "strengths": [string] (max 3),\n' +
      '  "judgeVerdict": string (one punchy sentence a judge would say out loud),\n' +
      '  "codeInsights": {\n' +
      '    "qualitySignals": [string] (max 3 issues found),\n' +
      '    "completenessScore": number 1-10,\n' +
      '    "honestyFlags": [string] (max 3 mismatches between claims and code)\n' +
      "  } | null\n" +
      "}\n" +
      (githubAnalysis
        ? "Use the GitHub Analysis context to populate codeInsights.\n"
        : "No GitHub analysis is provided. Set codeInsights to null.\n") +
      "Return only valid JSON. No markdown backticks. No preamble.";

    const client = getAnthropicClient();

    const candidates = [
      // Newer naming scheme (4.6+)
      "claude-sonnet-4-6",
      // 4.5 alias (resolves to latest dated snapshot for 4.5, if enabled)
      "claude-sonnet-4-5",
      // Older pinned ID (kept as a last resort if some accounts still allow it)
      "claude-sonnet-4-20250514",
    ] as const;

    let lastError: unknown = null;
    let message: Anthropic.Messages.Message | null = null;
    let usedModel: string | null = null;

    for (const model of candidates) {
      try {
        message = await client.messages.create({
          model,
          max_tokens: 1000,
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
    if (!isJudgeReport(parsed)) {
      throw new Error(
        `Model returned JSON but not the expected judge schema.${
          usedModel ? ` (model: ${usedModel})` : ""
        }`,
      );
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Claude evaluation failed: ${message}`);
  }
}

