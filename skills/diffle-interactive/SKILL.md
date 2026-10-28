# Live review with diffle

Instructions for a coding agent that answers a diffle review while the human writes it: "review
this with me in diffle". You launch diffle for this repository, wait on its API for threads that
need you, answer each one in its thread, edit the working tree when a comment asks for a change,
and post your own open points as threads.

You answer the threads the human writes in diffle while they review. Every thread they open or
reply to is addressed to you. You stay in **this** session for the whole review; do not hand it to a
subagent.

Needs a diffle with `GET /api/threads/wait`. Check once with
`curl -s "<BASE>/api/threads/wait?timeout=1"`: a JSON array (`[]` or threads) is right.
`{"error": "API endpoint not found…"}` means an older diffle without the route: tell the user and
stop. An HTML page means a wrong URL, usually a doubled `/` (see Step 1).

## Step 1 — Get this repository's server

The repository under review is the one your session works in:
`git rev-parse --show-toplevel`. Never pick a server by port.

Ask the user what to review if it is not obvious. Your edits show up live only when the new side
is the worktree: `working` (the default), or a range ending in `worktree` such as
`main..worktree`. A branch or commit comparison is frozen, so say so if they want fixes.

Start it as a background process, keeping its log (`<log>`, a file in your scratch or temp directory) to
read the URL:

```
cd "<repo>" && NO_COLOR=1 diffle working --keep-alive > "<log>" 2>&1
```

`--keep-alive` keeps the server up when the browser tab closes. Then read the URL and pin it as
`<BASE>` for the rest of the session. diffle prints it with a trailing `/`; drop it, or every
`<BASE>/api/…` below becomes `//api/…` and returns the web app instead:

```
sed -n 's/.*diffle running at \(http[^ ]*\).*/\1/p' "<log>" | sed 's#/$##'
```

Confirm it serves your repository: `curl -s "<BASE>/api/snapshot"` must report `"root"` equal to
`<repo>`. If the user already runs diffle, ask them for its URL and run the same check.

## Step 2 — Wait for threads that need you

```
curl -s "<BASE>/api/threads/wait?timeout=540"
```

Give the command a timeout above 540 seconds, or your tool cuts the wait short.

It holds the request until at least one thread waits on you and returns those threads as a JSON
array: open, not stale, and the human wrote the last message. The server decides; there is no
cursor to keep. `[]` means the timeout passed: call it again at once, without ending your turn or
asking the user. Loop: wait → handle every returned thread (Step 3) → wait again.

## Step 3 — Answer each thread

A thread is `{ id, anchor, messages, … }`. `anchor` is either a line range
`{ kind: "line", path, side, startLine, endLine, quoted }` (`quoted` is the text it was written
against; `side: "old"` means removed lines) or `{ kind: "file", path }`. `messages` is the whole
conversation; your earlier ones carry `author: "agent"`. Read the code at the anchor first.

- **A question or remark** → answer it.
- **A change request** → make the change in the working tree with your normal edit tools, then
  reply with what you changed and where. Use judgment: if the change would be wrong or is not
  needed, reply explaining why instead of editing.

Reply once per thread, as the agent. Always send the text through a quoted heredoc into `jq`, never
inside shell quotes: a reply that quotes the diff can hold `'`, `$(…)` or backticks, and the shell
would break on or run them. The `'DIFFLE_END'` quotes keep the heredoc literal:

```
jq -n --rawfile body /dev/stdin '{body: ($body | rtrimstr("\n")), author: "agent"}' <<'DIFFLE_END' |
<reply text, any characters>
DIFFLE_END
  curl -s -X POST "<BASE>/api/threads/<id>/replies" -H 'Content-Type: application/json' -d @-
```

Never resolve a thread: the human resolves, or replies to hand it back.

## Your own points

To raise something yourself, such as an open item from a self-review, open a thread:

```
jq -n --rawfile body /dev/stdin --arg path 'src/a.ts' \
  '{path: $path, startLine: 12, endLine: 14, body: ($body | rtrimstr("\n")), author: "agent"}' <<'DIFFLE_END' |
<point text>
DIFFLE_END
  curl -s -X POST "<BASE>/api/threads" -H 'Content-Type: application/json' -d @-
```

Leave out `startLine`/`endLine` for a comment on the whole file; add `"side": "old"` for removed
lines. Such a thread reaches your wait only once the human replies to it. A `400` names what the
diff cannot place (a path not in the review, a line past the end); fix the anchor, do not retry
blindly.

## Ending

Stop when the user says they are done, then stop the background `diffle` you started. The
threads stay in `<git-dir>/diffle/`; reopening `diffle working` shows them again.

## Notes

- **Keep replies short.** A few sentences: what you found or changed, the file and line, done.
  No restating the question, no narrating your process.
- Bodies render as Markdown. A ` ```suggestion ` fence on a line thread shows as a code
  suggestion for the quoted lines.
- Never write `<git-dir>/diffle/comments.json` yourself; go through the API so the browser
  updates.
