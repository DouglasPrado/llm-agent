export interface ChunkingOptions {
  chunkSize: number;
  chunkOverlap: number;
}

/**
 * Splits text into overlapping chunks using recursive character splitting.
 */
export function chunkText(text: string, options: ChunkingOptions): string[] {
  const { chunkSize, chunkOverlap } = options;
  if (!text || chunkSize <= 0) return [];
  if (text.length <= chunkSize) return [text];

  const separators = ['\n\n', '\n', '. ', ' ', ''];
  return recursiveSplit(text, separators, chunkSize, chunkOverlap);
}

function recursiveSplit(text: string, separators: string[], chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const separator = separators.find(s => s === '' || text.includes(s)) ?? '';

  const parts = separator ? text.split(separator) : [...text];
  let current = '';

  for (const part of parts) {
    const candidate = current ? current + separator + part : part;

    if (candidate.length > chunkSize && current) {
      chunks.push(current.trim());
      // Overlap: keep tail of current chunk
      const overlapText = current.slice(-overlap);
      current = overlapText ? overlapText + separator + part : part;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  // If any chunk is still too large, split with next separator
  if (separators.length > 1) {
    const nextSeparators = separators.slice(1);
    const refined: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length > chunkSize) {
        refined.push(...recursiveSplit(chunk, nextSeparators, chunkSize, overlap));
      } else {
        refined.push(chunk);
      }
    }
    return refined;
  }

  return chunks;
}
