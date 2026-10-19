// Reprodução headless da sessão /help do Aurora Terminal.
// Uso: node repro.cjs  — grava todos os bytes emitidos pelo bash em repro-dump.log
const pty = require('node-pty')
const path = require('path')
const fs = require('fs')

const userData = path.join(process.env.APPDATA, 'aurora-terminal')
const LOG = path.join(__dirname, 'repro-dump.log')
fs.writeFileSync(LOG, `=== repro @ ${new Date().toISOString()} ===\n`, 'utf8')
const log = (m) => fs.appendFileSync(LOG, m + '\n', 'utf8')

const env = {
  ...process.env,
  MSYSTEM: 'MINGW64',
  TERM: 'xterm-256color',
  HISTFILE: 'C:/Users/balen/.aurora_history',
  HISTSIZE: '2000',
  HISTFILESIZE: '2000',
  HISTCONTROL: 'ignoreboth',
  AURORA_INIT: (userData + '\\aurora-init.sh').replace(/\\/g, '/'),
  AURORA_HELP_ANSI: (userData + '\\aurora-help.ansi').replace(/\\/g, '/'),
  PROMPT_COMMAND: 'history -a; history -n; . "$AURORA_INIT" 2>/dev/null; true'
}

const proc = pty.spawn('C:\\Program Files\\Git\\bin\\bash.exe', ['--login', '-i'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: process.env.USERPROFILE,
  env
})

let n = 0
proc.onData((d) => {
  n++
  log('OUT#' + n + ' ' + JSON.stringify(d)) // bytes crus, sem cortes
})
proc.onExit(({ exitCode, signal }) => {
  log(`EXIT code=${exitCode} signal=${signal}`)
  process.exit(0)
})

const step = (t, mark, bytes) =>
  setTimeout(() => {
    log(`\n== ${mark} ==`)
    if (bytes) proc.write(bytes)
  }, t)

step(1500, 'digita /help + Enter', '/help\r')
step(3400, 'digita ls + Enter', 'ls\r')
step(5200, 'digita /help + Enter (2a vez)', '/help\r')
step(7000, 'SETA-CIMA', '\u001b[A')
step(7700, 'SETA-CIMA de novo', '\u001b[A')
step(8400, 'SETA-BAIXO', '\u001b[B')
step(9200, 'digita ls + Enter', 'ls\r')
setTimeout(() => {
  log('\n== FIM — encerrando ==')
  proc.kill()
  process.exit(0)
}, 11000)
