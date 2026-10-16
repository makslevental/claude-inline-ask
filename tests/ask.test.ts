import { describe, test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

type Selection = { text: string; requestId?: string } | undefined

// Engine stand-ins beneath the plugin; returns what the plugin sent to toast and prompt.submit,
// and how many times it asked for a redraw.
// `selection` may be a function, read on each `$.ui.selection()`, for tests that select twice.
function world(on: On, selection: Selection | (() => Selection), dropReason?: string) {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const submitted: string[] = []
  let invalidations = 0
  on('ui.invalidate', () => {
    invalidations += 1
    return { value: undefined }
  })
  on('ui.selection', () => ({ value: typeof selection === 'function' ? selection() : selection }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return dropReason === undefined ? { text: e.text } : { drop: dropReason }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['reply'] }) as never)
  return { clock, toasts, submitted, invalidations: () => invalidations }
}

const ask = (args: string) =>
  ({ command: 'ask', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } }) as never

describe('/ask', () => {
  test('empty question shows usage and submits nothing', async ($, on) => {
    const w = world(on, { text: 'x', requestId: 'm1' })
    await $.command.run(ask('   '))
    await w.clock.advance(200)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('Usage: /ask')
    expect(w.submitted).toEqual([])
  })

  test('a Claude Code without a working selection API gets a clear toast', async ($, on) => {
    const w = world(on, () => {
      throw new TypeError('$.ui.selection is not a function')
    })
    await $.command.run(ask('why?'))
    await w.clock.advance(200)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('recent Claude Code')
    expect(w.submitted).toEqual([])
  })

  test('no selection asks to select text first', async ($, on) => {
    const w = world(on, undefined)
    await $.command.run(ask('why?'))
    await w.clock.advance(200)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('Select text in a reply first')
    expect(w.submitted).toEqual([])
  })

  test('a selection outside every seen reply is reported', async ($, on) => {
    const w = world(on, { text: 'nowhere to be found', requestId: 'm1' })
    await $.command.run(ask('why?'))
    await w.clock.advance(200)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain("Couldn't find the selection")
    expect(w.submitted).toEqual([])
  })

  test('a located selection submits the quoted prompt after the timer', async ($, on) => {
    const w = world(on, { text: 'Second paragraph', requestId: 'm1' })
    await $.ui.render({
      component: 'AssistantMessage',
      requestId: 'm1',
      surface: 'terminal',
      props: { text: 'First paragraph.\n\nSecond paragraph here.', isFirstOfReply: true },
    } as never)
    await $.command.run(ask('why?'))
    expect(w.submitted).toEqual([]) // the engine rejects a submit inside the command hook, so nothing yet
    await w.clock.advance(200)
    expect(w.toasts).toEqual([])
    expect(w.submitted).toEqual(['About this part of your earlier reply:\n> Second paragraph\n\nwhy?'])
  })

  test('a dropped submit toasts the reason', async ($, on) => {
    const w = world(on, { text: 'Second paragraph', requestId: 'm1' }, 'blocked by a policy')
    await $.ui.render({
      component: 'AssistantMessage',
      requestId: 'm1',
      surface: 'terminal',
      props: { text: 'First paragraph.\n\nSecond paragraph here.', isFirstOfReply: true },
    } as never)
    await $.command.run(ask('why?'))
    await w.clock.advance(200)
    expect(w.toasts).toEqual(['Could not send the question: blocked by a policy'])
  })
})

const ANCHORED = 'First paragraph.\n\nSecond paragraph here.\n\nThird.'
const PROMPT = 'About this part of your earlier reply:\n> Second paragraph\n\nwhy?'

const render = (component: string, requestId: string, props: object) =>
  ({ component, requestId, surface: 'terminal', props }) as never

const toolRow = (uuid: string, id: string) =>
  ({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: {} }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude' },
    uuid,
  }) as never

const toolGroup = (id: string) =>
  render('ToolGroup', `collapsed-${id}`, {
    calls: [{ tool_use_id: id, tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }],
    isActive: false,
    isExpanded: false,
  })

const row = (door: 'prompt' | 'response', uuid: string, text: string) =>
  (door === 'prompt'
    ? {
        message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
        door,
        origin: { kind: 'plugin', name: 'inline-ask', asUser: true },
        uuid,
      }
    : {
        message: { type: 'assistant', role: 'assistant', content: [{ type: 'thinking', thinking: text }] },
        door,
        origin: { kind: 'model', model: 'claude' },
        uuid,
      }) as never

const completed = (reason: 'answer' | 'aborted') =>
  ({ turnId: 't1', reason, answer: reason === 'answer' ? 'The answer.' : '', durationMs: 1, isAborted: reason === 'aborted' }) as never

