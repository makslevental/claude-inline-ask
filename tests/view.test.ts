import { describe, test, expect } from 'claude-code/testing'
import { createThreads } from '../hooks/threads'
import { orderedWithDepth } from '../hooks/view'

const anchor = { messageId: 'm1', paragraphIndex: 1 }

describe('orderedWithDepth', () => {
  test('draws each root, then its follow-ups nested beneath it', () => {
    const threads = createThreads()
    const root1 = threads.add(anchor, 'r1', 'P1')
    const root2 = threads.add(anchor, 'r2', 'P2')
    const child = threads.add(anchor, 'c', 'P3', root1)
    const grandchild = threads.add(anchor, 'g', 'P4', child)
    expect(orderedWithDepth(threads.all())).toEqual([
      { thread: root1, depth: 0 },
      { thread: child, depth: 1 },
      { thread: grandchild, depth: 2 },
      { thread: root2, depth: 0 },
    ])
  })

  test('a follow-up whose parent is not in the list is a root', () => {
    const threads = createThreads()
    const parent = threads.add(anchor, 'p', 'P1')
    const child = threads.add(anchor, 'c', 'P2', parent)
    expect(orderedWithDepth([child])).toEqual([{ thread: child, depth: 0 }])
  })

  test('siblings keep creation order', () => {
    const threads = createThreads()
    const root = threads.add(anchor, 'r', 'P1')
    const a = threads.add(anchor, 'a', 'P2', root)
    const b = threads.add(anchor, 'b', 'P3', root)
    const c = threads.add(anchor, 'c', 'P4', root)
    expect(orderedWithDepth(threads.all()).map(entry => [entry.thread.question, entry.depth])).toEqual([
      ['r', 0],
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ])
    expect(orderedWithDepth(threads.all()).map(entry => entry.thread)).toEqual([root, a, b, c])
  })
})
