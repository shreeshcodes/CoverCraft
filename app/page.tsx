"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  buildFileBaseName,
  copyToClipboard,
  downloadDocx,
  downloadTxt,
  printToPdf,
} from "@/lib/export";
import {
  MAX_JOB_CHARS,
  MAX_NAME_CHARS,
  MAX_RESUME_CHARS,
  TONES,
  type CoverLetter,
  type GenerateErrorResponse,
  type GenerateRequest,
  type Tone,
} from "@/lib/types";

type ErrorState = { message: string; details?: string } | null;
type CopyState = "idle" | "copied" | "failed";

const SAMPLE_RESUME = `JANE DOE
jane.doe@email.com · Seattle, WA

EXPERIENCE
Senior Frontend Engineer, Brightline Health (2021–Present)
- Led migration of patient portal from AngularJS to React/TypeScript, cutting page load time 48%
- Built a shared design system used by 6 product teams; reduced UI bug reports 35%
- Mentored 4 junior engineers; introduced RFC-based architecture reviews

Frontend Engineer, Parcelly (2018–2021)
- Shipped real-time shipment tracking dashboard (React, WebSockets) used by 12k merchants
- Owned accessibility remediation to WCAG 2.1 AA across checkout flow

SKILLS
TypeScript, React, Next.js, Node.js, GraphQL, Accessibility, Design Systems, Jest, Playwright

EDUCATION
B.S. Computer Science, University of Washington (2018)`;

const SAMPLE_JOB = `Staff Frontend Engineer — Lumen Analytics (Remote, US)

Lumen builds analytics tools that help climate-tech companies measure emissions. We're hiring a Staff Frontend Engineer to lead the architecture of our customer-facing dashboard.

You will:
- Set technical direction for our React/TypeScript frontend
- Build and evolve our component library and design system
- Partner with design and product to ship data-heavy, accessible UIs
- Mentor engineers and raise the bar on code quality

You have:
- 6+ years building production web apps with React and TypeScript
- Experience leading large-scale frontend migrations or re-architectures
- A strong accessibility and performance mindset
- Bonus: real-time data visualization experience`;