const drawAnchored = async ($: Engine) =>
  JSON.stringify(await $.ui.render(render('AssistantMessage', 'm1', { text: ANCHORED, isFirstOfReply: true })))

// The engine beneath a turn, with the anchored reply's paragraph selected.
function turnWorld(on: On, selection: Selection | (() => Selection) = { text: 'Second paragraph', requestId: 'm1' }) {
  const w = world(on, selection)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return w
}

// /ask run up to its streamed reply (steps shared by the lifecycle tests).
async function streamThread($: Engine, on: On, selection?: () => Selection) {
  const w = turnWorld(on, selection)

  await $.ui.render(render('AssistantMessage', 'm1', { text: ANCHORED, isFirstOfReply: true }))
  await $.command.run(ask('why?'))
  await w.clock.advance(200)
  expect(w.submitted).toEqual([PROMPT])

  // The prompt row is stored before the turn starts; the response row arrives holding only thinking.
  const prompt = await $.session.append(row('prompt', 'u-prompt', PROMPT))
  await $.turn.start({ text: PROMPT, turnId: 't1' })
  const response = await $.session.append(row('response', 'u-response', 'x'))

  const user = JSON.stringify(
    await $.ui.render(
      render('UserMessage', prompt.uuid ?? 'u-prompt', {
        text: PROMPT,
        origin: { kind: 'plugin', name: 'inline-ask', asUser: true },
        isExpanded: false,
      }),
    ),
  )
  expect(user).toContain('"display":"none"')
  const reply = JSON.stringify(
    await $.ui.render(render('AssistantMessage', response.uuid ?? 'u-response', { text: 'The answer.', isFirstOfReply: true })),
  )
  expect(reply).toContain('"display":"none"')

  const anchored = await drawAnchored($)
  expect(anchored).toContain('• why?: “Second paragraph”')
  expect(anchored).toMatch(/marginBottom\W+1\b/) // a blank line after the echo
  expect(anchored).toContain('The answer.')
  expect(anchored.indexOf('Second paragraph here.')).toBeLessThan(anchored.indexOf('why?'))
  expect(anchored.indexOf('why?')).toBeLessThan(anchored.indexOf('Third.'))
  return { w, replyId: response.uuid ?? 'u-response' }
}

