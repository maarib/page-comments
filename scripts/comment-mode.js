// Comment mode: leave notes on any web page. Move the pointer and whatever is under it is
// outlined, as layers are in a design tool; click one to write a note on it. A thin yellow frame
// around the page shows the mode is on, and a bar along the bottom, in Claude's colors, holds the
// controls.
//
//   Shift+C   turn comment mode on or off. Because it is a key, not a click, whatever is hovered
//             at that moment keeps its hover state, so hover-only elements can be commented on.
//   ↑ / ↓     step out to the parent element, or back in
//   click     write a note on the outlined element
//   Esc       close the note or the list, or leave comment mode (Shift+C also leaves)
//
// Each note leaves a numbered pin on its element: click a pin to read, change or delete the note.
// The count at the left of the bar opens a list of every note.
//
// Notes are kept in the page's localStorage under "page-comments" and exposed on
// window.__pageComments: notes(), text(), clear(), on(), off(), listen(). Loading this file twice
// is safe.
//
// Sending: when a receiver is listening (scripts/receiver.mjs), set its address with
// window.__pageComments.listen('http://127.0.0.1:4747/?t=TOKEN') or define
// window.__pageCommentsEndpoint before loading. The bar then has a "Send to Claude" button that
// posts every note not yet sent.
;(() => {
  if (window.__pageComments) {
    if (window.__pageCommentsEndpoint) window.__pageComments.listen(window.__pageCommentsEndpoint)
    return window.__pageComments.ready()
  }

  const UI = 'data-page-comments'
  const PIN = 'pc-hover'
  const KEY = 'page-comments'
  // Marks on the page (frame, outline, pins) are yellow, to stand apart from any site's own colors.
  const YELLOW = '#ffd60a'
  const INK = '#17130f'
  // The controls (bar, note box, toast) wear Claude's colors: warm paper and ink with a clay
  // accent, light or dark with the system.
  const DARK = matchMedia('(prefers-color-scheme: dark)').matches
  const BG = DARK ? '#262624' : '#faf9f5'
  const FIELD = DARK ? '#30302e' : '#ffffff'
  const PAPER = DARK ? '#faf9f5' : '#141413'
  const MUTED = DARK ? '#b0aea5' : '#73726c'
  const LINE = DARK ? '#3d3d3a' : '#e3e0d5'
  const CLAY = '#d97757'
  const BAR_H = 52
  const FONT = 'font: 500 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: 0; text-transform: none;'
  const CARD = `${FONT} background: ${BG}; color: ${PAPER}; border: 1px solid ${LINE}; box-shadow: 0 8px 28px rgba(0,0,0,${DARK ? '.45' : '.14'}); box-sizing: border-box;`

  let active = false
  let target = null
  let stepped = [] // the chain stepped out of with ↑, so ↓ can step back in
  let editing = false
  let pinSheet = null
  let endpoint = window.__pageCommentsEndpoint || null

  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]')
    } catch {
      return []
    }
  }
  let notes = read()
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(notes))
    } catch {
      // Storage blocked: the notes last until the page reloads.
    }
  }

  const el = (tag, css, text = '') => {
    const node = document.createElement(tag)
    node.setAttribute(UI, '')
    node.style.cssText = css
    node.textContent = text
    return node
  }
  // The frame around the whole view: the sign that comment mode is on.
  const frame = el('div', `position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; border: 2px solid ${YELLOW}; box-shadow: inset 0 0 0 1px rgba(0,0,0,.18), inset 0 0 12px rgba(255,214,10,.14); display: none; box-sizing: border-box;`)
  const outline = el('div', `position: fixed; z-index: 2147483001; pointer-events: none; border: 2px solid ${YELLOW}; border-radius: 6px; background: rgba(255,214,10,.12); box-shadow: 0 0 0 1px rgba(0,0,0,.45); display: none; box-sizing: border-box;`)
  const tag = el('div', `${FONT} font-weight: 600; position: fixed; z-index: 2147483002; pointer-events: none; background: ${YELLOW}; color: ${INK}; padding: 2px 8px; border-radius: 6px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; display: none;`)
  // Edge to edge along the bottom, inside the frame.
  const bar = el('div', `${FONT} position: fixed; z-index: 2147483003; left: 0; right: 0; bottom: 0; height: ${BAR_H}px; display: none; align-items: center; gap: 14px; padding: 0 14px; background: ${BG}; color: ${PAPER}; border-top: 1px solid ${LINE}; box-shadow: 0 -6px 24px rgba(0,0,0,${DARK ? '.35' : '.08'}); box-sizing: border-box; white-space: nowrap; overflow: hidden;`)
  const box = el('div', `${CARD} position: fixed; z-index: 2147483004; width: 320px; max-width: calc(100vw - 24px); padding: 12px; border-radius: 16px; display: none;`)
  const pins = el('div', 'position: fixed; inset: 0; z-index: 2147483001; pointer-events: none; display: none;')
  // The size of the window, just above the bar's left end; it follows the window as it is resized.
  const size = el('div', `${FONT} font-weight: 600; font-variant-numeric: tabular-nums; position: fixed; z-index: 2147483003; left: 8px; bottom: ${BAR_H + 8}px; pointer-events: none; background: ${YELLOW}; color: ${INK}; padding: 2px 8px; border-radius: 6px; white-space: nowrap; display: none;`)
  const list = el('div', `${CARD} position: fixed; z-index: 2147483004; left: 8px; bottom: ${BAR_H + 38}px; width: 360px; max-width: calc(100vw - 24px); max-height: min(56vh, 460px); overflow-y: auto; padding: 6px; border-radius: 16px; display: none;`)
  const toast = el('div', `${CARD} position: fixed; z-index: 2147483005; left: 50%; bottom: 14px; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; display: none; white-space: nowrap; max-width: calc(100vw - 24px); overflow: hidden; text-overflow: ellipsis;`)

  const isOurs = (node) => node instanceof Element && !!node.closest(`[${UI}]`)

  // ── Describing an element ──

  function describe(e) {
    const name = e.getAttribute('aria-label') || e.title || e.getAttribute('alt') || e.getAttribute('placeholder') || ''
    const text = (e.textContent || '').replace(/\s+/g, ' ').trim()
    const label = name || (text.length > 48 ? `${text.slice(0, 48)}…` : text)
    const role = e.getAttribute('role')
    return `${e.tagName.toLowerCase()}${role ? `[${role}]` : ''}${label ? ` “${label}”` : ''}`
  }

  /** A short CSS path: ids, test ids and aria-labels where they exist, positions otherwise. */
  function pathTo(e) {
    const parts = []
    for (let n = e; n && n !== document.body && n !== document.documentElement && parts.length < 7; n = n.parentElement) {
      const t = n.tagName.toLowerCase()
      if (n.id && !/\d{3,}|:/.test(n.id)) {
        parts.unshift(`#${CSS.escape(n.id)}`)
        break
      }
      const testId = n.getAttribute('data-testid')
      const label = n.getAttribute('aria-label')
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []
      const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(n) + 1})` : ''
      parts.unshift(testId ? `${t}[data-testid="${testId}"]` : label ? `${t}[aria-label="${label.replace(/"/g, '\\"')}"]` : `${t}${nth}`)
    }
    return parts.join(' > ')
  }

  /** React components around the element, when the page is a React development build. */
  function component(e) {
    const key = Object.keys(e).find((k) => k.startsWith('__reactFiber$'))
    const names = []
    for (let f = key ? e[key] : null; f && names.length < 3; f = f.return) {
      const name = typeof f.type === 'function' ? f.type.displayName || f.type.name : null
      if (name && !names.includes(name)) names.push(name)
    }
    return names.join(' < ')
  }

  // ── Keeping hover states on screen ──

  /** Copies every `:hover` rule to a `.pc-hover` class, so a hover state can be held by adding the class. */
  function buildPinSheet() {
    if (pinSheet) return
    const out = []
    const walk = (rules, wrap) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          if (rule.selectorText.includes(':hover')) out.push(wrap(`${rule.selectorText.replaceAll(':hover', `.${PIN}`)} { ${rule.style.cssText} }`))
          if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, wrap) // nested rules
        } else if (rule instanceof CSSMediaRule) {
          // `@media (hover: hover)` wraps hover styles in some frameworks; drop it, keep other media.
          const media = rule.conditionText || rule.media.mediaText
          walk(rule.cssRules, /\bhover\b/.test(media) ? wrap : (css) => wrap(`@media ${media} { ${css} }`))
        } else if (rule.cssRules) walk(rule.cssRules, wrap)
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules, (css) => css)
      } catch {
        // A stylesheet from another site can't be read.
      }
    }
    pinSheet = document.createElement('style')
    pinSheet.setAttribute(UI, '')
    pinSheet.textContent = out.join('\n')
    document.head.append(pinSheet)
  }
  function pinHover() {
    buildPinSheet()
    for (const e of document.querySelectorAll(':hover')) e.classList.add(PIN)
  }
  function unpinHover() {
    for (const e of document.querySelectorAll(`.${PIN}`)) e.classList.remove(PIN)
    if (pinSheet) pinSheet.remove()
    pinSheet = null
  }

  // ── Outline and pins ──

  function show(e) {
    target = e
    if (!e) {
      outline.style.display = tag.style.display = 'none'
      return
    }
    const r = e.getBoundingClientRect()
    Object.assign(outline.style, { display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` })
    tag.textContent = describe(e)
    Object.assign(tag.style, { display: 'block', left: `${Math.max(8, r.left - 2)}px`, top: `${r.top > 34 ? r.top - 26 : Math.min(innerHeight - BAR_H - 26, r.bottom + 6)}px` })
    // Near the bottom-left corner the element's label would sit on the window-size label: move it beside it.
    const a = tag.getBoundingClientRect()
    const b = size.getBoundingClientRect()
    if (b.width && a.left < b.right + 4 && a.bottom > b.top - 2 && a.top < b.bottom + 2) tag.style.left = `${b.right + 6}px`
  }

  const page = () => location.pathname + location.hash
  function drawPins() {
    pins.replaceChildren()
    for (const n of notes.filter((x) => x.page === page())) {
      // A note whose element isn't on screen in this layout has no pin; it is still in the list.
      const found = elementOf(n)
      if (!found) continue
      const r = found.getBoundingClientRect()
      if (!r.width && !r.height) continue
      const pin = el('button', `${FONT} font-weight: 700; position: fixed; left: ${r.x + r.width - 10}px; top: ${r.y - 10}px; min-width: 20px; height: 20px; padding: 0 5px; margin: 0; border: 0; border-radius: 999px; background: ${YELLOW}; color: ${INK}; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 1.5px ${INK}, 0 2px 6px rgba(0,0,0,.4); box-sizing: border-box; pointer-events: auto; cursor: pointer;`, String(n.id))
      pin.type = 'button'
      pin.title = n.comment
      pin.onclick = () => openNote(n)
      pins.append(pin)
    }
  }

  /** The element a note was left on, if it is still on the page. */
  function elementOf(n) {
    try {
      return document.querySelector(n.selector)
    } catch {
      return null // a selector that no longer parses
    }
  }

  /** Opens a saved note to read, change or delete. */
  function openNote(n) {
    list.style.display = 'none'
    const e = elementOf(n)
    if (e) {
      e.scrollIntoView({ block: 'nearest' })
      show(e)
    }
    openBox(e, n)
  }

  // ── Notes ──

  function asText() {
    return notes
      .map((n) => `${n.id}. [${n.page}] ${n.element}${n.hovered ? ' (hover state)' : ''}${n.component ? ` in ${n.component}` : ''}\n   ${n.comment}\n   at ${n.selector} · ${n.viewport.width}×${n.viewport.height} · ${n.theme}`)
      .join('\n\n')
  }

  /** `kind`: 'primary' (clay), 'ghost' (outlined) or 'quiet' (text only). */
  function button(label, onClick, kind = 'ghost') {
    const look = kind === 'primary' ? `background: ${CLAY}; color: #fff; border: 1px solid ${CLAY}; font-weight: 600;` : kind === 'ghost' ? `background: ${FIELD}; color: ${PAPER}; border: 1px solid ${LINE};` : `background: transparent; color: ${MUTED}; border: 1px solid transparent;`
    const b = el('button', `${FONT} ${look} cursor: pointer; border-radius: 10px; height: 32px; padding: 0 12px; margin: 0; flex-shrink: 0;`, label)
    b.type = 'button'
    b.onclick = onClick
    return b
  }
  const key = (k) => el('kbd', `${FONT} font-size: 11px; display: inline-block; min-width: 18px; padding: 1px 5px; margin-right: 5px; border-radius: 6px; border: 1px solid ${LINE}; background: ${FIELD}; color: ${PAPER}; text-align: center;`, k)
  const hint = (keys, label) => {
    const h = el('span', `color: ${MUTED}; display: inline-flex; align-items: center; flex-shrink: 0;`)
    h.append(...keys.map(key), el('span', '', label))
    return h
  }

  /** A speech bubble: stands for "notes" beside the count. */
  const COMMENT_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 4.5h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3.5v-3.5h-1a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/></svg>'
  const icon = (svg) => {
    const span = el('span', 'display: inline-flex; align-items: center;')
    span.innerHTML = svg
    return span
  }

  /**
   * Clear deletes every note in one click; the message that follows offers to undo it. Hovering
   * underlines it and shows a question mark, which always has its space so nothing beside it moves.
   */
  function clearButton() {
    const b = button('Clear', () => {
      const deleted = notes
      notes = []
      save()
      box.style.display = 'none'
      editing = false
      list.style.display = 'none'
      renderBar()
      drawPins()
      flash(`${deleted.length === 1 ? 'Note' : `All ${deleted.length} notes`} deleted`, 7000, {
        label: 'Undo',
        run: () => {
          notes = deleted
          save()
          renderBar()
          drawPins()
          flash(`${deleted.length === 1 ? 'Note' : 'Notes'} restored`)
        },
      })
    }, 'quiet')
    const mark = el('span', 'visibility: hidden;', '?')
    b.append(mark)
    b.style.textUnderlineOffset = '3px'
    b.onmouseenter = () => {
      mark.style.visibility = 'visible'
      b.style.textDecoration = 'underline'
    }
    b.onmouseleave = () => {
      mark.style.visibility = 'hidden'
      b.style.textDecoration = 'none'
    }
    return b
  }

  function renderBar() {
    const here = notes.filter((n) => n.page === page()).length
    const unsent = notes.filter((n) => !n.sent).length
    const wide = innerWidth >= 900
    // Narrow windows (a phone-sized pane): tighter spacing, shorter labels, and Copy gives way first.
    const narrow = innerWidth < 560
    Object.assign(bar.style, { gap: narrow ? '6px' : '14px', padding: narrow ? '0 8px' : '0 14px' })
    const count = el('button', `${FONT} display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; height: 36px; padding: 0 10px 0 6px; margin: 0 0 0 -6px; border: 0; border-radius: 10px; background: ${list.style.display === 'block' ? FIELD : 'transparent'}; color: ${PAPER}; cursor: ${notes.length ? 'pointer' : 'default'};`)
    count.type = 'button'
    count.title = notes.length ? 'Show all notes' : 'No notes yet'
    count.setAttribute('aria-label', `${notes.length} note${notes.length === 1 ? '' : 's'}${notes.length ? ': show all' : ''}`)
    count.onclick = () => notes.length && toggleList()
    count.append(
      el('span', `font-weight: 600; background: ${notes.length ? CLAY : FIELD}; color: ${notes.length ? '#fff' : MUTED}; border: 1px solid ${notes.length ? CLAY : LINE}; min-width: 24px; height: 24px; padding: 0 7px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;`, String(notes.length)),
      icon(COMMENT_ICON),
      ...(notes.length && wide ? [el('span', `color: ${MUTED};`, `${here} on this page`)] : []),
      ...(notes.length ? [el('span', `color: ${MUTED}; font-size: 10px;`, list.style.display === 'block' ? '▼' : '▲')] : []),
    )
    const hints = el('span', `display: ${wide ? 'inline-flex' : 'none'}; align-items: center; gap: 16px; min-width: 0; overflow: hidden;`)
    if (wide) hints.append(hint(['Click'], 'comment'), hint(['↑', '↓'], 'layer'))
    const actions = el('span', `display: inline-flex; align-items: center; gap: ${narrow ? 6 : 8}px; margin-left: auto; min-width: 0;`)
    if (notes.length) {
      actions.append(
        clearButton(),
        ...(innerWidth < 380 ? [] : [button('Copy', () => navigator.clipboard.writeText(asText()).then(() => flash('Notes copied'), () => flash('Could not copy here. Use Send to Claude, or ask Claude to read your notes.', 4000)))]),
      )
    }
    const sendLabel = narrow ? 'Send' : 'Send to Claude'
    if (endpoint) actions.append(button(unsent ? `${sendLabel} · ${unsent}` : notes.length ? 'Sent ✓' : sendLabel, send, unsent ? 'primary' : 'ghost'))
    bar.replaceChildren(count, hints, actions)
  }

  /** Posts the notes not yet sent to the receiver, which hands them to Claude. */
  async function send() {
    const batch = notes.filter((n) => !n.sent)
    if (!endpoint || !batch.length) return
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(batch) })
      if (!res.ok) throw new Error(String(res.status))
      for (const n of batch) n.sent = true
      save()
      renderBar()
      flash(`Sent ${batch.length} note${batch.length === 1 ? '' : 's'} to Claude`)
    } catch {
      flash('Claude is not listening right now. Your notes are saved; send again in a moment, or tell Claude in chat.', 5000)
    }
  }

  let toastTimer
  /** A short message above the bar; `action` adds a button to it ({ label, run }). */
  function flash(message, ms = 2200, action) {
    toast.replaceChildren(el('span', '', message))
    if (action) {
      const b = button(action.label, () => {
        clearTimeout(toastTimer)
        toast.style.display = 'none'
        action.run()
      }, 'ghost')
      b.style.height = '26px'
      b.style.marginLeft = '12px'
      toast.append(b)
    }
    Object.assign(toast.style, { display: 'flex', alignItems: 'center', bottom: `${(active ? BAR_H : 0) + 14}px`, padding: action ? '5px 6px 5px 14px' : '8px 14px' })
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.style.display = 'none'), ms)
  }

  /** Every note, newest last: click one to open it. Notes from other pages say where they are. */
  function toggleList(open = list.style.display !== 'block') {
    list.style.display = open && notes.length ? 'block' : 'none'
    if (open) {
      list.replaceChildren(
        ...notes.map((n) => {
          const here = n.page === page()
          const row = el('button', `${FONT} display: flex; gap: 10px; align-items: flex-start; width: 100%; padding: 8px; margin: 0; border: 0; border-radius: 10px; background: transparent; color: ${PAPER}; text-align: left; cursor: ${here ? 'pointer' : 'default'};`)
          row.type = 'button'
          row.onmouseenter = () => (row.style.background = FIELD)
          row.onmouseleave = () => (row.style.background = 'transparent')
          const body = el('span', 'min-width: 0; flex: 1; display: block;')
          body.append(
            el('span', 'display: block; font-weight: 400; white-space: pre-wrap; overflow-wrap: anywhere;', n.comment),
            el('span', `display: block; margin-top: 2px; color: ${MUTED}; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`, `${here ? '' : `on ${n.page} · `}${n.element}${n.hovered ? ' · hover state' : ''}${n.sent ? ' · sent' : ''}`),
          )
          row.append(el('span', `font-weight: 700; flex-shrink: 0; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: ${YELLOW}; color: ${INK}; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;`, String(n.id)), body)
          row.onclick = () => (here ? openNote(n) : flash(`That note is on ${n.page}. Open that page to see it.`, 3000))
          return row
        }),
      )
    }
    renderBar()
  }

  /** The note box: a new note on element `e`, or the saved note `existing` (whose element may be gone). */
  function openBox(e, existing) {
    editing = true
    const r = e ? e.getBoundingClientRect() : existing.rect
    const hovered = existing ? existing.hovered : e.matches(`.${PIN}, .${PIN} *`)
    const area = el('textarea', `${FONT} font-weight: 400; display: block; width: 100%; min-height: 76px; margin: 8px 0; padding: 8px 10px; border-radius: 10px; border: 1px solid ${LINE}; background: ${FIELD}; color: ${PAPER}; resize: vertical; outline: none; box-sizing: border-box;`)
    area.placeholder = 'What should change here?'
    if (existing) area.value = existing.comment
    const close = () => {
      editing = false
      box.style.display = 'none'
    }
    const refresh = () => {
      save()
      renderBar()
      drawPins()
      if (list.style.display === 'block') toggleList(true)
    }
    const commit = () => {
      const comment = area.value.trim()
      if (existing) {
        if (comment && comment !== existing.comment) {
          existing.comment = comment
          existing.sent = false // a changed note goes to Claude again
          refresh()
        }
      } else if (comment) {
        notes.push({
          id: (notes.length ? notes[notes.length - 1].id : 0) + 1,
          page: page(),
          url: location.href,
          selector: pathTo(e),
          element: describe(e),
          component: component(e),
          text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
          comment,
          rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          viewport: { width: innerWidth, height: innerHeight },
          theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
          hovered,
          at: new Date().toISOString(),
        })
        refresh()
      }
      close()
    }
    area.onkeydown = (ev) => {
      ev.stopPropagation()
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) commit()
      if (ev.key === 'Escape') close()
    }
    const row = el('div', 'display: flex; gap: 8px; justify-content: flex-end; align-items: center;')
    if (existing)
      row.append(
        button('Delete', () => {
          notes = notes.filter((n) => n !== existing)
          refresh()
          close()
        }, 'quiet'),
      )
    row.append(el('span', 'margin-right: auto;'), button('Cancel', close, 'quiet'), button(existing ? 'Save' : 'Save note', commit, 'primary'))
    const title = el('div', `color: ${MUTED}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`, existing ? `Note ${existing.id} · ${existing.element}` : describe(e))
    box.replaceChildren(title, area, row)
    const left = Math.min(Math.max(12, r.x), Math.max(12, innerWidth - 332))
    const bottomEdge = r.y + r.height
    const below = bottomEdge + 190 < innerHeight - BAR_H
    Object.assign(box.style, { display: 'block', left: `${left}px`, top: below ? `${bottomEdge + 10}px` : '', bottom: below ? '' : `${Math.max(BAR_H + 12, Math.min(innerHeight - 200, innerHeight - r.y + 10))}px` })
    area.focus()
    if (existing) area.setSelectionRange(area.value.length, area.value.length)
  }

  // ── Mode ──

  /** While the mode is on, the page never hears the pointer: nothing opens, closes or navigates. */
  const SWALLOWED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mousemove', 'pointermove', 'touchstart', 'touchend']

  function onPointer(ev) {
    if (isOurs(ev.target)) return
    ev.stopImmediatePropagation()
    if (['click', 'mousedown', 'pointerdown', 'auxclick', 'contextmenu'].includes(ev.type)) ev.preventDefault()
    if (editing) return
    if (ev.type === 'mousemove' || ev.type === 'pointermove') {
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => !isOurs(n)) || null
      if (under !== target && !stepped.includes(under)) {
        stepped = []
        show(under)
      }
    } else if (ev.type === 'click' && list.style.display === 'block') toggleList(false)
    else if (ev.type === 'click' && target) openBox(target)
  }

  function onKey(ev) {
    const t = ev.target
    const typing = t instanceof HTMLElement && !isOurs(t) && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    if (ev.code === 'KeyC' && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !typing && !editing) {
      ev.preventDefault()
      ev.stopImmediatePropagation()
      return toggle(!active)
    }
    if (!active || editing) return
    if (ev.key === 'Escape') {
      ev.stopImmediatePropagation()
      if (list.style.display === 'block') return toggleList(false)
      toggle(false)
    } else if (ev.key === 'ArrowUp' && target && target.parentElement && target.parentElement !== document.documentElement) {
      ev.preventDefault()
      ev.stopImmediatePropagation()
      stepped.push(target)
      show(target.parentElement)
    } else if (ev.key === 'ArrowDown' && stepped.length) {
      ev.preventDefault()
      ev.stopImmediatePropagation()
      show(stepped.pop())
    }
  }

  const reposition = () => {
    if (target && !editing) show(target)
    drawPins()
  }
  const showSize = () => (size.textContent = `${innerWidth} × ${innerHeight}`)
  const onResize = () => {
    showSize()
    renderBar()
    reposition()
  }

  function toggle(on) {
    if (on === active) return
    active = on
    editing = false
    stepped = []
    box.style.display = 'none'
    list.style.display = 'none'
    toast.style.display = 'none'
    frame.style.display = on ? 'block' : 'none'
    bar.style.display = on ? 'flex' : 'none'
    size.style.display = on ? 'block' : 'none'
    pins.style.display = on ? 'block' : 'none'
    document.documentElement.style.cursor = on ? 'crosshair' : ''
    for (const type of SWALLOWED) (on ? window.addEventListener : window.removeEventListener).call(window, type, onPointer, true)
    if (on) {
      notes = read()
      pinHover()
      const hovered = [...document.querySelectorAll(':hover')].filter((n) => !isOurs(n))
      show(hovered.length > 2 ? hovered[hovered.length - 1] : null)
      showSize()
      renderBar()
      drawPins()
      window.addEventListener('scroll', reposition, true)
      window.addEventListener('resize', onResize)
    } else {
      unpinHover()
      show(null)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', onResize)
    }
  }

  window.addEventListener('keydown', onKey, true)
  document.body.append(frame, outline, tag, pins, bar, size, list, box, toast)

  window.__pageComments = {
    notes: () => read(),
    text: () => asText(),
    clear: () => {
      notes = []
      save()
      if (active) {
        renderBar()
        drawPins()
      }
    },
    listen: (url) => {
      endpoint = url || null
      if (active) renderBar()
      return endpoint ? 'sending is on' : 'sending is off'
    },
    on: () => toggle(true),
    off: () => toggle(false),
    ready: () => {
      flash('Comment mode ready · press Shift+C', 4000)
      return `ready: ${read().length} note(s) stored for this site`
    },
  }
  return window.__pageComments.ready()
})()
