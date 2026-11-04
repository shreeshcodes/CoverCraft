/**
 * Client-side export helpers. Heavy libraries (docx, file-saver) are imported
 * lazily so they only load when the user actually downloads a Word file.
 */

export function buildFileBaseName(applicantName: string): string {
  const slug = applicantName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-cover-letter` : "cover-letter";
}

/** Split letter text into paragraphs on blank lines, keeping single line breaks. */
export function toParagraphs(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split("\n").map((line) => line.trimEnd()));
}

export async function downloadDocx(text: string, fileBaseName: string): Promise<void> {
  const [{ Document, Packer, Paragraph, TextRun }, { saveAs }] = await Promise.all([
    import("docx"),
    import("file-saver"),
  ]);

  const paragraphs = toParagraphs(text).map(
    (lines) =>
      new Paragraph({
        spacing: { after: 240, line: 300 },
        children: lines.map(
          (line, index) => new TextRun({ text: line, break: index > 0 ? 1 : 0 }),
        ),
      }),
  );

  const doc = new Document({
    creator: "AI Cover Letter Generator",
    title: "Cover Letter",
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 23 } }, // 11.5pt (half-points)
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch (twips)
          },
        },
        children: paragraphs,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${fileBaseName}.docx`);
}

export function downloadTxt(text: string, fileBaseName: string): void {
  const blob = new Blob([text.replace(/\r?\n/g, "\r\n")], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileBaseName}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Opens the browser print dialog; the @media print rules in globals.css render
 * only the letter, so "Save as PDF" produces a clean document. The document
 * title is swapped so the suggested PDF file name matches the applicant.
 */
export function printToPdf(fileBaseName: string): void {
  const previousTitle = document.title;
  document.title = fileBaseName;
  const restore = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts (e.g. LAN IP during development).
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) throw new Error("Copy command was rejected by the browser.");
}
