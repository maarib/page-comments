# page-comments

A Claude Code skill for giving visual feedback by pointing. It puts a comment mode on any web page: hover to outline an element, click to leave a note on it, and press **Send to Claude** to deliver your notes straight to your Claude Code session, where Claude shows them in chat and acts on them.

It works on any project and any site, because nothing is added to the project's code. It runs in Claude Code's built-in browser, and in Chrome, Arc or any other browser through a bookmark.

## Install

You need [Claude Code](https://claude.com/claude-code) and [Node.js](https://nodejs.org) 18 or later.

Clone this repo into your personal skills folder:

```bash
git clone https://github.com/maarib/page-comments.git ~/.claude/skills/page-comments
```

Start a new Claude Code session so it picks the skill up.

To use it in one project only, clone it into that project's `.claude/skills/` folder instead.

## Use

1. In Claude Code, say **"comment mode"** (or "let me leave comments on the page"). Claude starts listening and puts comment mode on the page you have open.
2. On the page:

   | Do this | To |
   |---|---|
   | **Shift+C** | Turn comment mode on or off. A thin yellow frame shows it is on |
   | Move the pointer | Outline the element under it |
   | **↑ / ↓** | Step out to the parent element, or back in |
   | Click | Write a note on the outlined element (**⌘↵** saves) |
   | Click a numbered pin | Read, change or delete that note |
   | Click the note count | List every note |
   | **Send to Claude** | Deliver the notes you have not sent yet |
   | **Esc** | Leave comment mode |

3. Claude lists the notes it received in chat, then works through them.

**To comment on something that only appears on hover** (a hover style, a tooltip, a menu): hover it first, then press Shift+C. The hover state freezes in place and can be clicked like anything else.

### Chrome, Arc and other browsers

The first time, ask Claude for comment mode and say which browser you are using. Claude opens a page with a **Comment mode** button: drag it to your bookmarks bar. After that, click the bookmark on any page to load comment mode. It only works while Claude is listening, so ask for comment mode first in each new session.

## Update

```bash
git -C ~/.claude/skills/page-comments pull
```

## How it works

- `scripts/comment-mode.js` runs in the page: the outline, the note box, the bar. Notes are kept in the page's `localStorage`, per site, until you clear them.
- `scripts/receiver.mjs` is a small listener Claude runs on your machine. The Send button posts your notes to it and it hands them to the session.
- `SKILL.md` is what Claude reads to know how to set all this up and what to do with the notes.

The listener accepts connections from your own machine only, and only with a private token that is created the first time you use the skill and kept in `.token`. That file and your bookmark page are ignored by git, so they are never shared.

## Limits

- **Canvas and WebGL** content (maps, canvas charts, games) is one element; things drawn inside it cannot be picked individually.
- **Iframes** from another site cannot be reached.
- **Locked-down sites** with a strict content security policy can block the bookmark or the Send button. Pasting `scripts/comment-mode.js` into the browser console still works there, with **Copy** in place of Send.
- **A page reload removes comment mode** (your notes are kept). Ask Claude to put it back, or click the bookmark again.
- Notes belong to one browser and one site. A different port or domain has its own.
