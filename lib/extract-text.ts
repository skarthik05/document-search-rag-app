"use client";
import { chunkText } from "./chunking";
export async function extractChunks(file: File) {
  if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt"))
    return chunkText(await file.text());
  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  )
    throw new Error("Please upload a .txt or text-based .pdf file.");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise;
  const chunks: { text: string; page?: number }[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    chunks.push(
      ...chunkText(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
        pageNumber,
      ),
    );
  }

  if (!chunks.length)
    throw new Error(
      "No selectable text was found. Scanned PDFs are not supported yet.",
    );
  return chunks;
}
