import { describe, test, expect } from 'claude-code/testing'
import { buildPrompt, claimOf, createThreads } from '../hooks/threads'

const anchor = { messageId: 'm1', paragraphIndex: 1 }

describe('buildPrompt', () => {
  test('quotes the selection line by line, then the question', () => {
    expect(buildPrompt('line one\nline two', 'why?')).toBe(
      'About this part of your earlier reply:\n> line one\n> line two\n\nwhy?',
    )
  })
})

describe('claimOf', () => {
  test('prompt door claims the user message and its text', () => {
    const row = { door: 'prompt', uuid: 'u1', message: { content: [{ type: 'text', text: ' hi ' }] } }
    expect(claimOf(row)).toEqual({ userId: 'u1', userText: 'hi', toolIds: [] })
  })
  test('response door claims the row as a reply block, plus tool_use ids', () => {
    const row = {
      door: 'response',
      uuid: 'a1',
      message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1' }] },
    }
    expect(claimOf(row)).toEqual({ replyId: 'a1', toolIds: ['t1'] })
  })
  test('a response row with only a thinking or tool_use block is still a reply block', () => {
    const row = { door: 'response', uuid: 'a2', message: { content: [{ type: 'tool_use', id: 't2' }] } }
    expect(claimOf(row)).toEqual({ replyId: 'a2', toolIds: ['t2'] })
    const thinking = { door: 'response', uuid: 'a4', message: { content: [{ type: 'thinking' }] } }
    expect(claimOf(thinking)).toEqual({ replyId: 'a4', toolIds: [] })
  })
  test('prompt with plain string content', () => {
    const row = { door: 'prompt', uuid: 'u1', message: { content: ' hi ' } }
    expect(claimOf(row)).toEqual({ userId: 'u1', userText: 'hi', toolIds: [] })
  })
  test('prompt with several text blocks joins them', () => {
    const row = { door: 'prompt', uuid: 'u1', message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }
    expect(claimOf(row).userText).toBe('a\nb')
  })
  test('tool-result rows claim nothing', () => {
    const row = { door: 'tool-result', uuid: 'r1', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }
    expect(claimOf(row)).toEqual({ toolIds: [] })
  })
  test('subagent rows claim nothing', () => {
    const row = { door: 'response', uuid: 'a3', agentId: 'x', message: { content: [{ type: 'text', text: 'ok' }] } }
    expect(claimOf(row)).toEqual({ toolIds: [] })
  })
})

describe('createThreads', () => {
  test('pending → streaming → done, binding rows on the way', () => {
    const threads = createThreads()
    const t = threads.add(anchor, 'why?', 'PROMPT')
    expect(t.status).toBe('pending')
    threads.claim({ userId: 'u1', userText: 'PROMPT', toolIds: [] })
    expect(threads.startTurn('PROMPT', 'turn-1')?.status).toBe('streaming')
    threads.claim({ replyId: 'a1', toolIds: ['t1'] })
    expect(threads.ownerOf('u1')).toBe(t)
    expect(threads.ownerOf('a1')).toBe(t)
    expect(threads.ownerOf('t1')).toBe(t)
    expect(threads.ownerOf('other')).toBeUndefined()
    threads.complete('turn-1', 'answer')
    expect(t.status).toBe('done')
  })
  test('an aborted turn marks the thread interrupted', () => {
    const threads = createThreads()
    const t = threads.add(anchor, 'q', 'P')
    threads.startTurn('P', 'turn-1')
    threads.complete('turn-1', 'aborted')
    expect(t.status).toBe('interrupted')
  })
  test('a turn with other text does not start the thread', () => {
    const threads = createThreads()
    const t = threads.add(anchor, 'q', 'P')
    expect(threads.startTurn('something else', 'turn-1')).toBeUndefined()
    expect(t.status).toBe('pending')
  })
  test('reply and tool rows are ignored when no thread is streaming', () => {
    const threads = createThreads()
    threads.add(anchor, 'q', 'P')
    threads.claim({ replyId: 'a1', toolIds: ['t1'] })
    expect(threads.ownerOf('a1')).toBeUndefined()
  })
  test('setReply stores text and reports whether it changed', () => {
    const threads = createThreads()
    const t = threads.add(anchor, 'q', 'P')
    threads.startTurn('P', 'turn-1')
    threads.claim({ replyId: 'a1', toolIds: [] })
    expect(threads.setReply(t, 'a1', 'hel')).toBe(true)
    expect(threads.setReply(t, 'a1', 'hel')).toBe(false)
    expect(threads.setReply(t, 'a1', 'hello')).toBe(true)
    expect([...t.replyBlocks.values()]).toEqual(['hello'])
  })
  test('anchoredAt lists threads for one paragraph in creation order', () => {
    const threads = createThreads()
    const a = threads.add(anchor, 'q1', 'P1')
    const b = threads.add(anchor, 'q2', 'P2')
    threads.add({ messageId: 'm1', paragraphIndex: 0 }, 'q3', 'P3')
    expect(threads.anchoredAt('m1', 1)).toEqual([a, b])
  })
  test('remove drops a thread', () => {
    const threads = createThreads()
    const t = threads.add(anchor, 'q', 'P')
    threads.remove(t)
    expect(threads.all()).toEqual([])
  })
  test('a stale pending thread is interrupted when the same text is submitted again', () => {
    const threads = createThreads()
    const a = threads.add(anchor, 'q', 'P')
    threads.claim({ userId: 'u1', userText: 'P', toolIds: [] })
    const b = threads.add(anchor, 'q', 'P')
    threads.claim({ userId: 'u2', userText: 'P', toolIds: [] })
    expect(a.status).toBe('interrupted')
    expect(b.userMessageId).toBe('u2')
    expect(threads.startTurn('P', 'turn-2')).toBe(b)
    expect(b.status).toBe('streaming')
    expect(threads.ownerOf('u1')).toBe(a)
    expect(threads.ownerOf('u2')).toBe(b)
  })
  test('startTurn closes a stale streaming thread', () => {
    const threads = createThreads()
    const a = threads.add(anchor, 'q', 'P1')
    threads.startTurn('P1', 't1')
    const b = threads.add(anchor, 'q', 'P2')
    threads.startTurn('P2', 't2')
    expect(a.status).toBe('interrupted')
    expect(b.status).toBe('streaming')
    threads.claim({ replyId: 'a9', toolIds: [] })
    expect(threads.ownerOf('a9')).toBe(b)
  })
  test('a streaming thread does not take a later prompt row', () => {
    const threads = createThreads()
    const a = threads.add(anchor, 'q', 'P')
    threads.startTurn('P', 't1')
    threads.claim({ userId: 'u9', userText: 'P', toolIds: [] })
    expect(a.userMessageId).toBeUndefined()
  })
  test('error and refusal turns are interrupted', () => {
    const threads = createThreads()
    const a = threads.add(anchor, 'q', 'P1')
    const b = threads.add(anchor, 'q', 'P2')
    threads.startTurn('P1', 't1')
    threads.complete('t1', 'error')
    threads.startTurn('P2', 't2')
    threads.complete('t2', 'refusal')
    expect(a.status).toBe('interrupted')
    expect(b.status).toBe('interrupted')
  })
})
