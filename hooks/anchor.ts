export type Anchor = { messageId: string; paragraphIndex: number }
export type SelectionLike = { text: string; requestId?: string }

const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/
const FENCE_LINE = /^\s*(`{3,}|~{3,})[^`]*$/

/** Splits markdown into paragraphs on blank lines; a fenced code block is one paragraph. */
export function splitParagraphs(markdown: string): string[] {
  const paragraphs: string[] = []
  let current: string[] = []
  let fence: { char: string; length: number } | undefined
  const flush = () => {
    if (current.length > 0) paragraphs.push(current.join('\n'))
    current = []
  }
  for (const line of markdown.split('\n')) {
    if (fence) {
      current.push(line)
      const close = FENCE_CLOSE.exec(line)
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) {
        flush()
        fence = undefined
      }
      continue
    }
    const open = FENCE_OPEN.exec(line)
    if (open && !(open[1]![0] === '`' && open[2]!.includes('`'))) {
      flush()
      current.push(line)
      fence = { char: open[1]![0]!, length: open[1]!.length }
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
    .filter(line => !FENCE_LINE.test(line))
    .map(line =>
      line
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, ''),
    )
    .join(' ')
    .replace(/!\[([^\]\n]{0,500})\]\([^)\n]{0,500}\)/g, '$1')
    .replace(/\[([^\]\n]{0,500})\]\([^)\n]{0,500}\)/g, '$1')
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
    const kept = splitParagraphs(blocks.get(messageId) ?? '')
      .map((paragraph, index) => ({ text: normalize(paragraph), index }))
      .filter(paragraph => paragraph.text !== '')
    const start = kept.map(paragraph => paragraph.text).join(' ').indexOf(needle)
    if (start === -1) continue
    const end = start + needle.length - 1
    let offset = 0
    for (const paragraph of kept) {
      if (end < offset + paragraph.text.length) return { messageId, paragraphIndex: paragraph.index }
      offset += paragraph.text.length + 1
    }
  }
  return undefined
}
