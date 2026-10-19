// Reprodução 4 — Ctrl+R: reverse-i-search NATIVO do readline via PTY headless.
// Uso: node repro4.cjs   — grava em repro-dump4.log (o Claude lê).
const pty = require('node-pty')
const path = require('path')
const fs = require('fs')

const userData = path.join(process.env.APPDATA, 'aurora-terminal')
const HELP = (userData + '\\aurora-help.ansi').replace(/\\/g, '/')
const LOG = path.join(__dirname, 'repro-dump4.log')
fs.writeFileSync(LOG, `=== repro4 @ ${new Date().toISOString()} ===\n`, 'utf8')
const log = (m) => fs.appendFileSync(LOG, m + '\n', 'utf8')

const proc = pty.spawn('C:\\Program Files\\Git\\bin\\bash.exe', ['--login', '-i'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: process.env.USERPROFILE,
  env: {
    ...process.env,
    MSYSTEM: 'MINGW64',
    TERM: 'xterm-256color',
    HISTFILE: 'C:/Users/balen/.aurora_history',
    HISTSIZE: '2000',
    HISTFILESIZE: '2000',
    HISTCONTROL: 'ignoreboth',
    AURORA_HELP_ANSI: HELP,
    PROMPT_COMMAND: 'history -a; history -n'
  }
})

let n = 0
proc.onData((d) => {
  n++
  log('OUT#' + n + ' ' + JSON.stringify(d).slice(0, 300))
})
proc.onExit(({ exitCode }) => {
  log(`EXIT ${exitCode}`)
  process.exit(0)
})

const step = (t, mark, bytes) =>
  setTimeout(() => {
    log(`\n== ${mark} ==`)
    if (bytes) proc.write(bytes)
  }, t)

step(2000, 'digita pwd (histórico fresco e identificável)', 'pwd\r')
step(3600, 'REQ 1: CTRL+R entra na busca (reverse-i-search)', '\u0012')
step(4900, 'REQ 2: digita "pw" na busca — mostra o mais recente', 'pw')
step(6900, 'REQ 4: ESC sai da busca', '\u001b')
step(8900, 'REQ 3: CTRL+R + "pw" + ENTER executa o achado', '\u0012pw\r')
step(12000, 'FIM', null)
setTimeout(() => {
  log('FIM — kill')
  proc.kill()
  process.exit(0)
}, 12200)