describe('/ask thread', () => {
  test('thread lifecycle binds, hides and draws inline', async ($, on) => {
    await streamThread($, on)
    await $.turn.complete(completed('answer'))
    const done = await drawAnchored($)
    expect(done).toContain('The answer.')
    expect(done).not.toContain('(interrupted)')
  })

  test('an interrupted turn is marked', async ($, on) => {
    await streamThread($, on)
    await $.turn.complete(completed('aborted'))
    expect(await drawAnchored($)).toContain('(interrupted)')
  })

  test('rows of other turns are untouched', async ($, on) => {
    world(on, undefined)
    const prompt = await $.session.append(row('prompt', 'u-hello', 'hello'))
    const user = JSON.stringify(
      await $.ui.render(
        render('UserMessage', prompt.uuid ?? 'u-hello', { text: 'hello', origin: { kind: 'composer' }, isExpanded: false }),
      ),
    )
    expect(user).toContain('reply')
    expect(user).not.toContain('none')
  })

  test('the transcript is redrawn when the thread is created, starts and claims a row', async ($, on) => {
    const w = turnWorld(on)
    await $.ui.render(render('AssistantMessage', 'm1', { text: ANCHORED, isFirstOfReply: true }))
    await $.command.run(ask('why?'))
    const created = w.invalidations()
    expect(created).toBeGreaterThanOrEqual(1)
    await w.clock.advance(200)
    await $.session.append(row('prompt', 'u-prompt', PROMPT))
    const bound = w.invalidations()
    expect(bound).toBeGreaterThan(created)
    await $.turn.start({ text: PROMPT, turnId: 't1' })
    const started = w.invalidations()
    expect(started).toBeGreaterThan(bound)
    await $.session.append(row('response', 'u-response', 'x'))
    expect(w.invalidations()).toBeGreaterThan(started)
  })

  test('a summary block is never drawn with the thread', async ($, on) => {
    const { replyId } = await streamThread($, on)
    const summary = JSON.stringify(
      await $.ui.render(render('AssistantMessage', 'm1', { text: 'A summary.', isFirstOfReply: true, isSummary: true })),
    )
    expect(summary).not.toContain('why?')
    // A summary of the thread's own reply is hidden and does not replace the reply's text.
    const replySummary = JSON.stringify(
      await $.ui.render(render('AssistantMessage', replyId, { text: 'Short.', isFirstOfReply: true, isSummary: true })),
    )
    expect(replySummary).toContain('"display":"none"')
    const anchored = await drawAnchored($)
    expect(anchored).toContain('why?')
    expect(anchored).toContain('The answer.')
    expect(anchored).not.toContain('Short.')
  })

  test("the thread's tool rows are hidden, other tool groups are not", async ($, on) => {
    await streamThread($, on)
    await $.session.append(toolRow('u-tool', 'tool-1'))
    const use = JSON.stringify(await $.ui.render(render('ToolUse', 'tool-1', { tool: 'Read', input: {} })))
    expect(use).toContain('"display":"none"')
    const result = JSON.stringify(await $.ui.render(render('ToolResult', 'tool-1', { tool: 'Read', input: {} })))
    expect(result).toContain('"display":"none"')
    expect(JSON.stringify(await $.ui.render(toolGroup('tool-1')))).toContain('"display":"none"')
    const other = JSON.stringify(await $.ui.render(toolGroup('other')))
    expect(other).toContain('reply')
    expect(other).not.toContain('none')
  })

  test('a selection inside a drawn answer anchors a follow-up right below it', async ($, on) => {
    let selection: Selection = { text: 'Second paragraph', requestId: 'm1' }
    const w = turnWorld(on, () => selection)
    await $.ui.render(render('AssistantMessage', 'm1', { text: ANCHORED, isFirstOfReply: true }))

    // The first thread, answered and complete.
    await $.command.run(ask('why?'))
    await w.clock.advance(200)
    await $.session.append(row('prompt', 'u-prompt', PROMPT))
    await $.turn.start({ text: PROMPT, turnId: 't1' })
    const first = await $.session.append(row('response', 'u-response', 'x'))
    await $.ui.render(render('AssistantMessage', first.uuid ?? 'u-response', { text: 'The answer is forty-two.', isFirstOfReply: true }))
    await $.turn.complete(completed('answer'))
    // A thread on its own is not nested (`marginLeft` 0 or absent, never 2).
    expect(await drawAnchored($)).not.toMatch(/marginLeft\W+2\b/)

    // The engine reports the anchored block's id for a selection inside the drawn thread.
    selection = { text: 'forty-two', requestId: 'm1' }
    await $.command.run(ask('and why?'))
    await w.clock.advance(200)
    expect(w.toasts).toEqual([])
    expect(w.submitted.length).toBe(2)
    const followUp = w.submitted[1]!
    expect(followUp).toContain('> forty-two')
    expect(followUp).toContain('and why?')

    await $.session.append(row('prompt', 'u-prompt-2', followUp))
    await $.turn.start({ text: followUp, turnId: 't2' })
    const second = await $.session.append(row('response', 'u-response-2', 'x'))
    const reply = JSON.stringify(
      await $.ui.render(render('AssistantMessage', second.uuid ?? 'u-response-2', { text: 'Because.', isFirstOfReply: true })),
    )
    expect(reply).toContain('"display":"none"')

    const anchored = await drawAnchored($)
    expect(anchored.indexOf('Second paragraph here.')).toBeLessThan(anchored.indexOf('why?'))
    expect(anchored.indexOf('why?')).toBeLessThan(anchored.indexOf('The answer is forty-two.'))
    expect(anchored.indexOf('The answer is forty-two.')).toBeLessThan(anchored.indexOf('and why?'))
    expect(anchored.indexOf('and why?')).toBeLessThan(anchored.indexOf('Because.'))
    expect(anchored.indexOf('Because.')).toBeLessThan(anchored.indexOf('Third.'))
    // The follow-up is nested one level beneath the thread it quotes.
    expect(anchored).toMatch(/marginLeft\W+2\b/)
  })

  test('a selection in no reply and no thread is still reported', async ($, on) => {
    let selection: Selection = { text: 'Second paragraph', requestId: 'm1' }
    const { w } = await streamThread($, on, () => selection)
    selection = { text: 'nowhere to be found', requestId: 'm1' }
    await $.command.run(ask('and why?'))
    await w.clock.advance(200)
    expect(w.toasts).toEqual(["Couldn't find the selection in one of Claude's replies"])
    expect(w.submitted).toEqual([PROMPT])
  })
})

const DIFF_ID = 'toolu-edit'
const DIFF_PROMPT = 'About this part of your Edit of /src/a.ts:\n> + const x = 1\n\nwhy?'
const PLAIN = JSON.stringify({ type: 'Text', props: {}, children: ['reply'] })

const drawDiff = async ($: Engine) =>
  JSON.stringify(
    await $.ui.render(
      render('ToolResult', DIFF_ID, {
        tool_use_id: DIFF_ID,
        tool: 'Edit',
        output: { filePath: '/src/a.ts', structuredPatch: [] },
        isErrored: false,
      }),
    ),
  )

// The reply block Claude wrote after the edit, in the same turn.
const drawAfter = async ($: Engine) =>
  JSON.stringify(await $.ui.render(render('AssistantMessage', 'm-after', { text: 'Done editing.', isFirstOfReply: false })))

