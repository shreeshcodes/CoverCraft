"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import {
  buildFileBaseName,
  buildPlainText,
  copyToClipboard,
  downloadDocx,
  downloadTxt,
  printToPdf,
  toParagraphs,
  type LetterHeader,
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
type UploadStatus =
  | { state: "idle" }
  | { state: "reading"; fileName: string }
  | { state: "done"; fileName: string; characters: number }
  | { state: "error"; fileName: string; message: string; details?: string };

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
  // Inputs
  const [applicantName, setApplicantName] = useState("");
  const [contactLine, setContactLine] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [jobText, setJobText] = useState("");
  const [tone, setTone] = useState<Tone>("Professional");

  // Letter, as it appears on the page
  const [dateText, setDateText] = useState("");
  const [company, setCompany] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [isEdited, setIsEdited] = useState(false);

  // UI state
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<ErrorState>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ state: "idle" });
  const { isLoaded, isSignedIn: clerkSignedIn } = useUser();
  const isSignedIn = isLoaded && !!clerkSignedIn;
  const authStatus = !isLoaded ? "loading" : isSignedIn ? "authenticated" : "unauthenticated";

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasLetter = bodyText.trim().length > 0;
  const canGenerate =
    isSignedIn && resumeText.trim().length > 0 && jobText.trim().length > 0 && !isGenerating;
  const header: LetterHeader = {
    name: applicantName.trim(),
    contact: contactLine.trim(),
    date: dateText.trim(),
    company: company.trim(),
  };
  const wordCount = hasLetter ? bodyText.trim().split(/\s+/).length : 0;
  const fileBaseName = buildFileBaseName(applicantName);

  // Grow the editor to fit its content so the page reads like a real sheet.
  const resizeEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resizeEditor();
  }, [bodyText, resizeEditor]);

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
      if (!letter || typeof letter.greeting !== "string" || !letter.greeting.trim()) {
        setError({ message: "The server returned an empty cover letter. Please try again." });
        return;
      }

      setDateText(letter.date ?? "");
      setCompany(letter.company ?? "");
      setBodyText(
        [letter.greeting, letter.opening, letter.body, letter.closing, letter.signoff]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join("\n\n"),
      );
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
      await downloadDocx(header, bodyText, fileBaseName);
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
      downloadTxt(buildPlainText(header, bodyText), fileBaseName);
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
      await copyToClipboard(buildPlainText(header, bodyText));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState("idle"), 2000);
  };

  const handleResumeFile = async (file: File) => {
    setUploadStatus({ state: "reading", fileName: file.name });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const err = (data ?? {}) as Partial<GenerateErrorResponse>;
        setUploadStatus({
          state: "error",
          fileName: file.name,
          message: err.error || "Could not read this file.",
          details: err.details,
        });
        return;
      }

      const { text } = data as { text: string };
      setResumeText(text);
      setUploadStatus({ state: "done", fileName: file.name, characters: text.length });
    } catch (err) {
      setUploadStatus({
        state: "error",
        fileName: file.name,
        message: "Could not upload the file.",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const loadSample = () => {
    setApplicantName("Jane Doe");
    setContactLine("jane.doe@email.com · Seattle, WA");
    setResumeText(SAMPLE_RESUME);
    setJobText(SAMPLE_JOB);
    setUploadStatus({ state: "idle" });
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
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadSample}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Load example
            </button>
            {isSignedIn && <UserButton />}
            </div>
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

              {authStatus === "unauthenticated" && <SignInPanel />}

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
                label="Contact line for the letterhead (optional)"
                htmlFor="contactLine"
                hint="email · phone · city"
              >
                <input
                  id="contactLine"
                  type="text"
                  autoComplete="off"
                  value={contactLine}
                  maxLength={160}
                  onChange={(e) => setContactLine(e.target.value)}
                  placeholder="jane@email.com · (555) 010-2030 · Seattle, WA"
                  className={inputClass}
                />
              </Field>

              <Field
                label="Resume"
                htmlFor="resumeText"
                hint={`${resumeText.length.toLocaleString()} / ${MAX_RESUME_CHARS.toLocaleString()}`}
              >
                <ResumeUpload status={uploadStatus} onFile={handleResumeFile} disabled={!isSignedIn} />
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
                    {isSignedIn ? "Generate Cover Letter" : "Sign in to generate"}
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
                    ? `${wordCount} words · Click the letter to edit before downloading`
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

            {/* Letter sheet */}
            <div
              className="letter-sheet"
              onClick={() => hasLetter && editorRef.current?.focus()}
            >
              {isGenerating && !hasLetter ? (
                <LetterSkeleton />
              ) : hasLetter ? (
                <>
                  {isGenerating && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
                      <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow ring-1 ring-slate-200">
                        <Spinner className="h-4 w-4 text-indigo-600" />
                        Rewriting…
                      </div>
                    </div>
                  )}

                  <header>
                    <p className={header.name ? "letter-name" : "letter-name text-slate-300"}>
                      {header.name || "Your Name"}
                    </p>
                    {header.contact && <p className="letter-contact">{header.contact}</p>}
                    <hr className="letter-rule" />
                  </header>

                  <div className="mb-6 text-[15px] text-slate-800">
                    <label htmlFor="letterDate" className="sr-only">
                      Letter date
                    </label>
                    <input
                      id="letterDate"
                      type="text"
                      value={dateText}
                      placeholder="Date"
                      onChange={(e) => {
                        setDateText(e.target.value);
                        setIsEdited(true);
                      }}
                      className="letter-inline letter-text"
                    />
                  </div>

                  <div className="mb-6 text-[15px] text-slate-800">
                    <label htmlFor="letterCompany" className="sr-only">
                      Company name
                    </label>
                    <input
                      id="letterCompany"
                      type="text"
                      value={company}
                      placeholder="Company name"
                      onChange={(e) => {
                        setCompany(e.target.value);
                        setIsEdited(true);
                      }}
                      className="letter-inline letter-text"
                    />
                  </div>

                  <label htmlFor="letterEditor" className="sr-only">
                    Cover letter body (editable)
                  </label>
                  <textarea
                    id="letterEditor"
                    ref={editorRef}
                    value={bodyText}
                    spellCheck
                    onChange={(e) => {
                      setBodyText(e.target.value);
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
        {header.name && <p className="print-name">{header.name.toUpperCase()}</p>}
        {header.contact && <p className="print-contact">{header.contact}</p>}
        {(header.name || header.contact) && <div className="print-rule" />}
        {header.date && <p>{header.date}</p>}
        {header.company && <p>{header.company}</p>}
        {toParagraphs(bodyText).map((lines, i) => (
          <p key={i}>
            {lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ))}
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
    <div className="flex min-h-[860px] flex-col items-center justify-center text-center font-sans">
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
  const block = (w: string, key: string) => (
    <div key={key} className={`h-3.5 animate-pulse rounded bg-slate-200 ${w}`} />
  );
  return (
    <div aria-label="Generating cover letter" role="status" className="space-y-3">
      {block("w-1/3", "n1")}
      {block("w-1/4", "n2")}
      <div className="h-8" />
      {block("w-1/2", "d1")}
      <div className="h-6" />
      {block("w-1/3", "g1")}
      <div className="h-4" />
      {["w-full", "w-full", "w-11/12", "w-4/5"].map((w, i) => block(w, `o${i}`))}
      <div className="h-4" />
      {["w-full", "w-full", "w-10/12", "w-full", "w-3/4"].map((w, i) => block(w, `b${i}`))}
      <div className="h-4" />
      {["w-full", "w-11/12", "w-2/3"].map((w, i) => block(w, `c${i}`))}
      <div className="h-6" />
      {block("w-1/5", "s1")}
      {block("w-1/4", "s2")}
    </div>
  );
}

function ResumeUpload({
  status,
  onFile,
  disabled = false,
}: {
  status: UploadStatus;
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = status.state === "reading";
  const locked = busy || disabled;

  const openPicker = () => {
    if (!locked) inputRef.current?.click();
  };

  return (
    <div className="mb-2">
      <div
        role="button"
        tabIndex={0}
        aria-disabled={locked}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !locked) onFile(file);
        }}
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-4 text-center text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
          dragging
            ? "border-indigo-500 bg-indigo-50"
            : "border-slate-300 bg-slate-50 hover:border-indigo-400 hover:bg-indigo-50/40"
        } ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        {busy ? (
          <>
            <Spinner className="h-4 w-4 text-indigo-600" />
            <span className="text-slate-700">Reading {status.fileName}…</span>
          </>
        ) : disabled ? (
          <>
            <UploadIcon className="h-5 w-5 text-slate-400" />
            <span className="font-medium text-slate-600">Sign in to upload a resume</span>
          </>
        ) : (
          <>
            <UploadIcon className="h-5 w-5 text-indigo-600" />
            <span className="font-medium text-slate-700">Upload your resume</span>
            <span className="text-xs text-slate-500">
              PDF, DOCX, or TXT · up to 4 MB · drop a file here or click to browse
            </span>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        tabIndex={-1}
        disabled={locked}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />

      {status.state === "done" && (
        <p className="mt-2 text-xs text-emerald-700">
          Loaded {status.fileName} ({status.characters.toLocaleString()} characters). Edit the text below if needed.
        </p>
      )}
      {status.state === "error" && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          <p className="font-medium">{status.message}</p>
          {status.details && <p className="mt-0.5">{status.details}</p>}
        </div>
      )}
    </div>
  );
}

function SignInPanel() {
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
      <p className="text-sm font-semibold text-slate-900">Sign in to generate letters</p>
      <p className="mt-1 text-xs text-slate-600">Sign in with your email, Google, or LinkedIn to continue.</p>
      <SignInButton mode="modal">
        <button
          type="button"
          className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Sign in
        </button>
      </SignInButton>
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

function UploadIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
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