export default function Home() {
  const [applicantName, setApplicantName] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [jobText, setJobText] = useState("");
  const [tone, setTone] = useState<Tone>("Professional");

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<ErrorState>(null);
  const [letterText, setLetterText] = useState("");
  const [isEdited, setIsEdited] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasLetter = letterText.trim().length > 0;
  const canGenerate = resumeText.trim().length > 0 && jobText.trim().length > 0 && !isGenerating;
  const wordCount = hasLetter ? letterText.trim().split(/\s+/).length : 0;
  const fileBaseName = buildFileBaseName(applicantName);

  // Grow the editor to fit its content so the preview reads like a real page.
  const resizeEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resizeEditor();
  }, [letterText, resizeEditor]);

  useEffect(() => {
    window.addEventListener("resize", resizeEditor);
    return () => window.removeEventListener("resize", resizeEditor);
  }, [resizeEditor]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    if (
      isEdited &&
      hasLetter &&
      !window.confirm("Generating a new letter will replace your edits. Continue?")
    ) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsGenerating(true);
    setError(null);
    setExportError(null);

    const payload: GenerateRequest = {
      resumeText: resumeText.trim(),
      jobText: jobText.trim(),
      applicantName: applicantName.trim() || undefined,
      tone,
    };

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const err = (data ?? {}) as Partial<GenerateErrorResponse>;
        setError({
          message: err.error || `Request failed with status ${res.status}.`,
          details: err.details,
        });
        return;
      }

      const letter = data as CoverLetter | null;
      if (!letter || typeof letter.fullText !== "string" || !letter.fullText.trim()) {
        setError({ message: "The server returned an empty cover letter. Please try again." });
        return;
      }

      setLetterText(letter.fullText);
      setIsEdited(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError({
        message: "Could not reach the server.",
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsGenerating(false);
      }
    }
  }, [applicantName, canGenerate, hasLetter, isEdited, jobText, resumeText, tone]);

  const handleDocx = async () => {
    if (!hasLetter) return;
    setExportError(null);
    setIsExportingDocx(true);
    try {
      await downloadDocx(letterText, fileBaseName);
    } catch (err) {
      setExportError(
        `Could not create the Word file: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleTxt = () => {
    if (!hasLetter) return;
    setExportError(null);
    try {
      downloadTxt(letterText, fileBaseName);
    } catch (err) {
      setExportError(
        `Could not create the text file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handlePdf = () => {
    if (!hasLetter) return;
    setExportError(null);
    printToPdf(fileBaseName);
  };

  const handleCopy = async () => {
    if (!hasLetter) return;
    try {
      await copyToClipboard(letterText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState("idle"), 2000);
  };

  const loadSample = () => {
    setApplicantName("Jane Doe");
    setResumeText(SAMPLE_RESUME);
    setJobText(SAMPLE_JOB);
  };

  return (
    <>
      <div className="no-print">
        <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
                <PenIcon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-slate-900 sm:text-lg">
                  Cover<span className="text-indigo-600">Craft</span>
                </h1>
                <p className="hidden text-xs text-slate-500 sm:block">
                  AI cover letters, tailored to the role and grounded in your resume.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadSample}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Load example
            </button>
          </div>
        </header>

        <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:px-8">
          {/* ------------------------------ Inputs ------------------------------ */}
          <section aria-labelledby="inputs-heading" className="lg:sticky lg:top-6 lg:self-start">
            <form
              className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
              onSubmit={(e) => {
                e.preventDefault();
                void handleGenerate();
              }}
            >
              <h2 id="inputs-heading" className="text-sm font-semibold text-slate-900">
                Your details
              </h2>

              <Field label="Applicant full name" htmlFor="applicantName">
                <input
                  id="applicantName"
                  type="text"
                  autoComplete="name"
                  value={applicantName}
                  maxLength={MAX_NAME_CHARS}
                  onChange={(e) => setApplicantName(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  className={inputClass}
                />
              </Field>

              <Field
                label="Resume"
                htmlFor="resumeText"
                hint={`${resumeText.length.toLocaleString()} / ${MAX_RESUME_CHARS.toLocaleString()}`}
              >
                <textarea
                  id="resumeText"
                  required
                  rows={9}
                  value={resumeText}
                  maxLength={MAX_RESUME_CHARS}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder={
                    "Paste your full resume as plain text: experience, achievements (with numbers if you have them), skills, and education.\n\nTip: copy it straight from your PDF or Word file."
                  }
                  className={`${inputClass} resize-y font-mono text-[13px] leading-relaxed`}
                />
              </Field>

              <Field
                label="Target job description / posting"
                htmlFor="jobText"
                hint={`${jobText.length.toLocaleString()} / ${MAX_JOB_CHARS.toLocaleString()}`}
              >
                <textarea
                  id="jobText"
                  required
                  rows={8}
                  value={jobText}
                  maxLength={MAX_JOB_CHARS}
                  onChange={(e) => setJobText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void handleGenerate();
                    }
                  }}
                  placeholder="Paste the job posting: company name, role title, responsibilities, and requirements."
                  className={`${inputClass} resize-y text-[13px] leading-relaxed`}
                />
              </Field>

              <Field label="Tone" htmlFor="tone">
                <select
                  id="tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value as Tone)}
                  className={`${inputClass} cursor-pointer`}
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>

              <button
                type="submit"
                disabled={!canGenerate}
                aria-busy={isGenerating}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:bg-indigo-300"
              >
                {isGenerating ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Writing your cover letter…
                  </>
                ) : (
                  <>
                    <SparkleIcon className="h-4 w-4" />
                    Generate Cover Letter
                  </>
                )}
              </button>
              <p className="text-center text-xs text-slate-500">
                Uses only facts from your resume. Press ⌘/Ctrl + Enter in the job field to
                generate.
              </p>

              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                >
                  <p className="font-medium">{error.message}</p>
                  {error.details && (
                    <p className="mt-1 break-words text-red-700/90">{error.details}</p>
                  )}
                </div>
              )}
            </form>
          </section>

          {/* ------------------------------ Preview ----------------------------- */}
          <section aria-labelledby="preview-heading" className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="preview-heading" className="text-sm font-semibold text-slate-900">
                  Preview
                </h2>
                <p className="text-xs text-slate-500">
                  {hasLetter
                    ? `${wordCount} words · Click the page to edit before downloading`
                    : "Your letter will appear here"}
                </p>
              </div>

              <div role="toolbar" aria-label="Export options" className="flex flex-wrap gap-2">
                <ToolbarButton
                  onClick={handleDocx}
                  disabled={!hasLetter || isExportingDocx}
                  icon={
                    isExportingDocx ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <DownloadIcon className="h-4 w-4" />
                    )
                  }
                  label="Download .docx"
                />
                <ToolbarButton
                  onClick={handlePdf}
                  disabled={!hasLetter}
                  icon={<DownloadIcon className="h-4 w-4" />}
                  label="Download .pdf"
                />
                <ToolbarButton
                  onClick={handleTxt}
                  disabled={!hasLetter}
                  icon={<DownloadIcon className="h-4 w-4" />}
                  label="Download .txt"
                />
                <ToolbarButton
                  onClick={handleCopy}
                  disabled={!hasLetter}
                  icon={
                    copyState === "copied" ? (
                      <CheckIcon className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <CopyIcon className="h-4 w-4" />
                    )
                  }
                  label={
                    copyState === "copied"
                      ? "Copied!"
                      : copyState === "failed"
                        ? "Copy failed"
                        : "Copy to Clipboard"
                  }
                  highlight={copyState === "copied"}
                />
              </div>
            </div>

            <span className="sr-only" aria-live="polite">
              {copyState === "copied" ? "Cover letter copied to clipboard" : ""}
            </span>

            {exportError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                {exportError}
              </div>
            )}

            {/* Document page */}
            <div
              className={`relative mx-auto min-h-[720px] w-full max-w-[816px] rounded-sm bg-white px-7 py-10 shadow-[0_1px_3px_rgba(15,23,42,0.08),0_12px_32px_-8px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/5 sm:px-16 sm:py-16 ${
                hasLetter ? "cursor-text" : ""
              }`}
              onClick={() => hasLetter && editorRef.current?.focus()}
            >
              {isGenerating && !hasLetter ? (
                <LetterSkeleton />
              ) : hasLetter ? (
                <>
                  {isGenerating && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-sm bg-white/70 backdrop-blur-[1px]">
                      <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow ring-1 ring-slate-200">
                        <Spinner className="h-4 w-4 text-indigo-600" />
                        Rewriting…
                      </div>
                    </div>
                  )}
                  <label htmlFor="letterEditor" className="sr-only">
                    Cover letter text (editable)
                  </label>
                  <textarea
                    id="letterEditor"
                    ref={editorRef}
                    value={letterText}
                    spellCheck
                    onChange={(e) => {
                      setLetterText(e.target.value);
                      setIsEdited(true);
                    }}
                    className="letter-editor letter-text text-slate-900"
                  />
                </>
              ) : (
                <EmptyState />
              )}
            </div>
          </section>
        </main>
      </div>

      {/* Print-only copy of the letter: the only thing rendered by window.print(). */}
      <article id="print-letter" className="print-only" aria-hidden="true">
        <div className="letter-text">{letterText}</div>
      </article>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Small presentational components
 * ------------------------------------------------------------------------- */

