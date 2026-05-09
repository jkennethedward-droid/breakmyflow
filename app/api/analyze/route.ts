import { NextResponse } from "next/server";

import { analyzeSubmission } from "@/lib/analyze";
import { analyzeGitHub } from "@/lib/github";
import { checkRateLimit } from "@/lib/ratelimit";
import { captureScreenshot } from "@/lib/screenshot";
import { validateGithubUrl, validateUrl } from "@/lib/validate";

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous";
  const { allowed } = checkRateLimit(ip);

  if (!allowed) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded. Maximum 10 evaluations per hour per IP.",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  const apiSecret = process.env.API_SECRET;
  if (apiSecret) {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (token !== apiSecret) {
      // Only enforce if called directly, not from same origin
      const origin = request.headers.get("origin");
      const host = request.headers.get("host");
      if (!origin || !origin.includes(host ?? "")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }

  try {
    const body = (await request.json()) as Partial<{
      url: string;
      githubUrl?: string;
      mode?: string;
      customCriteria?: string;
    }>;

    const url = typeof body.url === "string" ? body.url.trim() : "";
    const githubUrl =
      typeof body.githubUrl === "string" ? body.githubUrl.trim() : "";
    const modeRaw = typeof body.mode === "string" ? body.mode.trim() : "";
    const mode =
      modeRaw === "judge" || modeRaw === "builder"
        ? (modeRaw as "judge" | "builder")
        : undefined;
    const customCriteria =
      typeof body.customCriteria === "string" ? body.customCriteria.trim() : "";

    if (customCriteria && customCriteria.length > 500) {
      return new Response(
        JSON.stringify({
          error: "Custom criteria must be 500 characters or less",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const urlCheck = validateUrl(url);
    if (!urlCheck.valid) {
      return new Response(JSON.stringify({ error: urlCheck.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (githubUrl) {
      const githubCheck = validateGithubUrl(githubUrl);
      if (!githubCheck.valid) {
        return new Response(JSON.stringify({ error: githubCheck.error }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    try {
      const screenshotBase64 = await captureScreenshot(url);
      const githubAnalysis = githubUrl ? await analyzeGitHub(githubUrl) : null;
      const analysis = await analyzeSubmission({
        url,
        screenshotBase64,
        githubUrl: githubUrl || undefined,
        githubAnalysis,
        ...(mode ? { mode } : {}),
        ...(customCriteria ? { customCriteria } : {}),
      });

      return NextResponse.json({
        status: "ok",
        url,
        githubUrl: githubUrl || undefined,
        githubAnalyzed: Boolean(githubUrl) && githubAnalysis !== null,
        screenshotCaptured: true,
        ...analysis,
      });
    } catch (error) {
      const screenshotError =
        error instanceof Error ? error.message : String(error);

      return NextResponse.json({
        status: "ok",
        url,
        githubUrl: githubUrl || undefined,
        githubAnalyzed: false,
        screenshotCaptured: false,
        screenshotError,
      });
    }
  } catch (error) {
    console.error("POST /api/analyze failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