// /ask on the diff, answered and complete.
async function answerDiff($: Engine, w: ReturnType<typeof world>) {
  await $.command.run(ask('why?'))
  await w.clock.advance(200)
  expect(w.toasts).toEqual([])
  expect(w.submitted).toEqual([DIFF_PROMPT])
  await $.session.append(row('prompt', 'u-prompt', DIFF_PROMPT))
  await $.turn.start({ text: DIFF_PROMPT, turnId: 't1' })
  const first = await $.session.append(row('response', 'u-response', 'x'))
  await $.ui.render(render('AssistantMessage', first.uuid ?? 'u-response', { text: 'Because x is needed.', isFirstOfReply: true }))
  await $.turn.complete(completed('answer'))
}

describe('/ask on a tool row', () => {
  test("a diff's thread is drawn atop the reply block after it, where a follow-up nests in it", async ($, on) => {
    let selection: Selection = { text: '+ const x = 1', requestId: DIFF_ID }
    const w = turnWorld(on, () => selection)
    await drawDiff($)
    await drawAfter($)
    await answerDiff($, w)

    // Not in the tool row, whose plugin-drawn text the engine cannot select.
    expect(await drawDiff($)).toBe(PLAIN)
    const after = await drawAfter($)
    expect(after.indexOf('why?')).toBeGreaterThan(-1)
    expect(after.indexOf('why?')).toBeLessThan(after.indexOf('Because x is needed.'))
    expect(after.indexOf('Because x is needed.')).toBeLessThan(after.indexOf('Done editing.'))
    expect(after).not.toMatch(/marginLeft\W+2\b/)

    // The engine reports the hosting block for a selection inside the thread.
    selection = { text: 'x is needed', requestId: 'm-after' }
    await $.command.run(ask('and then?'))
    await w.clock.advance(200)
    expect(w.toasts).toEqual([])
    const followUp = w.submitted[1]!
    expect(followUp).toBe('About this part of your earlier reply:\n> x is needed\n\nand then?')

    await $.session.append(row('prompt', 'u-prompt-2', followUp))
    await $.turn.start({ text: followUp, turnId: 't2' })
    const second = await $.session.append(row('response', 'u-response-2', 'x'))
    await $.ui.render(render('AssistantMessage', second.uuid ?? 'u-response-2', { text: 'Then it runs.', isFirstOfReply: true }))

    const nested = await drawAfter($)
    expect(nested.indexOf('Because x is needed.')).toBeLessThan(nested.indexOf('and then?'))
    expect(nested.indexOf('and then?')).toBeLessThan(nested.indexOf('Then it runs.'))
    expect(nested.indexOf('Then it runs.')).toBeLessThan(nested.indexOf('Done editing.'))
    expect(nested).toMatch(/marginLeft\W+2\b/)
  })

  test('with no reply block after it in its turn, the thread is drawn beneath the diff', async ($, on) => {
    const w = turnWorld(on, { text: '+ const x = 1', requestId: DIFF_ID })
    await drawDiff($)
    await $.ui.render(render('UserMessage', 'u-next', { text: 'next', origin: { kind: 'composer' }, isExpanded: false }))
    await $.ui.render(render('AssistantMessage', 'm-next', { text: 'Next turn.', isFirstOfReply: true }))
    await answerDiff($, w)

    const diff = await drawDiff($)
    expect(diff.indexOf('reply')).toBeGreaterThan(-1)
    expect(diff.indexOf('reply')).toBeLessThan(diff.indexOf('why?'))
    expect(diff.indexOf('why?')).toBeLessThan(diff.indexOf('Because x is needed.'))
    const next = JSON.stringify(await $.ui.render(render('AssistantMessage', 'm-next', { text: 'Next turn.', isFirstOfReply: true })))
    expect(next).not.toContain('why?')
  })

  test('a reply block drawn later takes the thread over and redraws', async ($, on) => {
    const w = turnWorld(on, { text: '+ const x = 1', requestId: DIFF_ID })
    await drawDiff($)
    await answerDiff($, w)
    expect(await drawDiff($)).toContain('why?')

    const before = w.invalidations()
    expect(await drawAfter($)).toContain('why?')
    expect(w.invalidations()).toBeGreaterThan(before)
    expect(await drawDiff($)).toBe(PLAIN)
  })

  test('a selection naming a tool row that was never drawn is reported', async ($, on) => {
    const w = world(on, { text: '+ const x = 1', requestId: DIFF_ID })
    await $.command.run(ask('why?'))
    await w.clock.advance(200)
    expect(w.toasts).toEqual(["Couldn't find the selection in one of Claude's replies"])
    expect(w.submitted).toEqual([])
  })
})
