import { atom } from 'jotai'

/**
 * Sentence-level alignment between the source text (left column) and the
 * translated result (right column), in the style of DeepL's aligned view.
 *
 * Both panes split their text into sentences with the same rule
 * (`splitIntoSentences`). Clicking a sentence records its index here so the
 * opposite pane highlights the sentence with the same index. Clicking inside
 * the currently highlighted sentence clears the alignment (so the editable
 * source pane stays usable for text entry).
 */
export const alignedSentenceIndexAtom = atom<number | null>(null)

const SENTENCE_BOUNDARY_PATTERN = /([.!?。!?…;；]+["')\]」』”’]?)\s*/g

/**
 * Splits text into sentence-ish chunks. A trailing newline also terminates a
 * chunk (paragraph-style alignment), and an unpunctuated tail is kept as its
 * own chunk. Empty chunks are dropped so indices line up with visible text.
 */
export function splitIntoSentences(text: string): string[] {
  const source = String(text ?? '')
  if (source.trim() === '') {
    return []
  }

  const chunks: string[] = []
  let lastIndex = 0

  SENTENCE_BOUNDARY_PATTERN.lastIndex = 0
  for (const match of source.matchAll(SENTENCE_BOUNDARY_PATTERN)) {
    const boundaryEnd = (match.index ?? 0) + match[0].length
    const chunk = source.slice(lastIndex, boundaryEnd)
    if (chunk.trim() !== '') {
      chunks.push(chunk.trim())
    }
    lastIndex = boundaryEnd
  }

  const tail = source.slice(lastIndex)
  if (tail.trim() !== '') {
    chunks.push(tail.trim())
  }

  return chunks
}

/**
 * Computes the start offset of each sentence chunk so the rendering side can
 * select a range without re-parsing the text.
 */
export function sentenceOffsets(text: string, sentences: string[]): number[] {
  const offsets: number[] = []
  let cursor = 0
  for (const sentence of sentences) {
    const found = text.indexOf(sentence, cursor)
    if (found === -1) {
      offsets.push(cursor)
      cursor += sentence.length
    } else {
      offsets.push(found)
      cursor = found + sentence.length
    }
  }
  return offsets
}

/**
 * Resolves which sentence a click offset lands in. Returns null when the
 * click is before the first sentence (only leading whitespace) — such a click
 * should not move the alignment.
 */
export function sentenceIndexAtClick(
  text: string,
  sentences: string[],
  clickOffset: number,
): number | null {
  const offsets = sentenceOffsets(text, sentences)
  for (let index = 0; index < sentences.length; index += 1) {
    const start = offsets[index]
    const end = start + sentences[index].length
    if (clickOffset >= start && clickOffset <= end) {
      return index
    }
    if (clickOffset < start) {
      return null
    }
  }
  return null
}

export interface SentenceSegment {
  /** Sentence text (trimmed). */
  sentence: string
  /** Whitespace/punctuation run following the sentence, verbatim. */
  gap: string
  /** Start offset of the sentence in the original text. */
  offset: number
}

/**
 * Splits text into sentence segments while keeping the exact gap text
 * between sentences. The gap is re-rendered verbatim so CJK sentence
 * boundaries gain no stray spaces and Latin text keeps its own.
 */
export function splitIntoSentenceSegments(text: string): SentenceSegment[] {
  const source = String(text ?? '')
  const sentences = splitIntoSentences(source)
  if (sentences.length === 0) {
    return []
  }

  const offsets = sentenceOffsets(source, sentences)
  const segments: SentenceSegment[] = []
  for (let index = 0; index < sentences.length; index += 1) {
    const start = offsets[index]
    const end = start + sentences[index].length
    const nextStart =
      index + 1 < sentences.length ? Math.max(offsets[index + 1], end) : source.length
    segments.push({
      sentence: sentences[index],
      gap: source.slice(end, nextStart),
      offset: start,
    })
  }
  return segments
}
