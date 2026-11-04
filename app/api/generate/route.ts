import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  MAX_JOB_CHARS,
  MAX_NAME_CHARS,
  MAX_RESUME_CHARS,
  MODEL_FIELDS,
  TONES,
  type CoverLetter,
  type GenerateErrorResponse,
  type Tone,
} from "@/lib/types";

// The OpenAI SDK needs the Node.js runtime, and generation can take a while.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Groq's API is OpenAI-compatible, so the official OpenAI SDK works against it.
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
// Backup models, tried in order when the primary is busy (429/5xx) or unavailable (404).
const FALLBACK_MODELS = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

const SYSTEM_PROMPT = `You are an executive career coach who has placed senior candidates at leading companies. You write cover letters that read as if a sharp, experienced professional wrote them by hand: specific, confident, and concise. Generic letters get ignored, so every sentence must earn its place.

EVIDENCE RULES
- Use ONLY facts that appear in the resume: employers, titles, dates, metrics, tools, projects, education. Never invent or inflate numbers, credentials, or company names.
- When the resume gives a number (a percentage, dollar figure, time saved, team size, user count), use it. Prefer one concrete metric over any adjective.
- Tie each body claim to a specific requirement in the job posting. Describe the requirement in your own plain words (for example, "moving a legacy codebase to a typed architecture") instead of quoting the posting.
- If the resume lacks a requirement, do not claim it. Lead with the closest real strength instead.

BANNED PHRASES AND CLICHÉS (never use these or close paraphrases)
- "I am writing to express my interest", "I am writing to apply", "I am excited to apply", "I am thrilled", "I am passionate about"
- "With a track record of", "With X years of experience" as an opening
- "Please consider my application", "I look forward to hearing from you", "I would welcome the opportunity to discuss", "I believe I would be a great asset"
- "team player", "results-driven", "detail-oriented", "think outside the box", "synergy", "go-getter", "dynamic", "fast-paced environment", "hit the ground running", "perfect fit"
- Sentences that start with "Additionally,", "Furthermore,", or "Moreover,"
- Square-bracket placeholders, markdown, bullet points, emojis, and exclamation marks

STRUCTURE
- opening: 2 to 3 sentences. Start with the hook itself: a concrete accomplishment or a sharp observation about the company's mission or the problem it solves. Name the role and why this problem matters to you. Do not start with a sentence about yourself.
- body: one or two paragraphs separated by a blank line. Each paragraph ties one or two quantified achievements from the resume to specific requirements in the posting, explains the result, and shows how it transfers to this role.
- closing: 2 to 3 sentences, confident and forward-looking. Describe the specific value you would add in the first months, or the problem you would tackle first. Do NOT ask for an interview, a call, or a meeting, and do not say you look forward to hearing back.
- greeting: "Dear <Name>," if the posting or resume names a hiring manager; otherwise "Dear <Company> Hiring Team," or "Dear Hiring Team," if no company is named.
- signoff: exactly two lines: "Sincerely," on the first line and the applicant's full name on the second.
- company: the hiring company's name as written in the posting, or an empty string if it is not stated.
- Length: 220 to 320 words across opening, body, and closing combined.

OUTPUT
Return ONLY a JSON object with these string keys: "company", "greeting", "opening", "body", "closing", "signoff". No markdown, no commentary. Separate body paragraphs with a blank line (\\n\\n). Put the signoff's two lines on separate lines (\\n).`;

const TONE_GUIDANCE: Record<Tone, string> = {
  Professional:
    "Polished, measured, and credible. Formal enough for any industry without sounding stiff.",
  "Confident & Bold":
    "Assertive and energetic. Lead with impact, use strong active verbs, and state the value the applicant brings without hedging, while staying factual.",
  "Modern Startup":
    "Conversational, direct, and mission-driven. Show enthusiasm for the product and a bias for action; a light touch of personality is welcome.",
  "Warm & Personable":
    "Friendly and human. Highlight collaboration, motivation, and genuine connection to the company's mission.",
  "Concise & Direct":
    "Tight and efficient: about 200–250 words, short sentences, no filler.",
};

// Busy or rate-limited responses use these HTTP codes.
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const MAX_ATTEMPTS = 2;

