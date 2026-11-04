import { ApiError, FinishReason, GoogleGenAI } from "@google/genai";
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

// The Gemini SDK needs the Node.js runtime, and generation can take a while.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Gemini 2.5 Flash is on Google's free tier. Override with GEMINI_MODEL.
const DEFAULT_MODEL = "gemini-2.5-flash";

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
- fullText: the complete letter, ready to send: recipient, greeting, opening, body, closing, and signoff in that order, with a blank line between each part. Do not include a date or the applicant's contact details unless they appear in the resume.`;

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

const COVER_LETTER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: Object.fromEntries(
    COVER_LETTER_FIELDS.map((field) => [field, { type: "string" }]),
  ),
  required: [...COVER_LETTER_FIELDS],
  additionalProperties: false,
};

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

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return errorResponse(
      500,
      "Server is missing GEMINI_API_KEY.",
      "Add GEMINI_API_KEY to .env.local (see .env.example) and restart the server.",
    );
  }

  // ---- Call Gemini -----------------------------------------------------------
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

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
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: COVER_LETTER_SCHEMA,
        // Thinking tokens count toward this limit, so leave generous headroom.
        maxOutputTokens: 16384,
      },
    });

    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      return errorResponse(
        500,
        "Gemini declined to write this cover letter.",
        `Prompt was blocked (${blockReason}). Try rephrasing or trimming the input.`,
      );
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === FinishReason.MAX_TOKENS) {
      return errorResponse(
        500,
        "The response was cut off before the letter was complete.",
        "Try shortening the resume or job description and generate again.",
      );
    }
    if (
      finishReason === FinishReason.SAFETY ||
      finishReason === FinishReason.BLOCKLIST ||
      finishReason === FinishReason.PROHIBITED_CONTENT ||
      finishReason === FinishReason.SPII
    ) {
      return errorResponse(
        500,
        "Gemini declined to write this cover letter.",
        `Response was stopped (${finishReason}). Try rephrasing or trimming the input.`,
      );
    }

    const text = response.text?.trim();
    if (!text) {
      return errorResponse(500, "Gemini returned an empty response.");
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
    console.error("[api/generate] Gemini request failed:", error);

    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        return errorResponse(
          500,
          "Gemini rejected the API key.",
          "Check GEMINI_API_KEY and that the Gemini API is enabled for its project.",
        );
      }
      if (error.status === 404) {
        return errorResponse(
          500,
          `Model "${model}" was not found.`,
          "Check GEMINI_MODEL, or unset it to use the default.",
        );
      }
      if (error.status === 429) {
        return errorResponse(
          500,
          "Rate limited by the Gemini API.",
          "The free tier has per-minute and daily limits. Wait a moment and retry.",
        );
      }
      if (error.status === 400 && /api key/i.test(error.message)) {
        return errorResponse(500, "Gemini rejected the API key.", "Check GEMINI_API_KEY.");
      }
      return errorResponse(
        500,
        `Gemini API error (${error.status}).`,
        error.message,
      );
    }

    return errorResponse(
      500,
      "Unexpected error while generating the cover letter.",
      error instanceof Error ? error.message : String(error),
    );
  }
}
