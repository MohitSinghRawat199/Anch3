import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(projectRoot, "docs", "PROJECT-DOCUMENTATION.md");
const outputPath = path.join(projectRoot, "docs", "Slidecraft-Project-Documentation.pdf");
const markdown = fs.readFileSync(sourcePath, "utf8");
const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
const pageWidth = 595.28;
const pageHeight = 841.89;
const left = 54;
const right = 54;
const top = 62;
const bottom = 55;
const contentWidth = pageWidth - left - right;
let pageNumber = 1;
let y = top;
let inCodeBlock = false;

const palette = {
  ink: [39, 53, 43],
  green: [71, 120, 93],
  muted: [111, 119, 109],
  light: [229, 235, 225],
  code: [245, 247, 242],
  white: [255, 255, 255],
};

function setColor(method, color) {
  pdf[method](...color);
}

function drawPageFrame() {
  setColor("setFillColor", palette.white);
  pdf.rect(0, 0, pageWidth, pageHeight, "F");
  setColor("setDrawColor", palette.light);
  pdf.setLineWidth(0.6);
  pdf.line(left, pageHeight - 37, pageWidth - right, pageHeight - 37);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  setColor("setTextColor", palette.muted);
  pdf.text("SLIDECRAFT  /  PROJECT DOCUMENTATION", left, pageHeight - 23);
  pdf.text(String(pageNumber), pageWidth - right, pageHeight - 23, { align: "right" });
}

function newPage() {
  pdf.addPage();
  pageNumber += 1;
  drawPageFrame();
  y = top;
}

function ensureSpace(height) {
  if (y + height > pageHeight - bottom) newPage();
}

function renderCover() {
  setColor("setFillColor", palette.ink);
  pdf.rect(0, 0, pageWidth, 385, "F");
  setColor("setDrawColor", [91, 139, 102]);
  pdf.setLineWidth(1);
  pdf.circle(pageWidth - 84, 115, 62, "S");
  pdf.circle(pageWidth - 84, 115, 43, "S");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  setColor("setTextColor", [176, 208, 171]);
  pdf.text("PRODUCT & TECHNICAL GUIDE", left, 78);
  pdf.setFontSize(42);
  setColor("setTextColor", palette.white);
  pdf.text("Slidecraft", left, 172);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(17);
  setColor("setTextColor", [224, 233, 222]);
  pdf.text(["Project documentation", "Setup, architecture, features, security, and API reference"], left, 211, {
    lineHeightFactor: 1.5,
  });
  pdf.setFontSize(10);
  setColor("setTextColor", [184, 201, 184]);
  pdf.text("React  ·  Express  ·  MongoDB  ·  Gemini (optional)", left, 328);
  y = 430;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  setColor("setTextColor", palette.ink);
  pdf.text("About this guide", left, y);
  y += 25;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  setColor("setTextColor", palette.muted);
  const intro = "A practical guide to installing, configuring, running, and extending the current Slidecraft application. It documents implemented behavior and calls out features that are not yet available.";
  const lines = pdf.splitTextToSize(intro, contentWidth);
  pdf.text(lines, left, y, { lineHeightFactor: 1.55 });
  y += lines.length * 17 + 36;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  setColor("setTextColor", palette.ink);
  pdf.text("Inside", left, y);
  y += 20;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  setColor("setTextColor", palette.muted);
  const contents = [
    "Product overview · Technology and architecture · Features and limitations",
    "Installation · Environment configuration · Local and production operation",
    "User workflow · Authentication and security · API reference",
    "PDF export · Project structure · Troubleshooting",
  ];
  for (const item of contents) {
    pdf.text(`•  ${item}`, left + 5, y);
    y += 19;
  }
}

function renderText(text, options = {}) {
  const { font = "normal", size = 10.5, color = palette.ink, indent = 0, lineHeight = 1.42, gap = 8 } = options;
  pdf.setFont("helvetica", font);
  pdf.setFontSize(size);
  setColor("setTextColor", color);
  const lines = pdf.splitTextToSize(text, contentWidth - indent);
  const lineStep = size * lineHeight;
  ensureSpace(lines.length * lineStep + gap);
  pdf.text(lines, left + indent, y, { lineHeightFactor: lineHeight });
  y += lines.length * lineStep + gap;
}

