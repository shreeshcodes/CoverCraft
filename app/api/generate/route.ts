import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  COVER_LETTER_FIELDS,
  MAX_JOB_CHARS,
  MAX_NAME_CHARS,
  MAX_RESUME_CHARS,
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
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
// Backup models, tried in order when the primary is busy (429/5xx) or unavailable (404).
const FALLBACK_MODELS = ["llama-3.1-8b-instant", "gemma2-9b-it"];

const SYSTEM_PROMPT = `You are a top-tier career strategist and executive cover-letter writer. You turn an applicant's resume and a target job posting into a compelling, tailored cover letter that gets interviews.

Ground rules:
- Use ONLY facts that appear in the resume: employers, titles, dates, metrics, skills, education, projects. Never invent or inflate experience, numbers, credentials, or company names. If the resume lacks something the job asks for, do not claim it. Lean on transferable strengths the resume actually shows.
- Match the strongest resume evidence to the job's most important requirements. Prefer specific, quantified accomplishments over generic adjectives.
- Name the company and role when the posting states them. If the hiring manager's name is not given, address the hiring team rather than guessing a name.
- Keep the letter to roughly 250–400 words: an opening hook, one or two body paragraphs of evidence, and a forward-looking close with a clear call to action.
- No clichés ("I am writing to express my interest", "team player", "think outside the box"), no placeholder brackets, and no markdown formatting.

Return each part of the letter in its own field:
- recipient: the addressee block (e.g. "Hiring Team\\nAcme Corp"), using newlines between lines.
- greeting: the salutation line, e.g. "Dear Acme Hiring Team,".
- opening: the first paragraph.
- body: the middle paragraph(s), separated by a blank line.
- closing: the final paragraph.
- signoff: the valediction and the applicant's name on separate lines, e.g. "Sincerely,\\nJane Doe".
- fullText: the complete letter, ready to send: recipient, greeting, opening, body, closing, and signoff in that order, with a blank line between each part. Do not include a date or the applicant's contact details unless they appear in the resume.

Respond with a single JSON object containing exactly these seven string fields and nothing else.`;

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

function parseCoverLetter(raw: string): CoverLetter {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model output was not a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const letter = {} as CoverLetter;
  for (const field of COVER_LETTER_FIELDS) {
    const value = record[field];
    if (typeof value !== "string") {
      throw new Error(`Model output is missing the "${field}" field.`);
    }
    letter[field] = value.trim();
  }
  if (!letter.fullText) {
    letter.fullText = [
      letter.recipient,
      letter.greeting,
      letter.opening,
      letter.body,
      letter.closing,
      letter.signoff,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return letter;
}

async function completeWithRetry(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
      });
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
      const skippable =
        error instanceof OpenAI.APIError &&
        (RETRYABLE_STATUS.has(error.status ?? 0) || error.status === 404);
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

  // ---- Call Groq -------------------------------------------------------------
  const primaryModel = process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
  const modelChain = [primaryModel, ...FALLBACK_MODELS.filter((m) => m !== primaryModel)];

  const userPrompt = [
    `Applicant name: ${applicantName || "(not provided; use the name from the resume, if present)"}`,
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
    "Write the tailored cover letter now.",
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

    let letter: CoverLetter;
    try {
      letter = parseCoverLetter(text);
    } catch (parseError) {
      return errorResponse(
        500,
        "Could not parse the generated cover letter.",
        parseError instanceof Error ? parseError.message : String(parseError),
      );
    }

    return NextResponse.json(letter);
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
        return errorResponse(
          500,
          "No available Groq model was found for this key.",
          error.message,
        );
      }
      if (status === 429) {
        return errorResponse(
          500,
          "Rate limited by the Groq API.",
          "Wait a minute and try again.",
        );
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
