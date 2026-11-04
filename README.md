# CoverCraft

**AI cover letters, tailored to the role and grounded in your resume.**

CoverCraft is a single-page Next.js app that turns your resume and a job posting into a tailored cover letter using Google Gemini. You can edit the letter in place, then export it as **Word (.docx)**, **PDF**, or **plain text**, or copy it to the clipboard.

![Stack](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8)

## Features

- **Grounded generation:** Gemini acts as a career strategist and writes only from facts in your resume, matched against the job's requirements.
- **Tone control:** Professional, Confident & Bold, Modern Startup, Warm & Personable, or Concise & Direct.
- **Live editable preview:** the letter renders on a document-style page that you can edit directly.
- **Exports:**
  - `.docx`: a clean Word document built in the browser with [`docx`](https://docx.js.org) and saved with `file-saver`.
  - `.pdf`: uses the browser's print dialog ("Save as PDF"). `@media print` rules strip every control, so only the letter prints.
  - `.txt`: a plain-text file created with a native `Blob`.
  - **Copy to clipboard**, with visual confirmation.

## Quick start

```bash
npm install
cp .env.example .env.local   # then paste your key into .env.local
npm run dev
```

Open http://localhost:3000.

### Environment variables

| Variable            | Required | Description                                                                 |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `GEMINI_API_KEY`    | Yes      | A free key from https://aistudio.google.com/apikey. Server-side only.         |
| `GEMINI_MODEL`      | No       | Gemini model ID. Defaults to `gemini-2.5-flash`.                             |

The API key is read only in the server route. It never reaches the browser.

## API

`POST /api/generate`

Request body:

```json
{
  "resumeText": "string (required, ≤ 30,000 chars)",
  "jobText": "string (required, ≤ 20,000 chars)",
  "applicantName": "string (optional)",
  "tone": "Professional | Confident & Bold | Modern Startup | Warm & Personable | Concise & Direct (optional)"
}
```

Success (`200`):

```json
{
  "recipient": "string",
  "greeting": "string",
  "opening": "string",
  "body": "string",
  "closing": "string",
  "signoff": "string",
  "fullText": "string"
}
```

Errors return `{ "error": string, "details"?: string }`. The status is `400` for invalid input and `500` when the Gemini call fails (bad or missing key, rate limit, refusal, unknown model, and so on).

The response shape is enforced with Gemini's **structured output** (`responseMimeType: "application/json"` plus a JSON schema), so the route always gets parseable JSON.

## Project structure

```
app/
  api/generate/route.ts   # Server route: validates input, calls Gemini, returns JSON
  globals.css             # Tailwind + @media print rules for PDF export
  layout.tsx
  page.tsx                # Two-column UI: inputs, editable preview, export toolbar
lib/
  export.ts               # .docx / .txt / print / clipboard helpers
  types.ts                # Shared request/response types and limits
```

## Scripts

- `npm run dev`: start the dev server
- `npm run build`: production build (includes type checking)
- `npm start`: serve the production build
- `npm run lint`: type-check with `tsc --noEmit`

## Deploying

The app runs as-is on Vercel or any Node.js host. Set `GEMINI_API_KEY` in the host's environment settings. The generate route sets `maxDuration = 60` so that longer generations aren't cut off on serverless platforms.
