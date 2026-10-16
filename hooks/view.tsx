import { splitParagraphs } from './anchor'
import { echoOf } from './threads'
import type { Thread } from './threads'

// The element table `$.ui.resolve(e)` returns; only these three are used.
type Els = { Box: any; Text: any; Markdown: any }

/** A row that takes no room: the thread's own messages, drawn inline instead. */
export function hidden(els: Els) {
  const { Box } = els
  return <Box display="none" />
}

export function threadView(els: Els, thread: Thread, depth = 0) {
  const { Box, Text, Markdown } = els
  const answer = [...thread.replyBlocks.values()].filter(text => text !== '').join('\n\n')
  const toolCount = thread.toolCallIds.size
  const children = [
    // A blank line sets the echo apart from the answer.
    <Box marginBottom={1}>
      <Text>{echoOf(thread)}</Text>
    </Box>,
    ...(toolCount > 0 ? [<Text dimColor>{`⎿ ${toolCount} tool call${toolCount === 1 ? '' : 's'}`}</Text>] : []),
    answer !== '' ? <Markdown text={answer} /> : <Text dimColor>…</Text>,
    ...(thread.status === 'interrupted' ? [<Text dimColor>(interrupted)</Text>] : []),
  ]
  return (
    <Box marginLeft={depth * 2} flexDirection="column">
      <Box borderStyle="quote" flexDirection="column" paddingLeft={1}>
        {children}
      </Box>
    </Box>
  )
}

const MAX_DEPTH = 8

/**
 * Threads as a tree in drawing order: each root (no parent among `threads`) in creation order, followed
 * at once by its follow-ups, recursively, each one level deeper (indentation capped at MAX_DEPTH).
 */
export function orderedWithDepth(threads: readonly Thread[]): { thread: Thread; depth: number }[] {
  const ordered: { thread: Thread; depth: number }[] = []
  const placed = new Set<Thread>()
  const visit = (thread: Thread, depth: number) => {
    if (placed.has(thread)) return
    placed.add(thread)
    ordered.push({ thread, depth })
    for (const child of threads) if (child.parent === thread) visit(child, Math.min(depth + 1, MAX_DEPTH))
  }
  for (const thread of threads) {
    if (thread.parent === undefined || !threads.includes(thread.parent)) visit(thread, 0)
  }
  // A cycle has no root to reach it from: draw what it left out as roots rather than lose it.
  for (const thread of threads) visit(thread, 0)
  return ordered
}

/**
 * An assistant block with each thread inserted after its anchored paragraph, and `before` (threads hosted
 * for a row above, such as a diff) ahead of its first.
 */
export function anchorView(els: Els, markdown: string, threads: readonly Thread[], before: readonly Thread[] = []) {
  const { Box, Markdown } = els
  const paragraphs = splitParagraphs(markdown)
  const children: unknown[] = orderedWithDepth(before).map(({ thread, depth }) => threadView(els, thread, depth))
  let start = 0
  const anchoredAt = [...new Set(threads.map(t => t.anchor.paragraphIndex))].sort((x, y) => x - y)
  for (const index of anchoredAt) {
    const text = paragraphs.slice(start, index + 1).join('\n\n')
    if (text !== '') children.push(<Markdown text={text} />)
    for (const { thread, depth } of orderedWithDepth(threads.filter(t => t.anchor.paragraphIndex === index))) {
      children.push(threadView(els, thread, depth))
    }
    start = index + 1
  }
  if (start < paragraphs.length) children.push(<Markdown text={paragraphs.slice(start).join('\n\n')} />)
  return <Box flexDirection="column">{children}</Box>
}

/** A row drawn whole (a tool's result, such as a diff), with its threads beneath it. */
export function belowView(els: Els, row: unknown, threads: readonly Thread[]) {
  const { Box } = els
  const children = orderedWithDepth(threads).map(({ thread, depth }) => threadView(els, thread, depth))
  return (
    <Box flexDirection="column">
      {row}
      {children}
    </Box>
  )
}
