import { describe, test, expect } from 'claude-code/testing'
import { locateAnchor, normalize, splitParagraphs } from '../hooks/anchor'

const blocks = (entries: Record<string, string>) => new Map(Object.entries(entries))

describe('splitParagraphs', () => {
  test('splits on blank lines', () => {
    expect(splitParagraphs('one\ntwo\n\nthree')).toEqual(['one\ntwo', 'three'])
  })
  test('keeps a fenced code block as one paragraph, blank lines included', () => {
    const md = 'Intro\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nOutro'
    expect(splitParagraphs(md)).toEqual(['Intro', '```ts\nconst a = 1\n\nconst b = 2\n```', 'Outro'])
  })
  test('inline triple backticks do not open a fence', () => {
    expect(splitParagraphs('```x```\n\nA\n\nB')).toEqual(['```x```', 'A', 'B'])
  })
  test('a longer fence is not closed by a shorter one', () => {
    const md = '````md\n```ts\nx\n```\n````\n\nafter'
    expect(splitParagraphs(md)).toEqual(['````md\n```ts\nx\n```\n````', 'after'])
  })
  test('an unterminated fence runs to the end', () => {
    expect(splitParagraphs('Intro\n\n```ts\nconst a = 1\n\nstill code')).toEqual(['Intro', '```ts\nconst a = 1\n\nstill code'])
  })
})

describe('normalize', () => {
  test('strips underscore emphasis', () => {
    expect(normalize('_emphasis_ and __bold__')).toBe('emphasis and bold')
  })
  test('strips emphasis, code ticks, links, headings and list markers', () => {
    expect(normalize('## A **bold** and `code` and [a link](http://x.y)')).toBe('A bold and code and a link')
    expect(normalize('- item one\n- item two')).toBe('item one item two')
  })
  test('keeps snake_case identifiers', () => {
    expect(normalize('call my_func_name now')).toBe('call my_func_name now')
  })
  test('collapses whitespace', () => {
    expect(normalize('a \n  b\t\tc')).toBe('a b c')
  })
})

describe('locateAnchor', () => {
  test('finds the paragraph containing the selection', () => {
    const b = blocks({ m1: 'First paragraph.\n\nSecond paragraph here.' })
    expect(locateAnchor({ text: 'Second paragraph' }, b)).toEqual({ messageId: 'm1', paragraphIndex: 1 })
  })
  test('matches rendered text against markdown source', () => {
    const b = blocks({ m1: 'Use **bold** and `code` and [link](http://x).' })
    expect(locateAnchor({ text: 'Use bold and code and link.' }, b)).toEqual({ messageId: 'm1', paragraphIndex: 0 })
  })
  test('matches a selection that wraps across lines', () => {
    const b = blocks({ m1: 'Alpha.\n\nSecond paragraph here.' })
    expect(locateAnchor({ text: 'Second\nparagraph here.' }, b)).toEqual({ messageId: 'm1', paragraphIndex: 1 })
  })
  test('a selection spanning paragraphs anchors on the last one it touches', () => {
    const b = blocks({ m1: 'First paragraph.\n\nSecond paragraph.\n\nThird.' })
    expect(locateAnchor({ text: 'First paragraph.\n\nSecond paragraph' }, b)).toEqual({ messageId: 'm1', paragraphIndex: 1 })
  })
  test('anchors inside a code block on the block as one paragraph', () => {
    const b = blocks({ m1: 'Intro\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nOutro' })
    expect(locateAnchor({ text: 'const b = 2' }, b)).toEqual({ messageId: 'm1', paragraphIndex: 1 })
  })
  test('anchors inside a list', () => {
    const b = blocks({ m1: '- alpha item\n- beta item' })
    expect(locateAnchor({ text: 'beta item' }, b)).toEqual({ messageId: 'm1', paragraphIndex: 0 })
  })
  test('prefers the newest block', () => {
    const b = blocks({ m1: 'the same sentence', m2: 'the same sentence' })
    expect(locateAnchor({ text: 'same sentence' }, b)).toEqual({ messageId: 'm2', paragraphIndex: 0 })
  })
  test("prefers the selection's own row over newer blocks", () => {
    const b = blocks({ m1: 'the same sentence', m2: 'the same sentence' })
    expect(locateAnchor({ text: 'same sentence', requestId: 'm1' }, b)).toEqual({ messageId: 'm1', paragraphIndex: 0 })
  })
  test('returns undefined when nothing matches', () => {
    expect(locateAnchor({ text: 'absent' }, blocks({ m1: 'present' }))).toBeUndefined()
  })
  test('returns undefined for an empty selection', () => {
    expect(locateAnchor({ text: '  \n ' }, blocks({ m1: 'present' }))).toBeUndefined()
  })
  test('skips paragraphs that normalise to empty', () => {
    const b = blocks({ m1: 'Para A\n\n***\n\nPara B' })
    expect(locateAnchor({ text: 'Para A\n\nPara B' }, b)).toEqual({ messageId: 'm1', paragraphIndex: 2 })
  })
  test('an unknown requestId returns undefined', () => {
    const b = blocks({ m1: 'the same sentence', m2: 'the same sentence' })
    expect(locateAnchor({ text: 'same sentence', requestId: 'zzz' }, b)).toBeUndefined()
  })
  test('a selection whose own row misses does not fall back to older blocks', () => {
    const b = blocks({ m1: 'alpha sentence', m2: 'beta sentence' })
    expect(locateAnchor({ text: 'alpha sentence', requestId: 'm2' }, b)).toBeUndefined()
  })
  test('returns undefined for a selection of only stripped characters', () => {
    expect(locateAnchor({ text: '**' }, blocks({ m1: 'present' }))).toBeUndefined()
  })
})
