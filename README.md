# inline-ask

A Claude Code mod. Highlight text in one of Claude's earlier replies, type `/ask <question>`, and the
question and answer appear as an indented thread directly under the paragraph you highlighted, instead
of at the bottom of the conversation.

`/ask` sends a normal turn: same conversation, same model, full context, recorded in history. Only where
it is drawn changes. `ctrl+o` shows the transcript as it really is.

## Requirements

* Claude Code 2.1.287 or later (mods).
* Fullscreen rendering (`/fullscreen`), because the mod reads Claude Code's own transcript selection.

## Install

Try it for one session:

```sh
claude --plugin-dir /path/to/claude-inline-ask
```

## Use

1. Select text in one of Claude's replies with the mouse.
2. Type `/ask what do you mean by this?` and press Enter. The highlight disappears as you type; the
   mod still sees it.
3. The question appears under the paragraph you selected from, and the answer streams in beneath it.
   Tool calls the answer makes are summarised as `⎿ N tool calls`. Press Escape to interrupt; the thread
   shows `(interrupted)` and keeps the partial answer.
4. To follow up on an answer, select text inside the thread and `/ask` again. The follow-up appears
   below the answer you selected from, indented one level deeper.

Nothing selected, or no question, shows a short toast and sends nothing.

## Limitations

* Claude Code draws its own `› Prompt from the inline-ask plugin` block at the bottom for any prompt a
  plugin submits. The mod cannot hide it.
* A thread goes after the whole paragraph, list or code block that contains the selection, not at the
  exact spot.
* After `/resume`, or after the mod reloads, existing threads are shown where they really are, at the
  bottom.
* Not available in non-fullscreen mode or `claude -p`.

## Develop

```sh
claude --plugin-dir .          # hot reloads on save; also writes the API types to .claude-plugin/types/
claude plugin validate .
claude plugin test .
```

`tsconfig.json` extends the generated types, so run the first command once before type-checking
(`npx tsc -p .`).

Layout: `hooks/anchor.ts` (finds the paragraph holding the selection), `hooks/threads.ts` (thread state and
the prompt format), `hooks/view.tsx` (render trees), `hooks/register.tsx` (the hooks), `tests/`.
