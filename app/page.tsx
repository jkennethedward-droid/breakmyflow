"use client";

import { useState, type ReactNode } from "react";

function getApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if (!("error" in data)) return null;
  const value = (data as { error?: unknown }).error;
  return value == null ? null : String(value);
}

type ProgressRow = {
  step: string;
  status: "waiting" | "active" | "done";
};

type ScorecardSectionBase = {
  score: number;
  headline: string;
  observation: string;
  flag: string | null;
};

type TechnicalCredibilitySection = ScorecardSectionBase & {
  codeSpecific: string[];
};

type VerdictSection = {
  score: null;
  headline: string;
  observation: string;
  flag: string | null;
};

type ResultShape = {
  screenshotCaptured?: boolean;
  screenshotError?: string;
  githubAnalyzed?: boolean;
  overallScore?: number;
  judgeQuote?: string;
  sections?: {
    firstImpression: ScorecardSectionBase;
    valueProposition: ScorecardSectionBase;
    demoFlow: ScorecardSectionBase;
    technicalCredibility: TechnicalCredibilitySection;
    verdict: VerdictSection;
  };
};

function initialProgress(): ProgressRow[] {
  return [
    { step: "Capturing live screenshot", status: "waiting" },
    { step: "Fetching GitHub repository", status: "waiting" },
    { step: "Analysing with Claude", status: "waiting" },
    { step: "Building evaluation report", status: "waiting" },
  ];
}

function scrollToEvaluate() {
  document.getElementById("evaluate")?.scrollIntoView({ behavior: "smooth" });
}