function errorResponse(status: number, error: string, details?: string) {
  const payload: GenerateErrorResponse = details ? { error, details } : { error };
  return NextResponse.json(payload, { status });
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isTone(value: string): value is Tone {
  return (TONES as readonly string[]).includes(value);
}

function todayLongFormat(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Reads the model's JSON reply and checks every field the model must provide. */
function parseModelFields(raw: string): Omit<CoverLetter, "date" | "fullText"> {
  // Models sometimes wrap JSON in prose or code fences, so take the outermost object.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Model output did not contain a JSON object.");
  }
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model output was not a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const fields = {} as Record<(typeof MODEL_FIELDS)[number], string>;
  for (const field of MODEL_FIELDS) {
    const value = record[field];
    if (typeof value !== "string") {
      // The company name is optional; every other field is required.
      if (field === "company") {
        fields[field] = "";
        continue;
      }
      throw new Error(`Model output is missing the "${field}" field.`);
    }
    fields[field] = value.trim();
  }
  return fields;
}

/** Builds the full letter. The date always comes from the server clock. */
function buildLetter(
  fields: Omit<CoverLetter, "date" | "fullText">,
  date: string,
  applicantName: string,
): CoverLetter {
  let signoff = fields.signoff;
  // Make sure the signoff carries the applicant's name when we know it.
  if (applicantName && !signoff.includes(applicantName)) {
    signoff = `Sincerely,\n${applicantName}`;
  }
  const letter: CoverLetter = { ...fields, signoff, date, fullText: "" };
  letter.fullText = [
    date,
    fields.company,
    fields.greeting,
    fields.opening,
    fields.body,
    fields.closing,
    signoff,
  ]
    .filter(Boolean)
    .join("\n\n");
  return letter;
}

async function completeWithRetry(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.chat.completions.create({ model, messages });
    } catch (error) {
      const retryable = error instanceof OpenAI.APIError && RETRYABLE_STATUS.has(error.status ?? 0);
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
}

async function completeWithFallback(
  client: OpenAI,
  models: string[],
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
) {
  let lastError: unknown;
  for (const model of models) {
    try {
      return await completeWithRetry(client, model, messages);
    } catch (error) {
      lastError = error;
      // 404 = unknown model; 400 "decommissioned" = model retired by the provider.
      const decommissioned =
        error instanceof OpenAI.APIError &&
        error.status === 400 &&
        /decommissioned|no longer supported/i.test(error.message);
      const skippable =
        error instanceof OpenAI.APIError &&
        (RETRYABLE_STATUS.has(error.status ?? 0) || error.status === 404 || decommissioned);
      if (!skippable) throw error;
      console.warn(`[api/generate] ${model} unavailable (${error.status}); trying next model`);
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  // ---- Validate input ------------------------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null) {
    return errorResponse(400, "Request body must be a JSON object.");
  }
  const input = body as Record<string, unknown>;
  const resumeText = asTrimmedString(input.resumeText);
  const jobText = asTrimmedString(input.jobText);
  const applicantName = asTrimmedString(input.applicantName).slice(0, MAX_NAME_CHARS);
  const toneInput = asTrimmedString(input.tone);
  const tone: Tone = isTone(toneInput) ? toneInput : "Professional";

  if (!resumeText) return errorResponse(400, "resumeText is required.");
  if (!jobText) return errorResponse(400, "jobText is required.");
  if (resumeText.length > MAX_RESUME_CHARS) {
    return errorResponse(400, `resumeText must be at most ${MAX_RESUME_CHARS} characters.`);
  }
  if (jobText.length > MAX_JOB_CHARS) {
    return errorResponse(400, `jobText must be at most ${MAX_JOB_CHARS} characters.`);
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return errorResponse(
      500,
      "Server is missing GROQ_API_KEY.",
      "Add GROQ_API_KEY to .env.local (see .env.example) and restart the server.",
    );
  }

  // ---- Call the model --------------------------------------------------------
  const primaryModel = process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
  const modelChain = [primaryModel, ...FALLBACK_MODELS.filter((m) => m !== primaryModel)];
  const date = todayLongFormat();

  const userPrompt = [
    `Today's date: ${date}`,
    `Applicant's full name: ${applicantName || "(not provided; use the name from the resume)"}`,
    `Tone: ${tone}. ${TONE_GUIDANCE[tone]}`,
    "",
    "<resume>",
    resumeText,
    "</resume>",
    "",
    "<job_description>",
    jobText,
    "</job_description>",
    "",
    "Write the tailored cover letter now, following every rule in the system prompt.",
  ].join("\n");

  try {
    // maxRetries is 0 because completeWithRetry handles retries with bounded timing.
    const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 0, timeout: 55_000 });
    const completion = await completeWithFallback(client, modelChain, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);

    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") {
      return errorResponse(
        500,
        "The response was cut off before the letter was complete.",
        "Try shortening the resume or job description and generate again.",
      );
    }
    if (choice?.finish_reason === "content_filter") {
      return errorResponse(
        500,
        "The model declined to write this cover letter.",
        "Try rephrasing or trimming the input.",
      );
    }

    const text = choice?.message?.content?.trim();
    if (!text) {
      return errorResponse(500, "The model returned an empty response.");
    }

    let fields: Omit<CoverLetter, "date" | "fullText">;
    try {
      fields = parseModelFields(text);
    } catch (parseError) {
      return errorResponse(
        500,
        "Could not parse the generated cover letter.",
        parseError instanceof Error ? parseError.message : String(parseError),
      );
    }

    return NextResponse.json(buildLetter(fields, date, applicantName));
  } catch (error) {
    console.error("[api/generate] Groq request failed:", error);

    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      if (status === 401 || status === 403) {
        return errorResponse(
          500,
          "Groq rejected the API key.",
          "Check GROQ_API_KEY in .env.local and restart the server.",
        );
      }
      if (status === 404) {
        return errorResponse(500, "No available model was found for this key.", error.message);
      }
      if (status === 429) {
        return errorResponse(500, "Rate limited by the Groq API.", "Wait a minute and try again.");
      }
      return errorResponse(500, `Groq API error${status ? ` (${status})` : ""}.`, error.message);
    }

    return errorResponse(
      500,
      "Unexpected error while generating the cover letter.",
      error instanceof Error ? error.message : String(error),
    );
  }
}
