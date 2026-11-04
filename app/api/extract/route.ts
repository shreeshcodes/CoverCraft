import { NextResponse } from "next/server";
import { auth } from "@/auth";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { MAX_RESUME_CHARS, type GenerateErrorResponse } from "@/lib/types";

// PDF and DOCX parsing run on the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type FileKind = "pdf" | "docx" | "txt";

function errorResponse(status: number, error: string, details?: string) {
  const payload: GenerateErrorResponse = details ? { error, details } : { error };
  return NextResponse.json(payload, { status });
}

function detectKind(file: File): FileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".docx") || file.type === DOCX_MIME) return "docx";
  if (name.endsWith(".txt") || file.type === "text/plain") return "txt";
  return null;
}

/** Tidy whitespace from extracted text without losing paragraph breaks. */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse(401, "Sign in to upload a resume.", "Use Google or LinkedIn on the home page.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "Upload the resume as multipart form data in a 'file' field.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorResponse(400, "No file was uploaded.");
  }
  if (file.size === 0) {
    return errorResponse(400, "The file is empty.");
  }
  if (file.size > MAX_FILE_BYTES) {
    return errorResponse(413, "The file is larger than 5 MB.", "Export a smaller PDF, or paste the text instead.");
  }

  const kind = detectKind(file);
  if (!kind) {
    return errorResponse(415, "Unsupported file type.", "Upload a PDF, DOCX, or TXT file, or paste the text instead.");
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text: string;

    if (kind === "pdf") {
      const result = await extractText(bytes, { mergePages: true });
      text = result.text;
    } else if (kind === "docx") {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = result.value;
    } else {
      text = new TextDecoder("utf-8").decode(bytes);
    }

    text = normalizeText(text);
    if (!text) {
      return errorResponse(
        422,
        "No readable text was found in this file.",
        kind === "pdf"
          ? "The PDF may be a scanned image. Paste the text instead, or export the resume as a text-based PDF."
          : "Paste the text instead.",
      );
    }
    if (text.length > MAX_RESUME_CHARS) {
      return errorResponse(
        422,
        `The resume is longer than ${MAX_RESUME_CHARS.toLocaleString()} characters.`,
        "Trim it to the sections you want considered, then try again.",
      );
    }

    return NextResponse.json({ text, fileName: file.name, characters: text.length });
  } catch (error) {
    console.error("[api/extract] Could not read file:", error);
    return errorResponse(
      422,
      "Could not read this file.",
      "Try another file, or paste the text instead.",
    );
  }
}
