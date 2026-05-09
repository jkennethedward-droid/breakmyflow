"use client";

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const RADAR_LABEL_TO_SECTION: Record<string, string> = {
  "First Impression": "firstImpression",
  "Value Prop": "valueProposition",
  "Demo Flow": "demoFlow",
  Technical: "technicalCredibility",
};

const CustomRadarTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { section: string } }>;
}) => {
  if (active && payload && payload.length) {
    const section = payload[0].payload.section;
    const score = payload[0].value;
    return (
      <div className="bg-black border-2 border-[#B9FF66] rounded-xl px-4 py-3 shadow-lg">
        <p className="text-[#B9FF66] text-xs font-black uppercase tracking-widest mb-1">
          {section}
        </p>
        <p className="text-white text-3xl font-black leading-none">
          {score}
          <span className="text-gray-400 text-lg font-normal">/10</span>
        </p>
      </div>
    );
  }
  return null;
};

function getApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if (!("error" in data)) return null;
  const value = (data as { error?: unknown }).error;
  return value == null ? null : String(value);
}

type ProgressRow = {
  step: string;
  status: "waiting" | "active" | "done";
  detail?: string;
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

type AnalysisResult = {
  overallScore: number;
  judgeQuote: string;
  sections: {
    firstImpression: ScorecardSectionBase;
    valueProposition: ScorecardSectionBase;
    demoFlow: ScorecardSectionBase;
    technicalCredibility: TechnicalCredibilitySection;
    verdict: VerdictSection;
  };
};

type ResultShape = {
  url?: string;
  screenshotBase64?: string;
  screenshotCaptured?: boolean;
  screenshotError?: string;
  githubAnalyzed?: boolean;
  overallScore?: number;
  judgeQuote?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: string;
  };
  sections?: {
    firstImpression: ScorecardSectionBase;
    valueProposition: ScorecardSectionBase;
    demoFlow: ScorecardSectionBase;
    technicalCredibility: TechnicalCredibilitySection;
    verdict: VerdictSection;
  };
};

function parseCSV(text: string): Array<{ name: string; url: string; githubUrl?: string }> {
  const lines = text.trim().split("\n");
  const headers = (lines[0] ?? "")
    .toLowerCase()
    .split(",")
    .map((h) => h.trim());
  const nameIndex = headers.indexOf("name");
  const urlIndex = headers.indexOf("url");
  const githubIndex = headers.indexOf("github_url");
  if (urlIndex === -1) return [];
  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(",").map((c) => c.trim());
      let fallbackName = "";
      try {
        fallbackName = new URL(cols[urlIndex] ?? "").hostname;
      } catch {
        fallbackName = "";
      }
      return {
        name: cols[nameIndex] || fallbackName,
        url: cols[urlIndex] ?? "",
        githubUrl: githubIndex >= 0 ? cols[githubIndex] : undefined,
      };
    })
    .filter((row) => row.url && row.url.startsWith("http"));
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function initialProgress(): ProgressRow[] {
  return [
    { step: "Capturing live screenshot", status: "waiting" },
    { step: "Fetching GitHub repository", status: "waiting" },
    { step: "Analysing with Claude", status: "waiting" },
    { step: "Building evaluation report", status: "waiting" },
  ];
}

function parseSubmissionPages(input: string): string[] {
  return input
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.startsWith("http"))
    .slice(0, 3);
}

function scrollToEvaluate() {
  document.getElementById("evaluate")?.scrollIntoView({ behavior: "smooth" });
}

