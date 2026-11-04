# CoverCraft

**AI cover letters, tailored to the role and grounded in your resume.**

CoverCraft is a single-page Next.js app that turns your resume and a job posting into a tailored cover letter using Groq (Llama). You can edit the letter in place, then export it as **Word (.docx)**, **PDF**, or **plain text**, or copy it to the clipboard.

![Stack](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8)

## Features

- **Resume upload:** drop or choose a PDF, DOCX, or TXT file (up to 5 MB) and its text fills the resume box. Scanned PDFs without a text layer can't be read, so paste those instead.
- **Grounded generation:** The AI model acts as a career strategist and writes only from facts in your resume, matched against the job's requirements.
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
| `GROQ_API_KEY`      | Yes      | Your key from https://console.groq.com/keys. Server-side only.               |
| `GROQ_MODEL`        | No       | Model ID. Defaults to `openai/gpt-oss-120b`.                             |

The API key is read only in the server route. It never reaches the browser.

## Sign-in setup

The generator requires sign-in with Google or LinkedIn. Both are free to set up. Keys go in `.env.local`, never in the code.

1. **AUTH_SECRET:** in PowerShell, run this and paste the output after `AUTH_SECRET=`:

   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```

2. **Google:** create an OAuth client (type "Web application") at https://console.cloud.google.com/apis/credentials. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. While the consent screen is in "Testing", add your own Google account as a test user.
2. **LinkedIn:** create an app at https://www.linkedin.com/developers/apps. LinkedIn asks for a Company Page to attach it to. Add the product "Sign In with LinkedIn using OpenID Connect", then add `http://localhost:3000/api/auth/callback/linkedin` under the Auth tab. Copy the client ID and secret into `AUTH_LINKEDIN_ID` and `AUTH_LINKEDIN_SECRET`.

Sign-in only works on `localhost` until the app is deployed. Once deployed, add the public callback URLs to both providers and set `AUTH_URL`.

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
  "company": "string",
  "date": "string (server date, e.g. November 4, 2026)",
  "greeting": "string",
  "opening": "string",
  "body": "string",
  "closing": "string",
  "signoff": "string",
  "fullText": "string"
}
```

Errors return `{ "error": string, "details"?: string }`. The status is `400` for invalid input and `500` when the Groq call fails (bad or missing key, rate limit, refusal, unknown model, and so on).

The reply is parsed as JSON, and every field is checked before the letter is returned.

## Project structure

```
app/
  api/generate/route.ts   # Server route: validates input, calls Groq, returns JSON
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

The app runs as-is on Vercel or any Node.js host. Set `GROQ_API_KEY` in the host's environment settings. The generate route sets `maxDuration = 60` so that longer generations aren't cut off on serverless platforms.
