export type Anchor = { messageId: string; paragraphIndex: number }
export type SelectionLike = { text: string; requestId?: string }

const FENCE = /^\s*(```|~~~)/

/** Splits markdown into paragraphs on blank lines; a fenced code block is one paragraph. */
export function splitParagraphs(markdown: string): string[] {
  const paragraphs: string[] = []
  let current: string[] = []
  let isInFence = false
  const flush = () => {
    if (current.length > 0) paragraphs.push(current.join('\n'))
    current = []
  }
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      if (!isInFence) flush()
      current.push(line)
      if (isInFence) flush()
      isInFence = !isInFence
    } else if (isInFence) {
      current.push(line)
    } else if (line.trim() === '') {
      flush()
    } else {
      current.push(line)
    }
  }
  flush()
  return paragraphs
}

/** Strips markdown syntax and collapses whitespace so rendered and source text compare equal. */
export function normalize(markdown: string): string {
  return markdown
    .split('\n')
    .filter(line => !FENCE.test(line))
    .map(line =>
      line
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, ''),
    )
    .join(' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/\*/g, '')
    .replace(/(^|\s)_+(?=\S)/g, '$1')
    .replace(/(?<=\S)_+(?=\s|$|[.,;:!?)])/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Finds the paragraph holding the end of the selection. The selection's own row is searched
 * first, then the other blocks newest first (`blocks` iterates in render order).
 */
export function locateAnchor(selection: SelectionLike, blocks: ReadonlyMap<string, string>): Anchor | undefined {
  const needle = normalize(selection.text)
  if (needle === '') return undefined
  const newestFirst = [...blocks.keys()].reverse()
  const order =
    selection.requestId !== undefined && blocks.has(selection.requestId)
      ? [selection.requestId, ...newestFirst.filter(id => id !== selection.requestId)]
      : newestFirst
  for (const messageId of order) {
    const paragraphs = splitParagraphs(blocks.get(messageId) ?? '').map(normalize)
    const start = paragraphs.join(' ').indexOf(needle)
    if (start === -1) continue
    const end = start + needle.length - 1
    let offset = 0
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
      const length = paragraphs[paragraphIndex]!.length
      if (end < offset + length) return { messageId, paragraphIndex }
      offset += length + 1
    }
  }
  return undefined
}
