import { NextResponse } from "next/server";

import { analyzeSubmission } from "@/lib/analyze";
import { analyzeGitHub } from "@/lib/github";
import { captureScreenshot } from "@/lib/screenshot";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      url: string;
      githubUrl?: string;
      focus: string;
    }>;

    const url = typeof body.url === "string" ? body.url.trim() : "";
    const githubUrl =
      typeof body.githubUrl === "string" ? body.githubUrl.trim() : "";
    const focus = typeof body.focus === "string" ? body.focus.trim() : "";

    if (!url || !focus) {
      return NextResponse.json(
        { error: "Missing required fields: url and focus" },
        { status: 400 },
      );
    }

    try {
      const screenshotBase64 = await captureScreenshot(url);
      const githubAnalysis = githubUrl ? await analyzeGitHub(githubUrl) : null;
      const analysis = await analyzeSubmission({
        url,
        focus,
        screenshotBase64,
        githubUrl: githubUrl || undefined,
        githubAnalysis,
      });

      return NextResponse.json({
        status: "ok",
        url,
        githubUrl: githubUrl || undefined,
        focus,
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
        focus,
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

