export const TONES = [
  "Professional",
  "Confident & Bold",
  "Modern Startup",
  "Warm & Personable",
  "Concise & Direct",
] as const;

export type Tone = (typeof TONES)[number];

export interface GenerateRequest {
  resumeText: string;
  jobText: string;
  applicantName?: string;
  tone?: string;
}

export interface CoverLetter {
  company: string;
  date: string;
  greeting: string;
  opening: string;
  body: string;
  closing: string;
  signoff: string;
  fullText: string;
}

export interface GenerateErrorResponse {
  error: string;
  details?: string;
}

/** Fields the model writes. `date` and `fullText` are added by the server. */
export const MODEL_FIELDS = [
  "company",
  "greeting",
  "opening",
  "body",
  "closing",
  "signoff",
] as const satisfies readonly (keyof CoverLetter)[];

/** Server-side input limits (characters). Generous enough for long resumes/postings. */
export const MAX_RESUME_CHARS = 30_000;
export const MAX_JOB_CHARS = 20_000;
export const MAX_NAME_CHARS = 120;
