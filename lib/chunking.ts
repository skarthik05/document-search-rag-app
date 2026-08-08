export function chunkText(text: string, page?: number) {
  const cleaned = text.replace(/\s+/g, " ").trim(),
    size = 900,
    overlap = 180;
  const chunks: { text: string; page?: number }[] = [];
  for (let start = 0; start < cleaned.length; start += size - overlap) {
    let end = Math.min(cleaned.length, start + size);
    if (end < cleaned.length) {
      const boundary = cleaned.lastIndexOf(". ", end);
      if (boundary > start + 400) end = boundary + 1;
    }
    chunks.push({ text: cleaned.slice(start, end), page });
    if (end === cleaned.length) break;
  }
  return chunks;
}
