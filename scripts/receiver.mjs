#!/usr/bin/env node
// The bridge between comment mode on a web page and the Claude session.
//
//   node receiver.mjs [port]      Wait for the user to press "Send to Claude", print the notes
//                                 and exit. Run it in the background: when it exits, the session
//                                 is handed its output, so the notes arrive without the user
//                                 saying anything. Start it again to wait for the next batch.
//   node receiver.mjs --setup [port]
//                                 Print the address comment mode should send to, and write
//                                 bookmarklet.html (a button to drag to the bookmarks bar, for
//                                 Chrome, Arc and other browsers). Exits straight away.
//
// While it waits it also serves comment-mode.js with the address already set, which is what the
// bookmarklet loads. It listens on 127.0.0.1 only and wants a token in every address, so only a
// page the user (or Claude) put comment mode on can reach it. The token is made once and kept in
// `.token` beside the skill, so the bookmarklet keeps working from one session to the next.

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const skill = join(here, '..')
const args = process.argv.slice(2)
const setup = args.includes('--setup')
const port = args.find((a) => /^\d+$/.test(a)) ?? '4747'

const tokenFile = join(skill, '.token')
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(12).toString('hex'), { mode: 0o600 })
const token = readFileSync(tokenFile, 'utf8').trim()
const origin = `http://127.0.0.1:${port}`
const endpoint = `${origin}/?t=${token}`

if (setup) {
  const bookmarklet = `javascript:(()=>{const s=document.createElement('script');s.src='${origin}/comment-mode.js?t=${token}&v='+Date.now();s.onerror=()=>alert('Claude is not listening yet. Ask Claude to start comment mode, then click this again.');document.head.append(s)})()`
  const page = join(skill, 'bookmarklet.html')
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><title>Comment mode bookmarklet</title>
<body style="font: 16px/1.5 system-ui, sans-serif; max-width: 560px; margin: 12vh auto; padding: 0 20px; color: #17130f; background: #f6efe6">
<h1 style="font-size: 26px; margin: 0 0 8px">Comment mode</h1>
<p>Drag this button to your bookmarks bar. Then, on any page, click it to load comment mode and press <b>Shift+C</b>.</p>
<p><a href="${bookmarklet.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="display: inline-block; padding: 10px 18px; border-radius: 10px; background: #ffd60a; color: #17130f; font-weight: 700; text-decoration: none; border: 2px solid #17130f">Comment mode</a></p>
<p style="color: #6f625a; font-size: 14px">It only works while Claude is listening: ask Claude for comment mode first. If the bookmarks bar is hidden, show it with ⌘⇧B.</p>
`,
  )
  console.log(`endpoint: ${endpoint}`)
  console.log(`bookmarklet page: ${page}`)
  process.exit(0)
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  // Lets a page served over https talk to this machine (Chrome's private network check).
  'access-control-allow-private-network': 'true',
}

const server = createServer((req, res) => {
  const url = new URL(req.url, origin)
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()
  if (url.searchParams.get('t') !== token) return res.writeHead(403, CORS).end()

  if (req.method === 'GET' && url.pathname === '/comment-mode.js') {
    // For the bookmarklet: comment mode with the address to send to already set.
    const script = readFileSync(join(here, 'comment-mode.js'), 'utf8')
    return res.writeHead(200, { ...CORS, 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(`window.__pageCommentsEndpoint = ${JSON.stringify(endpoint)};\n${script}\n;window.__pageComments.on();`)
  }
  if (req.method === 'GET') return res.writeHead(200, CORS).end('listening')
  if (req.method !== 'POST') return res.writeHead(405, CORS).end()

  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 2_000_000) req.destroy()
  })
  req.on('end', () => {
    let notes
    try {
      notes = JSON.parse(body)
    } catch {
      return res.writeHead(400, CORS).end()
    }
    if (!Array.isArray(notes) || !notes.length) return res.writeHead(400, CORS).end()
    res.writeHead(200, CORS).end('received')
    console.log(`PAGE COMMENTS: ${notes.length} note(s) received from comment mode. Handle them as the page-comments skill describes (show them in chat, then act).\n`)
    console.log(JSON.stringify(notes, null, 2))
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500)
  })
})

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is in use: a receiver may already be running, or pick another port.` : String(e))
  process.exit(1)
})
server.listen(Number(port), '127.0.0.1')

setTimeout(() => {
  console.log('PAGE COMMENTS: nothing was sent. Start the receiver again if the user is still commenting.')
  process.exit(0)
}, 110 * 60_000)
