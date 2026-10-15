import type { Register } from 'claude-code'
import { locateAnchor } from './anchor'
import { buildPrompt, claimOf, createThreads } from './threads'
import { anchorView, hidden } from './view'

export const register: Register = (on) => {
  // Assistant block id → markdown, in render order. Module state: lost on a mod reload (v1).
  const blocks = new Map<string, string>()
  const threads = createThreads()

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
    const selection = await $.ui.selection()
    if (selection === undefined) {
      $.ui.toast('Select text in a reply first (needs fullscreen: /fullscreen)')
      return {}
    }
    const anchor = locateAnchor(selection, blocks)
    if (anchor === undefined) {
      $.ui.toast("Couldn't find the selection in one of Claude's replies")
      return {}
    }
    const text = buildPrompt(selection.text, question)
    const thread = threads.add(anchor, question, text)
    // The engine rejects a submit made inside this hook (it would wait on the turn the hook holds),
    // so submit from a timer. Not awaited: it resolves when the turn starts, and waits while Claude is busy.
    $.clock.after(200, () => {
      const fail = (reason: string) => {
        threads.remove(thread)
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
    threads.startTurn(e.text, e.turnId)
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    threads.claim(claimOf(e))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    threads.complete(e.turnId, e.reason)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // The thread's own rows are drawn inline in the anchored block, not at the bottom.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (threads.ownerOf(e.requestId) === undefined) return next(e)
    return hidden($.ui.resolve(e))
  })
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (threads.ownerOf(e.requestId) === undefined) return next(e)
    return hidden($.ui.resolve(e))
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (threads.ownerOf(e.requestId) === undefined) return next(e)
    return hidden($.ui.resolve(e))
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
      if (threads.setReply(owner, e.requestId, e.props.text)) $.ui.invalidate('ui.render')
      return hidden($.ui.resolve(e))
    }
    // A summary block shares its reply's id but holds only a summary of the text.
    if (e.props.isSummary !== true) blocks.set(e.requestId, e.props.text)
    const here = threads.all().filter(t => t.anchor.messageId === e.requestId)
    if (here.length === 0) return next(e)
    return anchorView($.ui.resolve(e), e.props.text, here)
  })
}