export default function Home() {
  const [mode, setMode] = useState<"judge" | "builder">("builder");
  const [showForm, setShowForm] = useState(false);
  const [submissionPages, setSubmissionPages] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [customCriteria, setCustomCriteria] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [result, setResult] = useState<ResultShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressRow[]>(() => initialProgress());
  const [expandedSections, setExpandedSections] = useState<string[]>([]);

  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<
    Array<{ name: string; url: string; githubUrl?: string }>
  >([]);
  const [bulkResults, setBulkResults] = useState<
    Array<{
      name: string;
      url: string;
      githubUrl?: string;
      status: "pending" | "running" | "done" | "error";
      score?: number;
      topFinding?: string;
      verdict?: string;
      fullResult?: AnalysisResult;
      error?: string;
    }>
  >([]);

  const [selectedReport, setSelectedReport] = useState<{
    name: string;
    url: string;
    result: AnalysisResult;
  } | null>(null);
  const [modalExpandedSections, setModalExpandedSections] = useState<string[]>([
    "firstImpression",
    "valueProposition",
    "demoFlow",
    "technicalCredibility",
    "verdict",
  ]);

  useEffect(() => {
    if (!selectedReport) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedReport(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedReport]);

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId],
    );
  }

  function reset() {
    setSubmissionPages("");
    setGithubUrl("");
    setCustomCriteria("");
    setIsDone(false);
    setResult(null);
    setError(null);
    setIsRunning(false);
    setProgress(initialProgress());
    setExpandedSections([]);
    setCsvFilename(null);
    setCsvRows([]);
    setBulkResults([]);
  }

  async function run() {
    setIsDone(false);
    setResult(null);
    setError(null);
    const pages = parseSubmissionPages(submissionPages);
    const primaryUrl = pages[0] ?? "";
    const extraPages = pages.slice(1);
    setProgress(() => {
      const p = initialProgress();
      if (extraPages.length > 0) p[0] = { step: "Capturing screenshots", status: "waiting" };
      return p;
    });
    setExpandedSections([]);

    if (pages.length === 0) {
      setError("Please enter at least one valid submission URL starting with http");
      return;
    }

    const trimmedUrl = primaryUrl.trim();
    const trimmedGithubUrl = githubUrl.trim();
    const hadGithub = trimmedGithubUrl.length > 0;

    setIsRunning(true);
    try {
      const res = await fetch("/api/analyze/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer breakmyflow2026",
        },
        body: JSON.stringify({
          url: trimmedUrl,
          githubUrl: trimmedGithubUrl || undefined,
          mode,
          customCriteria: customCriteria.trim() || undefined,
          additionalUrls: extraPages,
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
        detail?: string,
      ) => {
        setProgress((prev) => {
          const next = prev.map((row, i) =>
            i === stepIndex ? { ...row, status, ...(detail ? { detail } : {}) } : row,
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
              const detail =
                "message" in (m.data as any) ? String((m.data as any).message ?? "") : undefined;
              applyProgress(m.data.step, st, detail && detail.length ? detail : undefined);
            }
          } else if (m.event === "result" && m.data && typeof m.data === "object") {
            gotResult = true;
            const payload = m.data as ResultShape;
            setResult(payload);
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

  async function runBulkEvaluation() {
    const rows = csvRows;
    if (!rows.length) return;
    setError(null);

    setBulkResults(
      rows.map((r) => ({
        name: r.name,
        url: r.url,
        githubUrl: r.githubUrl,
        status: "pending" as const,
      })),
    );

    for (let i = 0; i < rows.length; i++) {
      setBulkResults((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "running" } : r)),
      );

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer breakmyflow2026",
          },
          body: JSON.stringify({
            url: rows[i]?.url,
            githubUrl: rows[i]?.githubUrl,
            mode: "judge",
            customCriteria: customCriteria || "",
          }),
        });

        const data = (await response.json()) as any;

        const sections = data?.sections;
        const topFinding =
          sections?.technicalCredibility?.flag ||
          sections?.demoFlow?.flag ||
          sections?.firstImpression?.flag ||
          "No critical issues found";

        setBulkResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: "done",
                  score: typeof data?.overallScore === "number" ? data.overallScore : undefined,
                  topFinding: String(topFinding ?? "").slice(0, 80),
                  verdict: String(sections?.verdict?.headline ?? "").slice(0, 100),
                  fullResult: data as AnalysisResult,
                }
              : r,
          ),
        );
      } catch {
        setBulkResults((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: "error", error: "Evaluation failed" } : r,
          ),
        );
      }

      if (i < rows.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  function exportBulkCsv() {
    const done = bulkResults
      .filter((r) => r.status === "done" && typeof r.score === "number")
      .slice()
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    const header = ["Rank", "Name", "URL", "Score", "Top Finding", "Verdict"].join(",");
    const lines = done.map((r, idx) =>
      [
        String(idx + 1),
        escapeCsvCell(r.name ?? ""),
        escapeCsvCell(r.url),
        `${r.score}/10`,
        escapeCsvCell(r.topFinding ?? ""),
        escapeCsvCell(r.verdict ?? ""),
      ].join(","),
    );

    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "results.csv";
    a.click();
    URL.revokeObjectURL(href);
  }

  function exportReportMd() {
    if (
      !result?.sections ||
      typeof result.overallScore !== "number" ||
      typeof result.judgeQuote !== "string"
    ) {
      return;
    }
    const reportUrl =
      typeof result.url === "string"
        ? result.url
        : parseSubmissionPages(submissionPages)[0] || "(not set)";
    const dateStr = new Date().toISOString().slice(0, 10);
    const s = result.sections;
    const lines: string[] = [
      "---",
      "# Break My Flow — Evaluation Report",
      `**URL:** ${reportUrl}`,
      `**Date:** ${dateStr}`,
      `**Overall Score:** ${result.overallScore}/10`,
      "",
      `> ${result.judgeQuote}`,
      "",
      "---",
      "",
      `## 01 First Impression — ${s.firstImpression.score}/10`,
      `**${s.firstImpression.headline}**`,
      s.firstImpression.observation,
      ...(s.firstImpression.flag
        ? [`⚠ ${s.firstImpression.flag}`]
        : []),
      "",
      `## 02 Value Proposition — ${s.valueProposition.score}/10`,
      `**${s.valueProposition.headline}**`,
      s.valueProposition.observation,
      ...(s.valueProposition.flag ? [`⚠ ${s.valueProposition.flag}`] : []),
      "",
      `## 03 Demo Flow — ${s.demoFlow.score}/10`,
      `**${s.demoFlow.headline}**`,
      s.demoFlow.observation,
      ...(s.demoFlow.flag ? [`⚠ ${s.demoFlow.flag}`] : []),
      "",
      `## 04 Technical Credibility — ${s.technicalCredibility.score}/10`,
      `**${s.technicalCredibility.headline}**`,
      s.technicalCredibility.observation,
      ...(s.technicalCredibility.flag
        ? [`⚠ ${s.technicalCredibility.flag}`]
        : []),
    ];
    if (s.technicalCredibility.codeSpecific.length > 0) {
      lines.push("", "### Code Findings");
      for (const item of s.technicalCredibility.codeSpecific) {
        lines.push(`- ${item}`);
      }
    }
    lines.push(
      "",
      "## 05 Verdict",
      `**${s.verdict.headline}**`,
      "**What to do in the next 30 minutes:**",
      s.verdict.observation,
      ...(s.verdict.flag ? [`⚠ ${s.verdict.flag}`] : []),
      "",
      "---",
      "*Generated by Break My Flow — breakmyflow-production.up.railway.app*",
      '*Paste this file into Claude or ChatGPT and say: "Help me fix these issues before judging."*',
      "---",
    );
    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "break-my-flow-report.md";
    a.click();
    URL.revokeObjectURL(href);
  }

  function exportReportMdFor(name: string, reportUrl: string, report: AnalysisResult) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const s = report.sections;
    const lines: string[] = [
      "---",
      "# Break My Flow — Evaluation Report",
      `**URL:** ${reportUrl}`,
      `**Date:** ${dateStr}`,
      `**Overall Score:** ${report.overallScore}/10`,
      "",
      `> ${report.judgeQuote}`,
      "",
      "---",
      "",
      `## 01 First Impression — ${s.firstImpression.score}/10`,
      `**${s.firstImpression.headline}**`,
      s.firstImpression.observation,
      ...(s.firstImpression.flag ? [`⚠ ${s.firstImpression.flag}`] : []),
      "",
      `## 02 Value Proposition — ${s.valueProposition.score}/10`,
      `**${s.valueProposition.headline}**`,
      s.valueProposition.observation,
      ...(s.valueProposition.flag ? [`⚠ ${s.valueProposition.flag}`] : []),
      "",
      `## 03 Demo Flow — ${s.demoFlow.score}/10`,
      `**${s.demoFlow.headline}**`,
      s.demoFlow.observation,
      ...(s.demoFlow.flag ? [`⚠ ${s.demoFlow.flag}`] : []),
      "",
      `## 04 Technical Credibility — ${s.technicalCredibility.score}/10`,
      `**${s.technicalCredibility.headline}**`,
      s.technicalCredibility.observation,
      ...(s.technicalCredibility.flag ? [`⚠ ${s.technicalCredibility.flag}`] : []),
    ];
    if (s.technicalCredibility.codeSpecific.length > 0) {
      lines.push("", "### Code Findings");
      for (const item of s.technicalCredibility.codeSpecific) {
        lines.push(`- ${item}`);
      }
    }
    lines.push(
      "",
      "## 05 Verdict",
      `**${s.verdict.headline}**`,
      "**What to do in the next 30 minutes:**",
      s.verdict.observation,
      ...(s.verdict.flag ? [`⚠ ${s.verdict.flag}`] : []),
      "",
      "---",
      "*Generated by Break My Flow — breakmyflow-production.up.railway.app*",
      '*Paste this file into Claude or ChatGPT and say: \"Help me fix these issues before judging.\"*',
      "---",
    );
    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `break-my-flow-report-${name || "report"}.md`;
    a.click();
    URL.revokeObjectURL(href);
  }

  function renderReportUI(
    report: AnalysisResult,
    expanded: string[],
    setExpanded: Dispatch<SetStateAction<string[]>>,
  ) {
    const { sections, judgeQuote, overallScore } = report;
    const tech = sections.technicalCredibility;
    const showCodeSpecific = Array.isArray(tech.codeSpecific) && tech.codeSpecific.length > 0;

    const radarData = [
      { section: "First Impression", score: sections.firstImpression.score },
      { section: "Value Prop", score: sections.valueProposition.score },
      { section: "Demo Flow", score: sections.demoFlow.score },
      { section: "Technical", score: sections.technicalCredibility.score },
    ];

    const toggle = (id: string) => {
      setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const focusRadarSection = (radarLabel: string) => {
      const sectionKey = RADAR_LABEL_TO_SECTION[radarLabel];
      if (!sectionKey) return;
      setExpanded((prev) => (prev.includes(sectionKey) ? prev : [...prev, sectionKey]));
      requestAnimationFrame(() => {
        document.getElementById(`section-${sectionKey}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    const accordionHeader = (
      sectionId: string,
      label: string,
      headline: string,
      score: number | null,
      isDark: boolean,
    ) => {
      const isExpanded = expanded.includes(sectionId);
      return (
        <button type="button" onClick={() => toggle(sectionId)} className="w-full cursor-pointer text-left">
          <div className="flex w-full items-start justify-between gap-4">
            <span
              className={`text-xs font-black uppercase tracking-widest ${
                isDark ? "text-[#B9FF66]" : "text-gray-400"
              }`}
            >
              {label}
            </span>
            <div className="flex items-center gap-2">
              {score != null ? (
                <span className="rounded-full border border-black bg-[#B9FF66] px-3 py-1 text-sm font-black text-black">
                  {score}/10
                </span>
              ) : null}
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-black text-sm font-black">
                {isExpanded ? "−" : "+"}
              </span>
            </div>
          </div>
          <div className={`mt-2 text-base font-black leading-snug ${isDark ? "text-white" : "text-black"}`}>
            {headline}
          </div>
        </button>
      );
    };

    const whiteAccordion = (
      sectionId: string,
      label: string,
      section: ScorecardSectionBase,
      extras?: ReactNode,
    ) => {
      const isExpanded = expanded.includes(sectionId);
      return (
        <div id={`section-${sectionId}`} className="rounded-2xl border-2 border-black bg-white p-6 scroll-mt-4">
          {accordionHeader(sectionId, label, section.headline, section.score, false)}
          {isExpanded ? (
            <div>
              <p className="mt-4 text-sm leading-relaxed text-gray-600">{section.observation}</p>
              {section.flag ? (
                <div className="mt-4 border-l-4 border-red-500 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
                  ⚠ {section.flag}
                </div>
              ) : null}
              {extras}
            </div>
          ) : null}
        </div>
      );
    };

    const techExtras = showCodeSpecific ? (
      <div className="mt-3 rounded-xl border-2 border-blue-600 bg-white p-4">
        <p className="mb-3 text-xs font-black uppercase tracking-widest text-blue-600">CODE FINDINGS</p>
        <ul className="space-y-2">
          {tech.codeSpecific.map((line, idx) => (
            <li key={`${line}-${idx}`} className="flex items-start gap-2 text-sm font-mono text-blue-700">
              <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-blue-600" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

    const verdictExpanded = expanded.includes("verdict");
    const v = sections.verdict;

    return (
      <div className="space-y-8">
        <div className="rounded-2xl border-2 border-black bg-white p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="w-full shrink-0 sm:w-[40%]">
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-gray-400">OVERALL SCORE</p>
              <div className="flex items-baseline gap-1 leading-none">
                <span className="text-8xl font-black text-black">{overallScore}</span>
                <span className="text-2xl font-black text-gray-400">/10</span>
              </div>
              <p className="mt-3 text-sm italic leading-relaxed text-gray-700">{judgeQuote}</p>
            </div>
            <div className="min-w-0 flex-1 sm:w-[60%]">
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-400">SUBMISSION PROFILE</p>
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart cx="50%" cy="50%" outerRadius={90} data={radarData}>
                  <PolarGrid gridType="polygon" stroke="#E5E5E5" />
                  <Tooltip content={<CustomRadarTooltip />} />
                  <PolarAngleAxis
                    dataKey="section"
                    tick={(props) => {
                      const { x, y, payload, textAnchor } = props as {
                        payload: { value: string };
                        x: number | string;
                        y: number | string;
                        textAnchor: string;
                      };
                      const label = payload.value;
                      return (
                        <text
                          x={Number(x)}
                          y={Number(y)}
                          dy={4}
                          textAnchor={textAnchor as "start" | "middle" | "end"}
                          fill="#000000"
                          fontSize={12}
                          fontWeight={800}
                          style={{ cursor: "pointer", textDecoration: "underline" }}
                          onClick={() => focusRadarSection(label)}
                        >
                          {label}
                        </text>
                      );
                    }}
                  />
                  <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
                  <Radar name="Score" dataKey="score" fill="#B9FF66" fillOpacity={0.6} stroke="#000000" strokeWidth={2} isAnimationActive={true} />
                </RadarChart>
              </ResponsiveContainer>
              <p className="mt-2 text-center text-xs text-gray-400">
                Hover to see scores · Click to jump to section
              </p>
            </div>
          </div>
        </div>

        {whiteAccordion("firstImpression", "01 FIRST IMPRESSION", sections.firstImpression)}
        {whiteAccordion("valueProposition", "02 VALUE PROPOSITION", sections.valueProposition)}
        {whiteAccordion("demoFlow", "03 DEMO FLOW", sections.demoFlow)}
        {whiteAccordion("technicalCredibility", "04 TECHNICAL CREDIBILITY", sections.technicalCredibility, techExtras)}

        <div id="section-verdict" className="rounded-2xl border-2 border-black bg-[#191A23] p-6 text-white scroll-mt-4">
          {accordionHeader("verdict", "05 VERDICT", v.headline, null, true)}
          {verdictExpanded ? (
            <div>
              <p className="mt-4 text-xs font-black uppercase tracking-widest text-[#B9FF66]">
                WHAT TO DO IN THE NEXT 30 MINUTES:
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">{v.observation}</p>
              {v.flag ? (
                <div className="mt-4 border-l-4 border-red-400 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-300">
                  ⚠ {v.flag}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
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

    const v = sections.verdict;

    const radarData = [
      { section: "First Impression", score: sections.firstImpression.score },
      { section: "Value Prop", score: sections.valueProposition.score },
      { section: "Demo Flow", score: sections.demoFlow.score },
      { section: "Technical", score: sections.technicalCredibility.score },
    ];

    const focusRadarSection = (radarLabel: string) => {
      const sectionKey = RADAR_LABEL_TO_SECTION[radarLabel];
      if (!sectionKey) return;
      setExpandedSections((prev) =>
        prev.includes(sectionKey) ? prev : [...prev, sectionKey],
      );
      requestAnimationFrame(() => {
        document
          .getElementById(`section-${sectionKey}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    const accordionHeader = (
      sectionId: string,
      label: string,
      headline: string,
      score: number | null,
      isDark: boolean,
    ) => {
      const isExpanded = expandedSections.includes(sectionId);
      return (
        <button
          type="button"
          onClick={() => toggleSection(sectionId)}
          className="w-full cursor-pointer text-left"
        >
          <div className="flex w-full items-start justify-between gap-4">
            <span
              className={`text-xs font-black uppercase tracking-widest ${
                isDark ? "text-[#B9FF66]" : "text-gray-400"
              }`}
            >
              {label}
            </span>
            <div className="flex items-center gap-2">
              {score != null ? (
                <span className="rounded-full border border-black bg-[#B9FF66] px-3 py-1 text-sm font-black text-black">
                  {score}/10
                </span>
              ) : null}
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-black text-sm font-black">
                {isExpanded ? "−" : "+"}
              </span>
            </div>
          </div>
          <div
            className={`mt-2 text-base font-black leading-snug ${
              isDark ? "text-white" : "text-black"
            }`}
          >
            {headline}
          </div>
        </button>
      );
    };

    const whiteAccordion = (
      sectionId: string,
      label: string,
      section: ScorecardSectionBase,
      extras?: ReactNode,
    ) => {
      const isExpanded = expandedSections.includes(sectionId);
      return (
        <div
          id={`section-${sectionId}`}
          className="rounded-2xl border-2 border-black bg-white p-6 scroll-mt-4"
        >
          {accordionHeader(sectionId, label, section.headline, section.score, false)}
          {isExpanded ? (
            <div>
              <p className="mt-4 text-sm leading-relaxed text-gray-600">
                {section.observation}
              </p>
              {section.flag ? (
                <div className="mt-4 border-l-4 border-red-500 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
                  ⚠ {section.flag}
                </div>
              ) : null}
              {extras}
            </div>
          ) : null}
        </div>
      );
    };

    const techExtras =
      showCodeSpecific ? (
        <div className="mt-3 rounded-xl border-2 border-blue-600 bg-white p-4">
          <p className="mb-3 text-xs font-black uppercase tracking-widest text-blue-600">
            CODE FINDINGS
          </p>
          <ul className="space-y-2">
            {tech.codeSpecific.map((line, idx) => (
              <li
                key={`${line}-${idx}`}
                className="flex items-start gap-2 text-sm font-mono text-blue-700"
              >
                <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null;

    const verdictExpanded = expandedSections.includes("verdict");

    return (
      <div className="space-y-8">
        <div className="rounded-2xl border-2 border-black bg-white p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="w-full shrink-0 sm:w-[40%]">
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-gray-400">
                OVERALL SCORE
              </p>
              <div className="flex items-baseline gap-1 leading-none">
                <span className="text-8xl font-black text-black">
                  {overallScore}
                </span>
                <span className="text-2xl font-black text-gray-400">/10</span>
              </div>
              {judgeQuote ? (
                <p className="mt-3 text-sm italic leading-relaxed text-gray-700">
                  {judgeQuote}
                </p>
              ) : null}
            </div>
            <div className="min-w-0 flex-1 sm:w-[60%]">
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-400">
                SUBMISSION PROFILE
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  data={radarData}
                >
                  <PolarGrid gridType="polygon" stroke="#E5E5E5" />
                  <Tooltip content={<CustomRadarTooltip />} />
                  <PolarAngleAxis
                    dataKey="section"
                    tick={(props) => {
                      const { x, y, payload, textAnchor } = props as {
                        payload: { value: string };
                        x: number | string;
                        y: number | string;
                        textAnchor: string;
                      };
                      const label = payload.value;
                      return (
                        <text
                          x={Number(x)}
                          y={Number(y)}
                          dy={4}
                          textAnchor={textAnchor as "start" | "middle" | "end"}
                          fill="#000000"
                          fontSize={12}
                          fontWeight={800}
                          style={{
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                          onClick={() => focusRadarSection(label)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              focusRadarSection(label);
                            }
                          }}
                        >
                          {label}
                        </text>
                      );
                    }}
                  />
                  <PolarRadiusAxis
                    domain={[0, 10]}
                    tick={false}
                    axisLine={false}
                  />
                  <Radar
                    name="Score"
                    dataKey="score"
                    fill="#B9FF66"
                    fillOpacity={0.6}
                    stroke="#000000"
                    strokeWidth={2}
                    isAnimationActive={true}
                  />
                </RadarChart>
              </ResponsiveContainer>
              <p className="mt-2 text-center text-xs text-gray-400">
                Hover to see scores · Click to jump to section
              </p>
            </div>
          </div>

        </div>

        {whiteAccordion(
          "firstImpression",
          "01 FIRST IMPRESSION",
          sections.firstImpression,
        )}
        {whiteAccordion(
          "valueProposition",
          "02 VALUE PROPOSITION",
          sections.valueProposition,
        )}
        {whiteAccordion("demoFlow", "03 DEMO FLOW", sections.demoFlow)}
        {whiteAccordion(
          "technicalCredibility",
          "04 TECHNICAL CREDIBILITY",
          sections.technicalCredibility,
          techExtras,
        )}

        <div
          id="section-verdict"
          className="rounded-2xl border-2 border-black bg-[#191A23] p-6 text-white scroll-mt-4"
        >
          {accordionHeader("verdict", "05 VERDICT", v.headline, null, true)}
          {verdictExpanded ? (
            <div>
              <p className="mt-4 text-xs font-black uppercase tracking-widest text-[#B9FF66]">
                WHAT TO DO IN THE NEXT 30 MINUTES:
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">
                {v.observation}
              </p>
              {v.flag ? (
                <div className="mt-4 border-l-4 border-red-400 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-300">
                  ⚠ {v.flag}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F3F3] text-black">
      {/* Hero */}
      <section className="relative flex flex-col bg-[#F3F3F3] px-4 sm:px-6 lg:px-8">
        <header className="relative z-20 mx-auto w-full max-w-6xl bg-[#F3F3F3] py-6">
          <span className="text-xl font-black tracking-tight text-black">
            Break My Flow
          </span>
        </header>

        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col pt-12 pb-10">
          <div className="flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
            <div className="flex-1">
              <h1 className="max-w-4xl text-6xl font-black leading-tight tracking-tight text-black">
                <span className="block">You ship it.</span>
                <span className="block">We try to break it.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-gray-600 sm:text-lg">
                Real screenshots, real code analysis, real verdicts — in 60
                seconds.
              </p>
              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(true);
                    setMode("builder");
                    scrollToEvaluate();
                  }}
                  className="rounded-full border-2 border-black bg-[#B9FF66] px-8 py-4 text-center text-base font-bold text-black transition hover:opacity-90"
                >
                  For Builders
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(true);
                    setMode("judge");
                    scrollToEvaluate();
                  }}
                  className="rounded-full border-2 border-black bg-white px-8 py-4 text-center text-base font-bold text-black transition hover:bg-gray-50"
                >
                  For Judges
                </button>
              </div>
            </div>

            <div className="hidden w-80 items-center justify-center md:flex xl:w-96">
              <img
                src="/chart_transparent.png"
                alt="Sample evaluation scorecard"
                className="w-full object-contain drop-shadow-sm"
              />
            </div>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              {
                t: "60-Second Evaluation",
                d: "Real browser screenshot + Claude vision analysis. No guesswork.",
              },
              {
                t: "Three-Layer Code Analysis",
                d: "Quality signals, completeness score, and claim vs code honesty checks.",
              },
              {
                t: "Judge + Builder Mode",
                d: "Organisers evaluate submissions. Builders self-test before judging.",
              },
            ].map((card, i) => {
              const cardClass =
                i === 0
                  ? "bg-white text-black"
                  : i === 1
                    ? "bg-[#B9FF66] text-black"
                    : "bg-[#191A23] text-white";
              const titleClass =
                i === 2
                  ? "mt-4 mb-2 text-xl font-bold text-white"
                  : "mt-4 mb-2 text-xl font-bold text-black";
              const descClass =
                i === 2
                  ? "text-sm leading-relaxed text-gray-300"
                  : "text-sm leading-relaxed text-gray-600";
              return (
                <div
                  key={card.t}
                  className={`rounded-2xl border-2 border-black p-5 ${cardClass}`}
                >
                  <h2 className={titleClass}>{card.t}</h2>
                  <p className={descClass}>{card.d}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Evaluate */}
      {showForm ? (
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
            {mode === "builder" ? (
              <>
                <div className="space-y-1">
                  <label
                    htmlFor="submissionPages"
                    className="text-xs font-black uppercase tracking-widest text-black"
                  >
                    SUBMISSION PAGE(S)
                  </label>
                  <textarea
                    id="submissionPages"
                    value={submissionPages}
                    onChange={(e) => setSubmissionPages(e.target.value)}
                    rows={2}
                    required
                    placeholder={"https://your-app.vercel.app,\nhttps://your-app.vercel.app/dashboard"}
                    className="bg-white border-2 border-black rounded-xl px-4 py-3 text-black text-sm w-full resize-none"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Paste your main URL. Add key pages separated by commas — max 3. We evaluate exactly what you show us, not your whole site.
                  </p>
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
              </>
            ) : null}

            <div className="space-y-2">
              <label
                htmlFor="customCriteria"
                className="text-sm font-bold uppercase tracking-wide text-black"
              >
                {mode === "judge"
                  ? "JUDGING CRITERIA (optional)"
                  : "Custom criteria"}{" "}
                <span className="normal-case font-normal text-[#555555]">
                  (optional)
                </span>
              </label>
              <textarea
                id="customCriteria"
                value={customCriteria}
                onChange={(e) => setCustomCriteria(e.target.value)}
                rows={4}
                placeholder={
                  mode === "judge"
                    ? "e.g. Must use AI, bonus for live demo, accessibility matters — applies to all submissions"
                    : "Add any specific judging criteria e.g. 'Must use AI', 'Accessibility matters', 'Bonus for live demo'"
                }
                className="w-full resize-y rounded-xl border-2 border-black bg-white px-4 py-3 text-black placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-[#B9FF66]"
              />
            </div>

            {mode === "builder" ? (
              <>
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
                        {row.status === "active" && row.detail
                          ? ` ${row.detail}`
                          : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <label className="block text-sm font-bold uppercase tracking-wide text-black">
                  Submissions CSV
                </label>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => document.getElementById("csvInput")?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      document.getElementById("csvInput")?.click();
                    }
                  }}
                  className="cursor-pointer rounded-2xl border-2 border-dashed border-black bg-white p-12 text-center"
                >
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-black text-4xl font-black">
                    ↑
                  </div>
                  <p className="font-bold text-black">Upload submissions.csv</p>
                  <p className="mt-2 text-sm text-gray-600">
                    Three columns required: name, url, github_url (optional)
                  </p>
                  {csvFilename ? (
                    <p className="mt-4 text-sm font-semibold text-black">
                      {csvFilename} — {csvRows.length} rows detected
                    </p>
                  ) : null}
                </div>
                <input
                  id="csvInput"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const text = await f.text();
                    setCsvFilename(f.name);
                    setCsvRows(parseCSV(text));
                    setBulkResults([]);
                  }}
                />

                <button
                  type="button"
                  onClick={runBulkEvaluation}
                  disabled={csvRows.length === 0}
                  className="w-full rounded-full border-2 border-black bg-[#B9FF66] py-4 text-center text-lg font-bold text-black transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Run Bulk Evaluation ({csvRows.length} submissions)
                </button>

                {bulkResults.length > 0 ? (
                  <div className="space-y-4">
                    {bulkResults.some(
                      (r) => r.status === "pending" || r.status === "running",
                    ) ? (
                      <p className="mb-4 text-center text-sm text-gray-500">
                        {
                          bulkResults.filter((r) => r.status === "done").length
                        }{" "}
                        of {bulkResults.length} complete ·{" "}
                        {
                          bulkResults.filter(
                            (r) =>
                              r.status === "pending" || r.status === "running",
                          ).length
                        }{" "}
                        remaining
                      </p>
                    ) : null}

                    <div className="overflow-hidden rounded-2xl border-2 border-black">
                      <table className="w-full border-collapse text-left text-sm text-black">
                        <thead>
                          <tr className="bg-[#191A23] text-white">
                            {["Rank", "Team/URL", "Score", "Top Finding", "Verdict", "Status"].map(
                              (h) => (
                                <th key={h} className="p-4 text-sm font-black">
                                  {h}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const doneSorted = bulkResults
                              .map((r, idx) => ({ r, idx }))
                              .filter((x) => x.r.status === "done")
                              .sort((a, b) => (b.r.score ?? -1) - (a.r.score ?? -1));

                            const doneOrder = new Map<number, number>();
                            doneSorted.forEach((x, rankIdx) =>
                              doneOrder.set(x.idx, rankIdx + 1),
                            );

                            return bulkResults.map((r, idx) => {
                              let rowClass = idx % 2 === 0 ? "bg-white" : "bg-[#F3F3F3]";
                              if (r.status === "running") rowClass = "animate-pulse bg-[#B9FF66]/10";
                              if (r.status === "error") rowClass = "bg-red-50 text-red-600";

                              let displayName = r.name || r.url;
                              if (displayName.length > 30) {
                                displayName = `${displayName.slice(0, 27)}...`;
                              }

                              const rank =
                                r.status === "done" ? doneOrder.get(idx) ?? "" : "";

                              const statusEl =
                                r.status === "pending" ? (
                                  <span className="flex items-center gap-2">
                                    <span className="h-2 w-2 rounded-full bg-gray-400" />
                                    Pending
                                  </span>
                                ) : r.status === "running" ? (
                                  <span className="flex items-center gap-2">
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-[#B9FF66]" />
                                    Evaluating...
                                  </span>
                                ) : r.status === "done" ? (
                                  <span className="flex items-center gap-2 text-green-700">
                                    <span className="font-black">✓</span>
                                    {typeof r.score === "number" ? `${r.score}/10` : "Done"}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-2">
                                    <span className="font-black text-red-600">✕</span>
                                    Failed
                                  </span>
                                );

                              return (
                                <tr key={`${r.url}-${idx}`} className={rowClass}>
                                  <td className="p-4 font-black text-[#B9FF66]">
                                    {rank}
                                  </td>
                                  <td className="p-4 font-semibold">
                                    {r.status === "done" && r.fullResult ? (
                                      <button
                                        type="button"
                                        className="cursor-pointer font-bold underline text-black transition-colors hover:text-[#B9FF66]"
                                        onClick={() => {
                                          setModalExpandedSections([
                                            "firstImpression",
                                            "valueProposition",
                                            "demoFlow",
                                            "technicalCredibility",
                                            "verdict",
                                          ]);
                                          setSelectedReport({
                                            name: r.name,
                                            url: r.url,
                                            result: r.fullResult!,
                                          });
                                        }}
                                      >
                                        {displayName}
                                      </button>
                                    ) : (
                                      displayName
                                    )}
                                  </td>
                                  <td className="p-4">
                                    {r.status === "done" && typeof r.score === "number"
                                      ? `${r.score}/10`
                                      : r.status === "error"
                                        ? "—"
                                        : "Pending..."}
                                  </td>
                                  <td className="p-4">{r.topFinding ?? ""}</td>
                                  <td className="p-4">{r.verdict ?? ""}</td>
                                  <td className="p-4">{statusEl}</td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>

                    {!bulkResults.some(
                      (r) => r.status === "pending" || r.status === "running",
                    ) &&
                    bulkResults.length > 0 ? (
                      <button
                        type="button"
                        onClick={exportBulkCsv}
                        className="w-full rounded-full border-2 border-black bg-white px-8 py-3 text-center font-bold text-black transition-colors hover:bg-[#B9FF66]"
                      >
                        Export Results
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}

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
                  {result &&
                  result.sections &&
                  typeof result.overallScore === "number" &&
                  typeof result.judgeQuote === "string" ? (
                    <button
                      type="button"
                      onClick={exportReportMd}
                      className="mt-6 w-full rounded-full border-2 border-black bg-white px-8 py-3 text-center font-bold text-black transition-colors hover:bg-[#B9FF66]"
                    >
                      Export as .md
                    </button>
                  ) : null}
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
      ) : null}

      {selectedReport ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 py-8"
          onClick={() => setSelectedReport(null)}
        >
          <div
            className="relative mx-4 w-full max-w-3xl rounded-2xl bg-[#F3F3F3] p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedReport(null)}
              className="absolute right-4 top-4 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-2 border-black text-lg font-black transition-colors hover:bg-[#B9FF66]"
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="text-2xl font-black text-black">
              {selectedReport.name}
            </h2>
            <p className="mb-6 text-sm text-gray-500">{selectedReport.url}</p>

            {renderReportUI(
              selectedReport.result,
              modalExpandedSections,
              setModalExpandedSections,
            )}

            <button
              type="button"
              onClick={() =>
                exportReportMdFor(
                  selectedReport.name,
                  selectedReport.url,
                  selectedReport.result,
                )
              }
              className="mt-6 w-full rounded-full border-2 border-black bg-white px-8 py-3 text-center font-bold text-black transition-colors hover:bg-[#B9FF66]"
            >
              Export as .md
            </button>
          </div>
        </div>
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
