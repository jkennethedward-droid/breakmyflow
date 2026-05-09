"use client";

import { useMemo, useState } from "react";

function getApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if (!("error" in data)) return null;
  const value = (data as { error?: unknown }).error;
  return value == null ? null : String(value);
}

export default function Home() {
  const focuses = useMemo(
    () => [
      "Overall first impression",
      "Demo flow clarity",
      "Onboarding and UX",
      "Value proposition strength",
      "Technical completeness",
    ],
    [],
  );

  const [url, setUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [focus, setFocus] = useState(focuses[0] ?? "");
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [result, setResult] = useState<
    | null
    | {
        screenshotCaptured?: boolean;
        screenshotError?: string;
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
      }
  >(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setUrl("");
    setGithubUrl("");
    setFocus(focuses[0] ?? "");
    setIsDone(false);
    setResult(null);
    setError(null);
    setIsRunning(false);
  }

  async function run() {
    setIsDone(false);
    setResult(null);
    setError(null);

    const trimmedUrl = url.trim();
    const trimmedGithubUrl = githubUrl.trim();
    if (!trimmedUrl || !focus) {
      setError("Submission URL and evaluation focus are required.");
      return;
    }

    setIsRunning(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          githubUrl: trimmedGithubUrl || undefined,
          focus,
        }),
      });

      const data = await res.json().catch(() => null);
      console.log("analyze response:", { status: res.status, data });

      if (!res.ok) {
        setError(
          getApiErrorMessage(data) ?? "Analysis failed. Try again.",
        );
        return;
      }

      setResult(
        data && typeof data === "object"
          ? (data as {
              screenshotCaptured?: boolean;
              screenshotError?: string;
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
            })
          : null,
      );
      setIsDone(true);
    } catch (e) {
      console.error(e);
      setError("Network error. Your demo’s not the only thing crashing.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <main className="w-full max-w-2xl">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_40px_120px_-60px_rgba(255,0,64,0.35)] backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-white">
              Break My Flow
            </h1>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
              judge mode
            </span>
          </div>

          <p className="mt-3 text-sm leading-6 text-white/70">
            Paste any hackathon submission URL and get a structured evaluation
            report in 60 seconds.
          </p>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="url"
                className="text-xs font-medium uppercase tracking-wide text-white/60"
              >
                Submission URL
              </label>
              <input
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://their-app.vercel.app"
                inputMode="url"
                autoComplete="url"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none ring-0 transition focus:border-white/20 focus:bg-black/55"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="githubUrl"
                className="text-xs font-medium uppercase tracking-wide text-white/60"
              >
                GitHub Repo URL{" "}
                <span className="normal-case text-white/35">(optional)</span>
              </label>
              <input
                id="githubUrl"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/team/repo"
                inputMode="url"
                autoComplete="url"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none ring-0 transition focus:border-white/20 focus:bg-black/55"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="focus"
                className="text-xs font-medium uppercase tracking-wide text-white/60"
              >
                Evaluation focus
              </label>
              <select
                id="focus"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-white/20 focus:bg-black/55"
              >
                {focuses.map((f) => (
                  <option key={f} value={f} className="bg-black text-white">
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={run}
              disabled={isRunning}
              className="group relative w-full overflow-hidden rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="relative z-10">
                {isRunning ? "Evaluating..." : "Evaluate Submission"}
              </span>
              <span className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100">
                <span className="absolute -inset-x-12 inset-y-0 bg-gradient-to-r from-transparent via-red-500/20 to-transparent blur-sm" />
              </span>
            </button>

            {error ? (
              <p className="text-sm text-red-300">{error}</p>
            ) : isDone ? (
              <div className="space-y-4">
                {result?.screenshotCaptured ? (
                  <span className="inline-flex items-center rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-300">
                    Screenshot captured
                  </span>
                ) : result?.screenshotError ? (
                  <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200">
                    Screenshot failed: {result.screenshotError}
                  </span>
                ) : null}

                {result && typeof result.overallScore === "number" ? (
                  <div className="space-y-4">
                    <div className="flex items-end gap-2">
                      <div className="text-5xl font-semibold tracking-tight text-white">
                        {result.overallScore}
                      </div>
                      <div className="pb-1 text-sm text-white/50">/10</div>
                    </div>

                    <p className="text-sm leading-6 text-white/75">
                      {result.firstImpression}
                    </p>

                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-sm italic leading-6 text-white">
                        “{result.judgeVerdict}”
                      </p>
                    </div>

                    {Array.isArray(result.topBlockers) &&
                    result.topBlockers.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/60">
                          Top blockers
                        </p>
                        <ul className="space-y-2">
                          {result.topBlockers.slice(0, 3).map((b, idx) => {
                            const badge =
                              b.severity === "high"
                                ? "border-red-500/25 bg-red-500/10 text-red-200"
                                : b.severity === "medium"
                                  ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
                                  : "border-white/10 bg-white/5 text-white/70";

                            return (
                              <li
                                key={`${b.issue}-${idx}`}
                                className="rounded-xl border border-white/10 bg-black/20 p-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="text-sm text-white/85">
                                    {b.issue}
                                  </div>
                                  <span
                                    className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${badge}`}
                                  >
                                    {b.severity}
                                  </span>
                                </div>
                                <div className="mt-2 text-xs leading-5 text-white/60">
                                  Fix: {b.fix}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}

                    {Array.isArray(result.strengths) &&
                    result.strengths.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/60">
                          Strengths
                        </p>
                        <ul className="space-y-1 text-sm text-white/80">
                          {result.strengths.slice(0, 3).map((s, idx) => (
                            <li key={`${s}-${idx}`} className="flex gap-2">
                              <span className="text-white/55">✓</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {result.codeInsights ? (
                      <div className="space-y-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/60">
                          Code insights
                        </p>

                        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="text-sm text-white/80">
                              Completeness
                            </div>
                            <div className="text-sm font-semibold text-white">
                              {result.codeInsights.completenessScore}/10
                            </div>
                          </div>
                        </div>

                        {Array.isArray(result.codeInsights.qualitySignals) &&
                        result.codeInsights.qualitySignals.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-white/60">
                              Quality signals
                            </p>
                            <ul className="space-y-1 text-sm text-white/80">
                              {result.codeInsights.qualitySignals
                                .slice(0, 3)
                                .map((s, idx) => (
                                  <li key={`${s}-${idx}`} className="flex gap-2">
                                    <span className="text-amber-200">⚠</span>
                                    <span>{s}</span>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        ) : null}

                        {Array.isArray(result.codeInsights.honestyFlags) &&
                        result.codeInsights.honestyFlags.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-white/60">
                              Claim vs code
                            </p>
                            <ul className="space-y-1 text-sm text-white/80">
                              {result.codeInsights.honestyFlags
                                .slice(0, 3)
                                .map((s, idx) => (
                                  <li key={`${s}-${idx}`} className="flex gap-2">
                                    <span className="text-white/60">⚑</span>
                                    <span>{s}</span>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={reset}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-white transition hover:bg-black/40"
                    >
                      Evaluate Another Submission
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-white/60">Evaluation complete.</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-white/40">
                You ship it. We try to break it. Better now than on stage.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
