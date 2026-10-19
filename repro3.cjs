// Reprodução 3 — o mistério das variáveis de ambiente: bin\bash.exe vs usr\bin\bash.exe
// Uso: node repro3.cjs   — grava em repro-dump3.log
const pty = require('node-pty')
const path = require('path')
const fs = require('fs')

const userData = path.join(process.env.APPDATA, 'aurora-terminal')
const INIT = (userData + '\\aurora-init.sh').replace(/\\/g, '/')
const LOG = path.join(__dirname, 'repro-dump3.log')
fs.writeFileSync(LOG, `=== repro3 @ ${new Date().toISOString()} ===\n`, 'utf8')
const log = (m) => fs.appendFileSync(LOG, m + '\n', 'utf8')

async function arm(shellPath, label) {
  return new Promise((resolve) => {
    log(`\n========= ${label}: ${shellPath} =========`)
    const proc = pty.spawn(shellPath, ['--login', '-i'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.env.USERPROFILE,
      env: {
        ...process.env,
        MSYSTEM: 'MINGW64',
        TERM: 'xterm-256color',
        AURORA_INIT: INIT,
        AURORA_PROBE: 'cheguei'
      }
    })
    let buf = ''
    proc.onData((d) => {
      buf += d
    })
    setTimeout(() => {
      proc.write('echo "[PROBE=$AURORA_PROBE]"; echo "[INIT=$AURORA_INIT]"; declare -F command_not_found_handle || echo "[SEM_HANDLER]"\r')
    }, 2000)
    setTimeout(() => {
      proc.write('/help\r')
    }, 4000)
    setTimeout(() => {
      log('SAIDA DA SESSAO (' + label + '):')
      log(buf)
      proc.kill()
      resolve()
    }, 6500)
  })
}

;(async () => {
  await arm('C:\\Program Files\\Git\\bin\\bash.exe', 'ARM A (o que o app usa)')
  await arm('C:\\Program Files\\Git\\usr\\bin\\bash.exe', 'ARM B (bash real)')
  log('\n== FIM DOS DOIS TESTES ==')
  process.exit(0)
})()
