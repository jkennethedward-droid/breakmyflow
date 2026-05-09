import { NextResponse } from "next/server";

import { analyzeSubmission } from "@/lib/analyze";
import { analyzeGitHub } from "@/lib/github";
import { captureScreenshot } from "@/lib/screenshot";

export async function POST(request: Request) {
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

    if (!url) {
      return NextResponse.json(
        { error: "Missing required field: url" },
        { status: 400 },
      );
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