export default function Home() {
  const [mode, setMode] = useState<"judge" | "builder">("builder");
  const [url, setUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [customCriteria, setCustomCriteria] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [result, setResult] = useState<ResultShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressRow[]>(() => initialProgress());

  function reset() {
    setUrl("");
    setGithubUrl("");
    setCustomCriteria("");
    setIsDone(false);
    setResult(null);
    setError(null);
    setIsRunning(false);
    setProgress(initialProgress());
  }

  async function run() {
    setIsDone(false);
    setResult(null);
    setError(null);
    setProgress(initialProgress());

    const trimmedUrl = url.trim();
    const trimmedGithubUrl = githubUrl.trim();
    const hadGithub = trimmedGithubUrl.length > 0;
    if (!trimmedUrl) {
      setError("Submission URL is required.");
      return;
    }

    setIsRunning(true);
    try {
      const res = await fetch("/api/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          githubUrl: trimmedGithubUrl || undefined,
          mode,
          customCriteria: customCriteria.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(
          getApiErrorMessage(data) ?? "Analysis failed. Try again.",
        );
        setProgress(initialProgress());
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response stream.");
        setProgress(initialProgress());
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let gotResult = false;

      const applyProgress = (
        stepIndex: number,
        status: "waiting" | "active" | "done",
      ) => {
        setProgress((prev) => {
          const next = prev.map((row, i) =>
            i === stepIndex ? { ...row, status } : row,
          );
          if (stepIndex === 1 && status === "done" && !hadGithub) {
            next[1] = {
              step: "GitHub scan skipped",
              status: "done",
            };
          }
          return next;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const raw of parts) {
          const line = raw.trim();
          if (!line.startsWith("data: ")) continue;
          let msg: unknown;
          try {
            msg = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (!msg || typeof msg !== "object" || !("event" in msg)) continue;
          const m = msg as {
            event: string;
            data?: { step?: number; status?: string };
          };
          if (m.event === "progress" && m.data && typeof m.data.step === "number") {
            const st = m.data.status;
            if (st === "active" || st === "done" || st === "waiting") {
              applyProgress(m.data.step, st);
            }
          } else if (m.event === "result" && m.data && typeof m.data === "object") {
            gotResult = true;
            setResult(m.data as ResultShape);
            setProgress((prev) =>
              prev.map((row, i) =>
                i === 3 ? { ...row, status: "done" as const } : row,
              ),
            );
            setIsDone(true);
            console.log("analyze stream result:", m.data);
          }
        }
      }

      if (!gotResult) {
        setError("Evaluation did not complete. Try again.");
        setProgress(initialProgress());
      }
    } catch (e) {
      console.error(e);
      setError("Network error. Your demo’s not the only thing crashing.");
      setProgress(initialProgress());
    } finally {
      setIsRunning(false);
    }
  }

  function renderScorecardSection(
    label: string,
    section: ScorecardSectionBase,
    extras?: ReactNode,
  ) {
    return (
      <div className="rounded-2xl border-2 border-black bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <span className="text-xs font-black uppercase tracking-widest text-gray-400">
            {label}
          </span>
          <span className="text-2xl font-black text-black">{section.score}</span>
        </div>
        <h4 className="mt-2 mb-3 text-xl font-black text-black">
          {section.headline}
        </h4>
        <p className="text-sm leading-relaxed text-gray-600">
          {section.observation}
        </p>
        {extras}
        {section.flag ? (
          <div className="mt-4 border-l-4 border-red-500 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
            ⚠ {section.flag}
          </div>
        ) : null}
      </div>
    );
  }

  function renderResultsBody() {
    if (
      !result ||
      typeof result.overallScore !== "number" ||
      !result.sections
    ) {
      return <p className="text-gray-600">Evaluation complete.</p>;
    }

    const { sections, judgeQuote, overallScore, githubAnalyzed } = result;
    const tech = sections.technicalCredibility;
    const showCodeSpecific =
      githubAnalyzed === true &&
      Array.isArray(tech.codeSpecific) &&
      tech.codeSpecific.length > 0;

    const techExtras =
      showCodeSpecific ? (
        <div className="mt-3 rounded-xl bg-[#191A23] p-4">
          <ul className="space-y-2">
            {tech.codeSpecific.map((line, idx) => (
              <li
                key={`${line}-${idx}`}
                className="flex gap-2 text-sm font-mono text-white"
              >
                <span className="shrink-0 text-[#B9FF66]">●</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null;

    const v = sections.verdict;

    return (
      <div className="space-y-8">
        <div className="space-y-6">
          <div className="flex items-end gap-2">
            <div className="text-8xl font-black text-black">{overallScore}</div>
            <div className="pb-4 text-2xl font-bold text-gray-500">/10</div>
          </div>
          {judgeQuote ? (
            <div className="rounded-2xl border-2 border-black bg-[#B9FF66] p-6 text-lg font-bold italic text-black">
              {judgeQuote}
            </div>
          ) : null}
        </div>

        {renderScorecardSection("01 First Impression", sections.firstImpression)}
        {renderScorecardSection(
          "02 Value Proposition",
          sections.valueProposition,
        )}
        {renderScorecardSection("03 Demo Flow", sections.demoFlow)}
        {renderScorecardSection(
          "04 Technical Credibility",
          sections.technicalCredibility,
          techExtras,
        )}

        <div className="rounded-2xl border-2 border-black bg-[#191A23] p-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <span className="text-xs font-black uppercase tracking-widest text-[#B9FF66]">
              05 Verdict
            </span>
          </div>
          <h4 className="mt-2 mb-3 text-xl font-black text-white">
            {v.headline}
          </h4>
          <p className="text-xs font-black uppercase tracking-widest text-[#B9FF66]">
            What to do in the next 30 minutes:
          </p>
          <p className="mt-2 text-sm leading-relaxed text-gray-300">
            {v.observation}
          </p>
          {v.flag ? (
            <div className="mt-4 border-l-4 border-red-400 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-300">
              ⚠ {v.flag}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F3F3] text-black">
      {/* Hero */}
      <section className="relative flex min-h-screen flex-col bg-[#F3F3F3] px-4 sm:px-6 lg:px-8">
        <header className="relative z-20 mx-auto w-full max-w-6xl bg-[#F3F3F3] py-6">
          <span className="text-xl font-black tracking-tight text-black">
            Break My Flow
          </span>
        </header>

        <div className="relative z-10 mx-auto flex max-w-6xl flex-1 flex-col justify-center pt-16 pb-12">
          <h1 className="max-w-4xl text-6xl font-black leading-tight tracking-tight text-black">
            You ship it. We try to break it.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-gray-600 sm:text-lg">
            Real screenshots, real code analysis, real verdicts — in 60
            seconds.
          </p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() => {
                setMode("builder");
                scrollToEvaluate();
              }}
              className="rounded-full border-2 border-black bg-[#B9FF66] px-8 py-4 text-center text-base font-bold text-black transition hover:opacity-90"
            >
              Test My Submission
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("judge");
                scrollToEvaluate();
              }}
              className="rounded-full border-2 border-black bg-white px-8 py-4 text-center text-base font-bold text-black transition hover:bg-gray-50"
            >
              Evaluate Submissions
            </button>
          </div>
        </div>
      </section>

      {/* USP */}
      <section className="border-t-2 border-black bg-[#F3F3F3] px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "60-Second Evaluation",
              d: "Real browser screenshot + Claude vision analysis. No guesswork.",
            },
            {
              n: "02",
              t: "Three-Layer Code Analysis",
              d: "Quality signals, completeness score, and claim vs code honesty checks.",
            },
            {
              n: "03",
              t: "Judge + Builder Mode",
              d: "Organisers evaluate submissions. Builders self-test before judging.",
            },
          ].map((card, i) => {
            const cardClass =
              i === 0
                ? "bg-[#F3F3F3] text-black"
                : i === 1
                  ? "bg-[#B9FF66] text-black"
                  : "bg-[#191A23] text-white";
            const numClass =
              i === 2 ? "text-4xl font-black text-white" : "text-4xl font-black text-black";
            const titleClass =
              i === 2
                ? "mt-4 mb-2 text-xl font-bold text-white"
                : "mt-4 mb-2 text-xl font-bold text-black";
            const descClass =
              i === 2 ? "text-sm leading-relaxed text-gray-300" : "text-sm leading-relaxed text-gray-600";
            return (
              <div
                key={card.n}
                className={`rounded-2xl border-2 border-black p-8 ${cardClass}`}
              >
                <div className={numClass}>{card.n}</div>
                <h2 className={titleClass}>{card.t}</h2>
                <p className={descClass}>{card.d}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Evaluate */}
      <section
        id="evaluate"
        className="scroll-mt-8 border-t-2 border-black bg-white px-4 py-16 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-3xl">
          <h2 className="text-4xl font-black text-black">
            Evaluate a Submission
          </h2>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setMode("builder")}
              className={`flex-1 rounded-full border-2 border-black px-6 py-3 text-center text-sm transition sm:text-base ${
                mode === "builder"
                  ? "bg-[#B9FF66] font-bold text-black"
                  : "bg-white text-black"
              }`}
            >
              Builder Mode
            </button>
            <button
              type="button"
              onClick={() => setMode("judge")}
              className={`flex-1 rounded-full border-2 border-black px-6 py-3 text-center text-sm transition sm:text-base ${
                mode === "judge"
                  ? "bg-[#B9FF66] font-bold text-black"
                  : "bg-white text-black"
              }`}
            >
              Judge Mode
            </button>
          </div>

          <div className="mt-10 space-y-6 rounded-2xl border-2 border-black bg-[#F3F3F3] p-8">
            <div className="space-y-2">
              <label
                htmlFor="url"
                className="text-sm font-bold uppercase tracking-wide text-black"
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
                className="w-full rounded-xl border-2 border-black bg-white px-4 py-3 text-black placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-[#B9FF66]"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="githubUrl"
                className="text-sm font-bold uppercase tracking-wide text-black"
              >
                GitHub Repo URL{" "}
                <span className="normal-case font-normal text-[#555555]">
                  (optional)
                </span>
              </label>
              <input
                id="githubUrl"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/team/repo"
                inputMode="url"
                autoComplete="url"
                className="w-full rounded-xl border-2 border-black bg-white px-4 py-3 text-black placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-[#B9FF66]"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="customCriteria"
                className="text-sm font-bold uppercase tracking-wide text-black"
              >
                Custom criteria{" "}
                <span className="normal-case font-normal text-[#555555]">
                  (optional)
                </span>
              </label>
              <textarea
                id="customCriteria"
                value={customCriteria}
                onChange={(e) => setCustomCriteria(e.target.value)}
                rows={4}
                placeholder="Add any specific judging criteria e.g. 'Must use AI', 'Accessibility matters', 'Bonus for live demo'"
                className="w-full resize-y rounded-xl border-2 border-black bg-white px-4 py-3 text-black placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-[#B9FF66]"
              />
            </div>

            <button
              type="button"
              onClick={run}
              disabled={isRunning}
              className="w-full rounded-full border-2 border-black bg-[#B9FF66] py-4 text-center text-lg font-bold text-black transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRunning ? "Evaluating..." : "Evaluate Submission"}
            </button>

            {isRunning ? (
              <div className="rounded-2xl border-2 border-black bg-[#F3F3F3] p-6 transition-all">
                <p className="text-xs font-black tracking-widest text-black">
                  EVALUATION IN PROGRESS
                </p>
                <div className="mt-4 flex flex-col gap-3">
                  {progress.map((row, idx) => (
                    <div
                      key={`${row.step}-${idx}`}
                      className="flex items-center gap-3 transition-all duration-300"
                    >
                      {row.status === "waiting" ? (
                        <div
                          className="h-4 w-4 shrink-0 rounded-full border-2 border-gray-400"
                          aria-hidden
                        />
                      ) : null}
                      {row.status === "active" ? (
                        <div
                          className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-[#B9FF66]"
                          aria-hidden
                        />
                      ) : null}
                      {row.status === "done" ? (
                        <div
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#B9FF66] text-[10px] font-bold text-black"
                          aria-hidden
                        >
                          ✓
                        </div>
                      ) : null}
                      <span
                        className={
                          row.status === "waiting"
                            ? "text-sm text-gray-400"
                            : row.status === "active"
                              ? "text-sm font-bold text-black"
                              : "text-sm text-black"
                        }
                      >
                        {row.step}
                        {row.status === "active" ? "..." : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="text-sm font-semibold text-red-600">{error}</p>
            ) : isDone ? (
              <div className="space-y-6 border-t-2 border-dashed border-black pt-8">
                <div className="space-y-6 rounded-2xl border-2 border-black bg-white p-8">
                  {result?.screenshotCaptured ? (
                    <span className="inline-flex rounded-full border-2 border-black px-3 py-1 text-sm font-bold text-black">
                      Screenshot captured
                    </span>
                  ) : result?.screenshotError ? (
                    <span className="inline-flex rounded-full border-2 border-black px-3 py-1 text-sm font-bold text-amber-800">
                      Screenshot failed: {result.screenshotError}
                    </span>
                  ) : null}
                  {renderResultsBody()}
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="w-full rounded-full border-2 border-black bg-white px-8 py-4 text-center text-base font-bold text-black transition hover:bg-gray-50"
                >
                  Evaluate Another Submission
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1 text-center text-sm text-gray-500">
                <p>Paste any submission URL. Get the truth.</p>
                <p>Better now than on stage.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Bulk — judge mode only */}
      {mode === "judge" ? (
        <section className="border-t-2 border-black bg-[#F3F3F3] px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-4xl font-black text-black">
                  Bulk Evaluation
                </h2>
                <span className="rounded-full border border-black bg-[#B9FF66] px-3 py-1 text-sm font-bold text-black">
                  Coming Soon
                </span>
              </div>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-full border-2 border-black bg-[#F3F3F3] px-6 py-3 text-sm font-bold text-black opacity-50"
              >
                Export Results
              </button>
            </div>

            <div className="mt-8 rounded-2xl border-2 border-dashed border-black bg-white p-12 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-black">
                <svg
                  className="h-7 w-7 text-black"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
              </div>
              <p className="font-bold text-black">
                Upload submissions.csv with URL and GitHub columns
              </p>
              <p className="mt-2 text-sm text-gray-600">
                Non-functional preview — bulk import coming soon.
              </p>
            </div>

            <div className="mt-8 overflow-x-auto rounded-2xl border-2 border-black bg-white">
              <table className="w-full min-w-[600px] border-collapse border-2 border-black text-left text-sm text-black">
                <thead>
                  <tr className="border-b-2 border-black bg-[#191A23]">
                    {[
                      "Rank",
                      "Team Name",
                      "Score",
                      "Top Blocker",
                      "Judge Verdict",
                    ].map((h, hi) => (
                      <th
                        key={h}
                        className={`border-r-2 border-black p-4 font-bold ${
                          hi === 0
                            ? "font-black text-[#B9FF66]"
                            : "text-white"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      rank: 1,
                      team: "TeamAlpha",
                      score: "8/10",
                      blocker: "Login flow needs work",
                      verdict: "Strong product, fix the CTA",
                    },
                    {
                      rank: 2,
                      team: "NightOwls",
                      score: "6/10",
                      blocker: "No mobile support",
                      verdict: "Good idea, rough execution",
                    },
                    {
                      rank: 3,
                      team: "ByteForce",
                      score: "4/10",
                      blocker: "README doesn't match code",
                      verdict: "Claims don't hold up under scrutiny",
                    },
                  ].map((row) => (
                    <tr
                      key={row.team}
                      className="border-b-2 border-black bg-white"
                    >
                      <td className="border-r-2 border-black p-4 font-black text-black">
                        {row.rank}
                      </td>
                      <td className="border-r-2 border-black p-4 font-semibold">
                        {row.team}
                      </td>
                      <td className="border-r-2 border-black p-4">{row.score}</td>
                      <td className="border-r-2 border-black p-4">
                        {row.blocker}
                      </td>
                      <td className="p-4">{row.verdict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {/* Footer */}
      <footer className="border-t-2 border-black bg-[#191A23] px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center text-sm text-white md:flex-row md:justify-between md:text-left">
          <span className="font-black text-white">Break My Flow</span>
          <span className="text-white">
            Built at AI Engineer Hackathon Singapore 2026
          </span>
          <span className="text-xs text-white/80">
            Powered by Claude + Screenshotone
          </span>
        </div>
      </footer>
    </div>
  );
}
