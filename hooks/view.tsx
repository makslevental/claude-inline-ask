import { splitParagraphs } from './anchor'
import type { Thread } from './threads'

// The element table `$.ui.resolve(e)` returns; only these three are used.
type Els = { Box: any; Text: any; Markdown: any }

/** A row that takes no room: the thread's own messages, drawn inline instead. */
export function hidden(els: Els) {
  const { Box } = els
  return <Box display="none" />
}

export function threadView(els: Els, thread: Thread) {
  const { Box, Text, Markdown } = els
  const answer = [...thread.replyBlocks.values()].filter(text => text !== '').join('\n\n')
  const toolCount = thread.toolCallIds.size
  const children = [
    <Text dimColor>{thread.question}</Text>,
    ...(toolCount > 0 ? [<Text dimColor>{`⎿ ${toolCount} tool call${toolCount === 1 ? '' : 's'}`}</Text>] : []),
    answer !== '' ? <Markdown text={answer} /> : <Text dimColor>…</Text>,
    ...(thread.status === 'interrupted' ? [<Text dimColor>(interrupted)</Text>] : []),
  ]
  return (
    <Box borderStyle="quote" flexDirection="column" paddingLeft={1}>
      {children}
    </Box>
  )
}

/** An assistant block with each thread inserted after its anchored paragraph. */
export function anchorView(els: Els, markdown: string, threads: readonly Thread[]) {
  const { Box, Markdown } = els
  const paragraphs = splitParagraphs(markdown)
  const children: unknown[] = []
  let start = 0
  const anchoredAt = [...new Set(threads.map(t => t.anchor.paragraphIndex))].sort((x, y) => x - y)
  for (const index of anchoredAt) {
    const text = paragraphs.slice(start, index + 1).join('\n\n')
    if (text !== '') children.push(<Markdown text={text} />)
    for (const thread of threads.filter(t => t.anchor.paragraphIndex === index)) children.push(threadView(els, thread))
    start = index + 1
  }
  if (start < paragraphs.length) children.push(<Markdown text={paragraphs.slice(start).join('\n\n')} />)
  return <Box flexDirection="column">{children}</Box>
}
