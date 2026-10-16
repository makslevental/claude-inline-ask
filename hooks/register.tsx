import type { Register } from 'claude-code'
import { locateAnchor } from './anchor'
import { buildPrompt, claimOf, createThreads, toolSource } from './threads'
import type { Thread } from './threads'
import { anchorView, belowView, hidden } from './view'

export const register: Register = (on) => {
  // Assistant block id → markdown, in render order. Module state: lost on a mod reload (v1).
  const blocks = new Map<string, string>()
  // Tool result row id (its tool_use_id) → how the prompt names it. A diff is one of these, not an assistant block.
  const toolRows = new Map<string, string>()
  // Row ids in the order first drawn (assistant blocks, tool results, user messages), and which are user messages.
  const rows: string[] = []
  const drawn = new Set<string>()
  const userRows = new Set<string>()
  const threads = createThreads()

  /** Records a row's place; true the first time it is drawn. */
  const note = (id: string): boolean => {
    if (drawn.has(id)) return false
    drawn.add(id)
    rows.push(id)
    return true
  }

  /**
   * Where a tool row's threads draw: the first reply block after it in its turn. The engine reports no selection
   * over a plugin's tree inside a tool row, so a thread drawn there could not be followed up.
   */
  const hostOf = (toolId: string): string | undefined => {
    for (let i = rows.indexOf(toolId) + 1; i > 0 && i < rows.length; i++) {
      const id = rows[i]!
      if (userRows.has(id)) return undefined
      if (blocks.has(id)) return id
    }
    return undefined
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ask',
      description: 'Ask about the selected text; the answer appears under its paragraph',
      argumentHint: '<question>',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'ask' }, async ($, e) => {
    const question = e.args.trim()
    if (question === '') {
      $.ui.toast('Usage: /ask <question> (select text in a reply first)')
      return {}
    }
    // A Claude Code too old to have `$.ui.selection` (or one that refuses it) rejects here.
    let selection
    try {
      selection = await $.ui.selection()
    } catch {
      $.ui.toast('This needs a recent Claude Code with fullscreen mode (tested on 2.1.293): update it, then /fullscreen')
      return {}
    }
    if (selection === undefined) {
      $.ui.toast('Select text in a reply first (needs fullscreen: /fullscreen)')
      return {}
    }
    // A selection inside a drawn thread makes a follow-up: anchored where that thread is, nested beneath it.
    // One in a tool row (a diff) that no thread drawn there holds is about the row: its thread goes beneath it.
    const toolRow = selection.requestId !== undefined ? toolRows.get(selection.requestId) : undefined
    let anchor = locateAnchor(selection, blocks)
    let parent: Thread | undefined
    let source: string | undefined
    if (anchor === undefined) {
      parent = threads.findByText(selection.text, toolRow !== undefined ? selection.requestId : undefined)
      anchor = parent?.anchor
    }
    if (anchor === undefined && toolRow !== undefined) {
      anchor = { messageId: selection.requestId!, paragraphIndex: 0 }
      source = toolRow
    }
    if (anchor === undefined) {
      $.ui.toast("Couldn't find the selection in one of Claude's replies")
      return {}
    }
    const text = buildPrompt(selection.text, question, source)
    const thread = threads.add({ ...anchor }, question, text, parent, selection.text)
    $.ui.invalidate('ui.render')
    // The engine rejects a submit made inside this hook (it would wait on the turn the hook holds),
    // so submit from a timer. Not awaited: it resolves when the turn starts, and waits while Claude is busy.
    $.clock.after(200, () => {
      const fail = (reason: string) => {
        threads.remove(thread)
        $.ui.invalidate('ui.render')
        $.ui.toast(reason)
      }
      $.prompt.submit({ text, asUser: true }).then(
        // Another plugin may drop the prompt: the call then resolves with `drop` and no turn starts.
        result => {
          if (result.drop !== undefined) fail(`Could not send the question: ${result.drop}`)
        },
        () => fail('Could not send the question'),
      )
    })
    return {}
  })

  on('turn.start', async ($, e, next) => {
    if (threads.startTurn(e.text, e.turnId) !== undefined) $.ui.invalidate('ui.render')
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    if (threads.claim(claimOf(e))) $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    threads.complete(e.turnId, e.reason)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // The thread's own rows are drawn inline in the anchored block, not at the bottom.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (note(e.requestId)) userRows.add(e.requestId)
    if (threads.ownerOf(e.requestId) === undefined) return next(e)
    return hidden($.ui.resolve(e))
  })
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (threads.ownerOf(e.requestId) === undefined) return next(e)
    return hidden($.ui.resolve(e))
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (threads.ownerOf(e.requestId) !== undefined) return hidden($.ui.resolve(e))
    toolRows.set(e.requestId, toolSource(e.props.tool, e.props.output))
    note(e.requestId)
    // Drawn here only until a reply block after the row can host them.
    if (hostOf(e.requestId) !== undefined) return next(e)
    const here = threads.all().filter(t => t.anchor.messageId === e.requestId)
    if (here.length === 0) return next(e)
    return belowView($.ui.resolve(e), await next(e), here)
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const ids = e.props.calls.map(call => call.tool_use_id)
    const isOwned = ids.length > 0 && ids.every(id => id !== undefined && threads.ownerOf(id) !== undefined)
    return isOwned ? hidden($.ui.resolve(e)) : next(e)
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const owner = threads.ownerOf(e.requestId)
    if (owner !== undefined) {
      // The thread's reply: keep its text for the anchor to draw, and redraw when it grew.
      // A summary block shares its reply's id but holds only a summary of the text: never stored.
      if (e.props.isSummary !== true && threads.setReply(owner, e.requestId, e.props.text)) $.ui.invalidate('ui.render')
      return hidden($.ui.resolve(e))
    }
    // A summary block is neither recorded nor redrawn as the anchor.
    if (e.props.isSummary === true) return next(e)
    blocks.set(e.requestId, e.props.text)
    const isNew = note(e.requestId)
    const hosted = threads.all().filter(t => toolRows.has(t.anchor.messageId) && hostOf(t.anchor.messageId) === e.requestId)
    // A new block may take over a tool row's threads: redraw that row without them.
    if (isNew && hosted.length > 0) $.ui.invalidate('ui.render')
    const here = threads.all().filter(t => t.anchor.messageId === e.requestId)
    if (here.length === 0 && hosted.length === 0) return next(e)
    return anchorView($.ui.resolve(e), e.props.text, here, hosted)
  })
}
