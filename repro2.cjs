// Reprodução 2 — diagnóstico do carregamento do /help no bash (Git Bash)
// Uso:
//   node repro2.cjs pc    → testa PROMPT_COMMAND (com marcadores visíveis)
//   node repro2.cjs func  → testa export de função via ambiente (BASH_FUNC_x%%)
// Grava tudo em repro-dump2.log — o Claude lê e decide.
const pty = require('node-pty')
const path = require('path')
const fs = require('fs')

const mode = process.argv[2] ?? 'pc'
const userData = path.join(process.env.APPDATA, 'aurora-terminal')
const LOG = path.join(__dirname, 'repro-dump2.log')
fs.writeFileSync(LOG, `=== repro2 @ ${new Date().toISOString()} mode=${mode} ===\n`, 'utf8')
const log = (m) => fs.appendFileSync(LOG, m + '\n', 'utf8')

const posix = (p) => p.replace(/\\/g, '/')
const INIT = posix(path.join(userData, 'aurora-init.sh'))
const HELP = posix(path.join(userData, 'aurora-help.ansi'))

const env = {
  ...process.env,
  MSYSTEM: 'MINGW64',
  TERM: 'xterm-256color',
  HISTFILE: 'C:/Users/balen/.aurora_history',
  HISTSIZE: '2000',
  HISTFILESIZE: '2000',
  HISTCONTROL: 'ignoreboth',
  AURORA_INIT: INIT,
  AURORA_HELP_ANSI: HELP
}

if (mode === 'pc') {
  // Tudo visível: nada de 2>/dev/null. Se o sourcing falhar, a mensagem
  // de erro do bash aparece no dump e a gente vê o porquê na hora.
  env.PROMPT_COMMAND =
    'echo [PC_RAN]; echo [AURORA_INIT=]$AURORA_INIT; . "$AURORA_INIT"; echo [RC=$?]'
} else {
  // Pós-Shellshock, o bash importa funções de variáveis de ambiente
  // chamadas BASH_FUNC_<nome>%% — definição ANTES do primeiro prompt,
  // imune a qualquer coisa que aconteça com PROMPT_COMMAND.
  env['BASH_FUNC_command_not_found_handle%%'] =
    `() { case "$1" in /help) cat -- "$AURORA_HELP_ANSI" 2>/dev/null; return 0;; *) printf 'bash: %s: comando nao encontrado\\n' "$1" >&2; return 127;; esac; }`
  env.PROMPT_COMMAND = 'history -a; history -n'
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
  log('OUT#' + n + ' ' + JSON.stringify(d).slice(0, 400))
})
proc.onExit(({ exitCode }) => {
  log(`EXIT code=${exitCode}`)
  process.exit(0)
})

const step = (t, mark, bytes) =>
  setTimeout(() => {
    log(`\n== ${mark} ==`)
    if (bytes) proc.write(bytes)
  }, t)

step(2500, 'digita /help + Enter — será que o handler existe?', '/help\r')
setTimeout(() => {
  log('\n== FIM — encerrando ==')
  proc.kill()
  process.exit(0)
}, 7000)