const inputClass =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {hint && <span className="text-xs tabular-nums text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  icon,
  label,
  highlight = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium shadow-xs transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 ${
        highlight
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[600px] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
        <DocumentIcon className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium text-slate-700">No cover letter yet</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500">
        Paste your resume and the job posting, choose a tone, and hit{" "}
        <span className="font-medium text-slate-700">Generate Cover Letter</span>.
      </p>
    </div>
  );
}

function LetterSkeleton() {
  const widths = ["w-1/3", "w-1/4", "", "w-1/2", "", "w-full", "w-full", "w-11/12", "w-4/5", ""];
  return (
    <div aria-label="Generating cover letter" role="status" className="animate-pulse space-y-3">
      {widths.map((w, i) =>
        w ? (
          <div key={i} className={`h-3.5 rounded bg-slate-200 ${w}`} />
        ) : (
          <div key={i} className="h-3" />
        ),
      )}
      {["w-full", "w-full", "w-10/12", "w-full", "w-3/4"].map((w, i) => (
        <div key={`b${i}`} className={`h-3.5 rounded bg-slate-200 ${w}`} />
      ))}
      <div className="h-3" />
      {["w-full", "w-11/12", "w-2/3"].map((w, i) => (
        <div key={`c${i}`} className={`h-3.5 rounded bg-slate-200 ${w}`} />
      ))}
      <div className="h-3" />
      <div className="h-3.5 w-1/5 rounded bg-slate-200" />
      <div className="h-3.5 w-1/4 rounded bg-slate-200" />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Icons (inline SVG, no extra dependency)
 * ------------------------------------------------------------------------- */

type IconProps = { className?: string };

function Spinner({ className }: IconProps) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

function svgProps(className?: string) {
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function CopyIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function SparkleIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 17v4M17 19h4" />
    </svg>
  );
}

function PenIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function DocumentIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </svg>
  );
}