function renderHeading(text, level) {
  const settings = level === 1
    ? { size: 22, color: palette.ink, before: 14, after: 12 }
    : level === 2
      ? { size: 15.5, color: palette.green, before: 12, after: 7 }
      : { size: 11.5, color: palette.ink, before: 8, after: 5 };
  y += settings.before;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(settings.size);
  setColor("setTextColor", settings.color);
  const lines = pdf.splitTextToSize(text, contentWidth);
  ensureSpace(lines.length * settings.size * 1.25 + settings.after + 4);
  pdf.text(lines, left, y, { lineHeightFactor: 1.2 });
  y += lines.length * settings.size * 1.2 + settings.after;
}

function renderListItem(text, ordered = false, marker = "•") {
  const clean = text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  const prefix = ordered ? `${marker}.` : "-";
  renderText(`${prefix}  ${clean}`, { size: 10, indent: 10, gap: 4, lineHeight: 1.38 });
}

function renderCodeLine(text) {
  const clean = text || " ";
  pdf.setFont("courier", "normal");
  pdf.setFontSize(8.4);
  const lines = pdf.splitTextToSize(clean, contentWidth - 24);
  const lineHeight = 12;
  const boxHeight = lines.length * lineHeight + 7;
  ensureSpace(boxHeight);
  setColor("setFillColor", palette.code);
  pdf.roundedRect(left, y - 9, contentWidth, boxHeight, 3, 3, "F");
  setColor("setTextColor", palette.ink);
  pdf.text(lines, left + 12, y, { lineHeightFactor: 1.3 });
  y += boxHeight;
}

function renderTableRow(line, isHeader) {
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim().replace(/\*\*/g, "").replace(/`/g, ""));
  if (!cells.length || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return;
  const columnWidth = contentWidth / cells.length;
  const cellLines = cells.map((cell) => pdf.splitTextToSize(cell, columnWidth - 12));
  const rowHeight = Math.max(24, ...cellLines.map((lines) => lines.length * 11 + 10));
  ensureSpace(rowHeight);
  if (isHeader) {
    setColor("setFillColor", palette.code);
    pdf.rect(left, y - 12, contentWidth, rowHeight, "F");
  }
  setColor("setDrawColor", palette.light);
  pdf.setLineWidth(0.5);
  pdf.line(left, y - 12 + rowHeight, left + contentWidth, y - 12 + rowHeight);
  cells.forEach((cell, index) => {
    pdf.setFont("helvetica", isHeader ? "bold" : "normal");
    pdf.setFontSize(8.2);
    setColor("setTextColor", isHeader ? palette.ink : palette.muted);
    pdf.text(cellLines[index], left + index * columnWidth + 6, y, { lineHeightFactor: 1.2 });
  });
  y += rowHeight;
}

function renderMarkdown() {
  const lines = markdown.split(/\r?\n/);
  let tableHeaderPending = true;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      y += inCodeBlock ? 4 : 9;
      continue;
    }
    if (inCodeBlock) {
      renderCodeLine(line);
      continue;
    }
    if (!line.trim() || line.trim() === "---") {
      y += line.trim() === "---" ? 8 : 3;
      continue;
    }
    if (line.startsWith("# ")) {
      renderHeading(line.slice(2), 1);
      continue;
    }
    if (line.startsWith("## ")) {
      renderHeading(line.slice(3), 2);
      continue;
    }
    if (line.startsWith("### ")) {
      renderHeading(line.slice(4), 3);
      continue;
    }
    if (/^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(line)) {
      continue;
    }
    if (line.startsWith("|")) {
      renderTableRow(line, tableHeaderPending);
      tableHeaderPending = false;
      continue;
    }
    tableHeaderPending = true;
    const ordered = line.match(/^(\d+)\.\s+(.*)$/);
    if (ordered) {
      renderListItem(ordered[2], true, ordered[1]);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      renderListItem(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    const paragraph = line
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)");
    renderText(paragraph, { size: 10.2, color: palette.ink, gap: 8, lineHeight: 1.42 });
  }
}

renderCover();
newPage();
renderMarkdown();
const pageCount = pdf.getNumberOfPages();
for (let page = 1; page <= pageCount; page += 1) {
  pdf.setPage(page);
  if (page === 1) continue;
  setColor("setTextColor", palette.muted);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(String(page - 1), pageWidth - right, pageHeight - 23, { align: "right" });
}
fs.writeFileSync(outputPath, Buffer.from(pdf.output("arraybuffer")));
console.log(`Created ${path.relative(projectRoot, outputPath)} (${pageCount} pages).`);
