import { normalize } from './anchor'
import type { Anchor } from './anchor'

export type ThreadStatus = 'pending' | 'streaming' | 'done' | 'interrupted'

export type Thread = {
  anchor: Anchor
  question: string
  submittedText: string
  status: ThreadStatus
  turnId?: string
  userMessageId?: string
  /** reply block id → latest text, in arrival order */
  replyBlocks: Map<string, string>
  toolCallIds: Set<string>
}

/** What a stored row contributes to the active thread. */
export type RowClaim = { userId?: string; userText?: string; replyId?: string; toolIds: string[] }

type Block = { type?: string; id?: string; text?: string }
type AppendedRow = { door: string; uuid: string; agentId?: string; message: { content: unknown } }

export function buildPrompt(selectedText: string, question: string): string {
  const quoted = selectedText
    .trim()
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
  return `About this part of your earlier reply:\n${quoted}\n\n${question}`
}

/** Reads a `session.append` row into the ids and text a thread needs. Subagent rows claim nothing. */
export function claimOf(row: AppendedRow): RowClaim {
  if (row.agentId !== undefined) return { toolIds: [] }
  const content = row.message.content
  const blocks: Block[] = Array.isArray(content) ? (content as Block[]) : []
  if (row.door === 'prompt') {
    const text = typeof content === 'string' ? content : blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
    return { userId: row.uuid, userText: text.trim(), toolIds: [] }
  }
  const toolIds = blocks.flatMap(b => (b.type === 'tool_use' && b.id !== undefined ? [b.id] : []))
  // At append time a response row may hold only a `thinking` block; its text arrives later under the same id.
  if (row.door === 'response') return { replyId: row.uuid, toolIds }
  return { toolIds: [] }
}

export function createThreads() {
  const threads: Thread[] = []
  const streaming = () => threads.find(t => t.status === 'streaming')

  return {
    all: (): readonly Thread[] => threads,

    add(anchor: Anchor, question: string, submittedText: string): Thread {
      const thread: Thread = {
        anchor,
        question,
        submittedText: submittedText.trim(),
        status: 'pending',
        replyBlocks: new Map(),
        toolCallIds: new Set(),
      }
      threads.push(thread)
      return thread
    },

    remove(thread: Thread): void {
      const i = threads.indexOf(thread)
      if (i !== -1) threads.splice(i, 1)
    },

    /** The prompt's turn began: the pending thread with that exact text starts streaming. */
    startTurn(text: string, turnId: string): Thread | undefined {
      const thread = threads.find(t => t.status === 'pending' && t.submittedText === text.trim())
      if (thread === undefined) return undefined
      for (const stale of threads) if (stale.status === 'streaming') stale.status = 'interrupted'
      thread.status = 'streaming'
      thread.turnId = turnId
      return thread
    },

    /**
     * Binds a stored row: the user message by its text (it is stored before the turn starts), the rest to the
     * streaming thread. A prompt row no pending thread takes ends the streaming thread's claim: it was delivered
     * into or queued after that turn, so what follows belongs to the normal transcript. True when anything drawn changed.
     */
    claim(claim: RowClaim): boolean {
      if (claim.userId !== undefined) {
        let changed = false
        for (const stale of threads) {
          if (stale.status === 'pending' && stale.userMessageId !== undefined && stale.submittedText === claim.userText) {
            stale.status = 'interrupted'
            changed = true
          }
        }
        const thread = threads.find(t => t.status === 'pending' && t.userMessageId === undefined && t.submittedText === claim.userText)
        if (thread !== undefined) {
          thread.userMessageId = claim.userId
          return true
        }
        const current = streaming()
        if (current !== undefined) current.status = 'done'
        return changed
      }
      const thread = streaming()
      if (thread === undefined) return false
      let changed = false
      if (claim.replyId !== undefined && !thread.replyBlocks.has(claim.replyId)) {
        thread.replyBlocks.set(claim.replyId, '')
        changed = true
      }
      for (const id of claim.toolIds) {
        if (!thread.toolCallIds.has(id)) {
          thread.toolCallIds.add(id)
          changed = true
        }
      }
      return changed
    },

    /** The turn ended: 'answer' means done; any other reason ('aborted', 'error', 'refusal') means interrupted. */
    complete(turnId: string, reason: string): void {
      const thread = threads.find(t => t.turnId === turnId)
      if (thread === undefined) return
      thread.status = reason === 'answer' ? 'done' : 'interrupted'
    },

    /** Stores a reply block's text; true when it changed. */
    setReply(thread: Thread, blockId: string, text: string): boolean {
      if (thread.replyBlocks.get(blockId) === text) return false
      thread.replyBlocks.set(blockId, text)
      return true
    },

    /** The newest thread whose question or answer holds the selected text: a follow-up anchors where it does. */
    findByText(selectedText: string): Thread | undefined {
      const needle = normalize(selectedText)
      if (needle === '') return undefined
      for (let i = threads.length - 1; i >= 0; i--) {
        const thread = threads[i]!
        const text = normalize(thread.question + ' ' + [...thread.replyBlocks.values()].join(' '))
        if (text.includes(needle)) return thread
      }
      return undefined
    },

    ownerOf(id: string): Thread | undefined {
      return threads.find(t => t.userMessageId === id || t.replyBlocks.has(id) || t.toolCallIds.has(id))
    },
  }
}
