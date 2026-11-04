/**
 * Client-side export helpers. Heavy libraries (docx, file-saver) are imported
 * lazily so they only load when the user actually downloads a Word file.
 */

export interface LetterHeader {
  name: string;
  contact: string;
  date: string;
  company: string;
}

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
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => paragraph.split("\n").map((line) => line.trimEnd()));
}

/** Plain-text version of the full letter, header included, for .txt and clipboard. */
export function buildPlainText(header: LetterHeader, bodyText: string): string {
  const lines: string[] = [];
  if (header.name) lines.push(header.name.toUpperCase());
  if (header.contact) lines.push(header.contact);
  if (lines.length > 0) lines.push("");
  if (header.date) lines.push(header.date, "");
  if (header.company) lines.push(header.company, "");
  lines.push(bodyText.trim());
  return lines.join("\n");
}

const LETTER_FONT = "Georgia";
const HEADER_FONT = "Calibri";
const RULE_COLOR = "B8BEC8";

export async function downloadDocx(
  header: LetterHeader,
  bodyText: string,
  fileBaseName: string,
): Promise<void> {
  const [{ Document, Packer, Paragraph, TextRun, BorderStyle }, { saveAs }] = await Promise.all([
    import("docx"),
    import("file-saver"),
  ]);

  const children: InstanceType<typeof Paragraph>[] = [];

  // Letterhead: bold uppercase name, contact subtitle, then a horizontal rule.
  if (header.name) {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: header.name.toUpperCase(),
            bold: true,
            size: 32, // 16pt (half-points)
            font: HEADER_FONT,
            characterSpacing: 40,
          }),
        ],
      }),
    );
  }
  children.push(
    new Paragraph({
      spacing: { after: 360 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_COLOR, space: 10 },
      },
      children: header.contact
        ? [new TextRun({ text: header.contact, size: 19, color: "5B6474", font: HEADER_FONT })]
        : [],
    }),
  );

  // Date and company block.
  if (header.date) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: header.date, font: LETTER_FONT, size: 22 })],
      }),
    );
  }
  if (header.company) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: header.company, font: LETTER_FONT, size: 22 })],
      }),
    );
  }

  // Letter body: greeting, paragraphs, and signoff, one Word paragraph per block.
  for (const lines of toParagraphs(bodyText)) {
    children.push(
      new Paragraph({
        spacing: { after: 200, line: 300 },
        children: lines.map(
          (line, index) =>
            new TextRun({
              text: line,
              break: index > 0 ? 1 : 0,
              font: LETTER_FONT,
              size: 22,
            }),
        ),
      }),
    );
  }

  const doc = new Document({
    creator: "CoverCraft",
    title: "Cover Letter",
    styles: {
      default: {
        document: { run: { font: LETTER_FONT, size: 22 } }, // 11pt (half-points)
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // US Letter (twips)
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch
          },
        },
        children,
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
 * Opens the browser print dialog. The @media print rules in globals.css show
 * only the letter, laid out on one US Letter page, so "Save as PDF" is clean.
 * The document title is swapped so the suggested file name matches the applicant.
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
