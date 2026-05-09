import { NextResponse } from "next/server";

import { analyzeSubmission } from "@/lib/analyze";
import { analyzeGitHub } from "@/lib/github";
import { captureScreenshot } from "@/lib/screenshot";

function sseData(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export async function POST(request: Request) {
  let body: Partial<{
    url: string;
    githubUrl?: string;
    focus: string;
    mode?: string;
    customCriteria?: string;
  }>;

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const githubUrl =
    typeof body.githubUrl === "string" ? body.githubUrl.trim() : "";
  const focus = typeof body.focus === "string" ? body.focus.trim() : "";
  const modeRaw = typeof body.mode === "string" ? body.mode.trim() : "";
  const mode =
    modeRaw === "judge" || modeRaw === "builder"
      ? (modeRaw as "judge" | "builder")
      : undefined;
  const customCriteria =
    typeof body.customCriteria === "string" ? body.customCriteria.trim() : "";

  if (!url || !focus) {
    return NextResponse.json(
      { error: "Missing required fields: url and focus" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(sseData(payload)));
      };

      try {
        send({ event: "progress", data: { step: 0, status: "active" } });

        let screenshotBase64: string;
        try {
          screenshotBase64 = await captureScreenshot(url);
        } catch (error) {
          const screenshotError =
            error instanceof Error ? error.message : String(error);
          send({
            event: "result",
            data: {
              status: "ok",
              url,
              githubUrl: githubUrl || undefined,
              focus,
              githubAnalyzed: false,
              screenshotCaptured: false,
              screenshotError,
            },
          });
          return;
        }

        send({ event: "progress", data: { step: 0, status: "done" } });

        send({ event: "progress", data: { step: 1, status: "active" } });
        const githubAnalysis = githubUrl ? await analyzeGitHub(githubUrl) : null;
        send({ event: "progress", data: { step: 1, status: "done" } });

        send({ event: "progress", data: { step: 2, status: "active" } });
        let analysis;
        try {
          analysis = await analyzeSubmission({
            url,
            focus,
            screenshotBase64,
            githubUrl: githubUrl || undefined,
            githubAnalysis,
            ...(mode ? { mode } : {}),
            ...(customCriteria ? { customCriteria } : {}),
          });
        } catch (error) {
          const screenshotError =
            error instanceof Error ? error.message : String(error);
          send({
            event: "result",
            data: {
              status: "ok",
              url,
              githubUrl: githubUrl || undefined,
              focus,
              githubAnalyzed: false,
              screenshotCaptured: false,
              screenshotError,
            },
          });
          return;
        }

        send({ event: "progress", data: { step: 2, status: "done" } });

        send({ event: "progress", data: { step: 3, status: "active" } });

        const fullResult = {
          status: "ok" as const,
          url,
          githubUrl: githubUrl || undefined,
          focus,
          githubAnalyzed: Boolean(githubUrl) && githubAnalysis !== null,
          screenshotCaptured: true,
          ...analysis,
        };

        send({ event: "result", data: fullResult });
      } catch (error) {
        console.error("POST /api/analyze/stream failed:", error);
        const screenshotError =
          error instanceof Error ? error.message : String(error);
        send({
          event: "result",
          data: {
            status: "ok",
            url,
            githubUrl: githubUrl || undefined,
            focus,
            githubAnalyzed: false,
            screenshotCaptured: false,
            screenshotError,
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
