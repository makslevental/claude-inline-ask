# inline-ask

A Claude Code mod. Highlight text in one of Claude's earlier replies, type `/ask <question>`, and the
question and answer appear as an indented thread directly under the paragraph you highlighted, instead
of at the bottom of the conversation.

`/ask` sends a normal turn: same conversation, same model, full context, recorded in history. Only where
it is drawn changes. `ctrl+o` shows the transcript as it really is.

## Example

You ask for three short paragraphs about pulsars. The second one mentions "LGM-1" and you want to know
what that is. Select the sentence, type `/ask what does this mean`, and press Enter (the drawing below is a text
sketch of the result):

```text
❯ in three short paragraphs tell me about pulsars

● Pulsars are rapidly rotating neutron stars, the collapsed cores left behind when massive stars
  explode as supernovae. They pack more than a sun's worth of mass into a sphere only about 20
  kilometers across.

  The first pulsar was found in 1967 by Jocelyn Bell Burnell. The signal was so regular that it was
  briefly nicknamed "LGM-1," for "little green men."

  ▎ what does this mean
  ▎ It means the signal was so precise and regular that the researchers half-seriously wondered
  ▎ whether it could come from an intelligent source, such as an alien civilization. "LGM" stands
  ▎ for "little green men," a popular way of referring to imagined extraterrestrials.

    ▎ why a joke and not a real hypothesis?
    ▎ Because they quickly found more pulsars in other parts of the sky, which made an alien
    ▎ explanation very unlikely.

  Millisecond pulsars keep time so precisely that they rival atomic clocks, which makes them useful
  for testing general relativity and detecting gravitational waves.
```

The thread sits right under the paragraph you selected from, not at the bottom. The second thread is a
follow-up on the first answer: it is indented one level deeper. The conversation itself is normal;
Claude answered in context and later turns can refer back to it.

## Requirements

* Claude Code 2.1.287 or later (mods).
* Fullscreen rendering (`/fullscreen`), because the mod reads Claude Code's own transcript selection.

## Install

From inside Claude Code in a terminal, install it from this repository:

```text
/plugin install inline-ask --marketplace makslevental/claude-inline-ask
```

Answer `y` to add the marketplace, then pick a scope. With the user scope the mod loads in every later
session; it is active in the current one straight away. This command works in a terminal session, not
in the desktop app's Code tab.

To try it for one session without installing, clone the repository and point Claude Code at it:

```sh
git clone git@github.com:makslevental/claude-inline-ask.git
claude --plugin-dir ./claude-inline-ask
```

Then switch to fullscreen with `/fullscreen` if you are not already in it, and see **Use** below.

## Updating

If you installed it with `/plugin install`, a copy was made at install time, so new versions do not
arrive by themselves. To update:

```sh
claude plugin update inline-ask
```

then run `/reload-plugins` in any session that is already open (a new session picks it up on its own).
Reloading resets the mod's memory, so threads already on screen fall back to the bottom of the
transcript (see Limitations).

If you cloned the repository and run it with `--plugin-dir`, `git pull` is enough: Claude Code reloads
the mod when its files change.

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
