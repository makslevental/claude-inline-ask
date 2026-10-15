import { describe, test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

type Selection = { text: string; requestId?: string } | undefined

// Engine stand-ins beneath the plugin; returns what the plugin sent to toast and prompt.submit.
function world(on: On, selection: Selection, dropReason?: string) {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const submitted: string[] = []
  on('ui.selection', () => ({ value: selection }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return dropReason === undefined ? { text: e.text } : { drop: dropReason }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['reply'] }) as never)
  return { clock, toasts, submitted }
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
