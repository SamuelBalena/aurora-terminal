import { app, shell, BrowserWindow, ipcMain, desktopCapturer, screen, clipboard } from 'electron'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { buildHelpText } from '../shared/helpText'
import { buildCmdReport, type CustomCommand } from '../shared/customCommands'

let mainWindow: BrowserWindow | null = null

// ─── Shell que o terminal executa ─────────────────────────────────────────
// 'linux'   → Git Bash: bash REAL + comandos GNU/Linux reais, já instalado
//             junto com o seu Git. Zero WSL, zero tradução.
// 'windows' → PowerShell nativo do Windows
// 'wsl'     → WSL (só se um dia instalar uma distro com `wsl --install`)
interface ShellConfig {
  file: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
}

// Histórico persistente de comandos: o bash faz o trabalho pesado (setas ↑/↓,
// dedup, contagem) — o app só aponta o arquivo e as regras. O flush após cada
// comando (`history -a`) grava no disco imediatamente: nada se perde quando o
// app fecha ou a máquina reinicia. `history -n` puxa o que as OUTRAS abas
// gravaram — histórico compartilhado entre abas, ao vivo.
const HISTORY_FILE = join(process.env['USERPROFILE'] ?? 'C:\\', '.aurora_history').replace(/\\/g, '/')

// ─── Integração com o bash: ajuda lida pelo próprio shell ────────────────────
// O /help vivo funciona pedindo ao bash (via Ctrl+U + " cat …\r" do renderer)
// que ele mesmo leia e imprima aurora-help.ansi — alinhamento nativo, setas
// perfeitas, e o espaço inicial tira a linha do histórico (ignorespace).
const HELP_ANSI_PATH = join(app.getPath('userData'), 'aurora-help.ansi')
const BASH_PROFILE_PATH = join(process.env['USERPROFILE'] ?? app.getPath('home'), '.bash_profile')
const COMMANDS_PATH = join(app.getPath('userData'), 'custom-commands.json')
const CMD_REPORT_PATH = join(app.getPath('userData'), 'aurora-cmd-report.ansi')

function installBashIntegrations(): void {
  try {
    writeFileSync(HELP_ANSI_PATH, buildHelpText(), 'utf8')
    debug(`ajuda ANSI: ${HELP_ANSI_PATH}`)

    // Aposenta o bloco que o app já instalou no ~/.bash_profile em versões
    // anteriores: o bash não chama command_not_found_handle para comandos
    // com "/" no nome, então o bloco nunca teve efeito. Casa limpa.
    try {
      const profile = readFileSync(BASH_PROFILE_PATH, 'utf8')
      if (profile.includes('>>> aurora-terminal')) {
        writeFileSync(BASH_PROFILE_PATH, profile.replace(/# >>> aurora-terminal[\s\S]*?# <<< aurora-terminal <<<\n?/g, ''), 'utf8')
        debug(`.bash_profile: bloco antigo do Aurora removido`)
      }
    } catch {
      /* sem .bash_profile — nada a limpar */
    }
  } catch (err) {
    debug(`⚠ falha ao gravar integrações bash: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─── Comandos personalizados: userData/custom-commands.json ────────────────
function loadCustomCommands(): CustomCommand[] {
  try {
    const parsed = JSON.parse(readFileSync(COMMANDS_PATH, 'utf8'))
    const arr = Array.isArray(parsed) ? parsed : parsed.commands
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (c): c is CustomCommand =>
          !!c &&
          typeof c.name === 'string' &&
          c.name.length > 0 &&
          (typeof c.run === 'string' ||
            (Array.isArray(c.run) && c.run.every((r) => typeof r === 'string')))
      )
      .map((c) => ({ name: c.name, run: Array.isArray(c.run) ? c.run : [c.run] }))
  } catch {
    return [] // primeira vez / arquivo inválido: começa vazio
  }
}

function saveCustomCommands(list: CustomCommand[]): void {
  try {
    writeFileSync(COMMANDS_PATH, JSON.stringify({ commands: list }, null, 2) + '\n', 'utf8')
  } catch (err) {
    debug(`⚠ falha ao gravar custom-commands.json: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const SHELLS: Record<'linux' | 'windows' | 'wsl', ShellConfig> = {
  linux: {
    file: 'C:\\Program Files\\Git\\bin\\bash.exe',
    args: ['--login', '-i'],
    env: {
      MSYSTEM: 'MINGW64',
      TERM: 'xterm-256color',
      HISTFILE: HISTORY_FILE, // nosso arquivo: C:/Users/balen/.aurora_history
      HISTSIZE: '2000', // em memória
      HISTFILESIZE: '2000', // no arquivo: os mais antigos são podados
      HISTCONTROL: 'ignoreboth', // ignora consecutivos iguais + comandos com espaço inicial
      AURORA_HELP_ANSI: HELP_ANSI_PATH.replace(/\\/g, '/'),
      AURORA_CMD_ANSI: CMD_REPORT_PATH.replace(/\\/g, '/'), // relatório do /cmd
      // grava/lê histórico ao vivo — o /help vivo roda via `cat` (com espaço
      // inicial ⇒ fora do histórico), enviado pelo renderer
      PROMPT_COMMAND: 'history -a; history -n'
    },
    cwd: process.env['USERPROFILE']
  },
  windows: {
    file: 'powershell.exe',
    args: [],
    cwd: process.env['USERPROFILE']
  },
  wsl: {
    file: 'wsl.exe',
    args: ['~']
  }
}

const SHELL_CHOICE: 'linux' | 'windows' | 'wsl' = 'linux'
let SHELL: ShellConfig = SHELLS[SHELL_CHOICE]

// ─── Sessões PTY: uma por aba, identificadas pelo id ───────────────────────
interface PtySession {
  proc: IPty
  startedAt: number
  pendingKill: ReturnType<typeof setTimeout> | null
  loggedFirstWrite: boolean
  loggedFirstData: boolean
}
const sessions = new Map<string, PtySession>()

// Log de diagnóstico no disco — a caixa-preta do terminal. Dev: raiz do
// projeto (fácil de inspecionar). App EMPACOTADO: o caminho do app aponta
// pra dentro do app.asar (somente leitura) — logs de produção vão pro
// userData, onde sempre dá pra escrever.
const DEBUG_LOG = join(
  app.isPackaged ? app.getPath('userData') : app.getAppPath(),
  'pty-debug.log'
)
function debug(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try {
    appendFileSync(DEBUG_LOG, line + '\n', 'utf8')
  } catch {
    /* ignora falha de escrita no log */
  }
}

function killNow(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  if (s.pendingKill) {
    clearTimeout(s.pendingKill)
    s.pendingKill = null
  }
  debug(`encerrando sessão ${id} (pid ${s.proc.pid})`)
  s.proc.kill()
  sessions.delete(id)
}

// Dev com StrictMode faz: monta → desmonta → remonta em ~10ms. Matar a sessão
// na desmontada derruba o shell recém-nascido. Então o dispose só AGENDA o
// kill: um create com o mesmo id em <300ms cancela e reaproveita a sessão.
function scheduleKill(id: string): void {
  const s = sessions.get(id)
  if (!s || s.pendingKill) return
  debug(`kill agendado para ${id} (300ms)…`)
  s.pendingKill = setTimeout(() => {
    debug(`kill agendado executado — ${id}`)
    killNow(id)
  }, 300)
}

function killAll(): void {
  for (const id of [...sessions.keys()]) killNow(id)
}

// Janela em que uma sessão recém-spawnada ainda está em boot (login do bash).
// Remontes que caem aqui NÃO recebem o '\r' de re-eco — ele entraria na fila
// como linha vazia e duplicaria o prompt na inicialização.
const SESSION_BOOT_MS = 2000

function createSession(id: string, cols: number, rows: number): void {
  const existing = sessions.get(id)
  if (existing) {
    if (existing.pendingKill) {
      clearTimeout(existing.pendingKill)
      existing.pendingKill = null
      debug(`kill cancelado — sessão ${id} reaproveitada`)
    }
    existing.proc.resize(cols, rows)

    const settled = Date.now() - existing.startedAt > SESSION_BOOT_MS
    if (settled) {
      // view remontada após o boot: o Enter re-imprime o prompt pra quem chegou depois
      existing.proc.write('\r')
      debug(`reaproveitando sessão ${id} (pid ${existing.proc.pid}) + re-eco do prompt`)
    } else {
      // remonte na janela de boot: não injeta nada — o prompt de verdade
      // ainda vai chegar sozinho, limpo, e a nova view o receberá
      debug(`reaproveitando sessão ${id} (pid ${existing.proc.pid}) em boot — sem '\\r'`)
    }
    return
  }

  debug(`pty:create ${id} — ${cols}x${rows}`)
  let proc: IPty
  try {
    proc = spawnPty(SHELL.file, SHELL.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: SHELL.cwd,
      env: { ...process.env, ...(SHELL.env ?? {}) } as Record<string, string>
    })
  } catch (err) {
    debug(`❌ ERRO no spawn da sessão ${id}: ${err instanceof Error ? err.stack : String(err)}`)
    return
  }

  const session: PtySession = {
    proc,
    startedAt: Date.now(),
    pendingKill: null,
    loggedFirstWrite: false,
    loggedFirstData: false
  }
  sessions.set(id, session)
  debug(`✓ sessão ${id} spawn ok (pid ${proc.pid}) — ${SHELL.file}`)

  // Saída do shell → xterm da aba correspondente — mas NÃO um IPC por chunk
  // (v22): o bash cospe dezenas de chunks por comando (`ls`, build, cat) e
  // mensagem miúda em rajada engarrafa o event loop do renderer. Juntamos
  // numa janela de 16ms com teto de 128KB — rajadas viram poucas mensagens
  // grandes; eco de tecla espera no máx 16ms (imperceptível). Receita
  // documentada dos terminais Electron (Hyper/Theia).
  let outBuf = ''
  let outTimer: ReturnType<typeof setTimeout> | null = null
  const flushOut = (): void => {
    if (outTimer) {
      clearTimeout(outTimer)
      outTimer = null
    }
    if (!outBuf) return
    const data = outBuf
    outBuf = ''
    mainWindow?.webContents.send('pty:data', id, data)
  }
  proc.onData((chunk) => {
    if (!session.loggedFirstData) {
      session.loggedFirstData = true
      debug(`✓ primeiro output ${id} (${chunk.length}b): ${JSON.stringify(chunk.slice(0, 60))}`)
    }
    outBuf += chunk
    if (outBuf.length >= 131_072) {
      flushOut() // rajada grande: flush imediato, nem espera a janela
      return
    }
    if (!outTimer) outTimer = setTimeout(flushOut, 16)
  })

  // Shell encerrou (ex.: `exit`) — avisa a aba correspondente
  proc.onExit(({ exitCode, signal }) => {
    flushOut() // despeja o rabo pendente ANTES do exit (scrollback completo)
    if (sessions.get(id) === session) {
      debug(`shell ${id} encerrou — exitCode=${exitCode}, signal=${signal}`)
      if (session.pendingKill) clearTimeout(session.pendingKill)
      sessions.delete(id)
    }
    mainWindow?.webContents.send('pty:exit', id)
  })
}

// ─── Config do usuário: userData/config.json ───────────────────────────────
interface AppConfig {
  theme: string
  fontSize: number
  neon: boolean // halo neon das letras (v24) — Ctrl+Alt+N alternates
}

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')
const DEFAULT_CONFIG: AppConfig = { theme: 'aurora-dark', fontSize: 14, neon: true }

function loadConfig(): AppConfig {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<AppConfig>
    return {
      theme: typeof parsed.theme === 'string' ? parsed.theme : DEFAULT_CONFIG.theme,
      fontSize:
        typeof parsed.fontSize === 'number' && Number.isInteger(parsed.fontSize)
          ? parsed.fontSize
          : DEFAULT_CONFIG.fontSize,
      neon: typeof parsed.neon === 'boolean' ? parsed.neon : DEFAULT_CONFIG.neon
    }
  } catch {
    return { ...DEFAULT_CONFIG } // primeira vez / arquivo inválido: padrão
  }
}

function saveConfig(patch: Partial<AppConfig>): void {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({ ...loadConfig(), ...patch }, null, 2) + '\n', 'utf8')
  } catch (err) {
    debug(`⚠ falha ao gravar config.json: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─── GLASSMORPHISM determinístico ─────────────────────────────────────
// Lição das rodadas de loteria DWM (acrylic/mica/transparent): o material
// do sistema renderiza (ou não) conforme driver/GPU/build — indomável.
// Aqui a janela é OPACA e normal (resize nativo sempre funciona) e o vidro
// é CONSTRUÍDO: capturamos a tela real com desktopCapturer (nativo do
// Electron, zero terceiros), o renderer borra essa imagem com o próprio
// Chromium e posiciona atrás das tintas translúcidas dos temas.
// Funciona em qualquer Windows, custe a GPU que custar.
// Fallback silencioso: captura falhou → janela só com as tintas.
let glassBgUrl: string | null = null
let glassDisplay = { x: 0, y: 0, w: 0, h: 0 }

// ── Vidro VIVO (v19) ──────────────────────────────────────────────────────
// A captura inicial (pré-janela) é um RETRATO congelado — se o que está
// atrás muda (troca de app, vídeo rolando), o vidro fica desatualizado.
// Solução: recapturar a tela periodicamente. O que torna isso POSSÍVEL é
// SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) — marca a própria
// janela como invisível para capturas de tela. Sem isso cada recaptura
// incluiria o terminal dentro do próprio vidro (eco infinito); com isso a
// captura mostra exatamente o que está ATRÁS da janela, ao vivo.
const GLASS_SCALE = 0.38 // foto em baixa resolução (o blur de 14px esconde)
const GLASS_MOVE_QUIET_MS = 600 // drag/resize assentou? só então fotografa
const WDA_EXCLUDEFROMCAPTURE = 0x11

let glassLive = false
let glassLastJpeg: Buffer | null = null // última foto: pula tudo se nada mudou
let lastGlassMoveAt = 0 // última vez que a janela se moveu/redimensionou

// Captura um display específico (a tela onde a janela ESTÁ — multi-monitor
// coberto de graça) em JPEG e guarda junto com sua origem em DIPs: o
// renderer estica a imagem até w×h e a alinha com o translate.
async function captureGlass(display: Electron.Display): Promise<boolean> {
  const thumbnailSize = {
    width: Math.max(320, Math.round(display.size.width * GLASS_SCALE)),
    height: Math.max(180, Math.round(display.size.height * GLASS_SCALE))
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  if (!sources.length) throw new Error('nenhuma tela capturada')
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  // alinhamento sempre fresco (mesmo com foto idêntica — troca de monitor
  // com fundo parado precisa realinhar a origem da imagem)
  glassDisplay = {
    x: display.bounds.x,
    y: display.bounds.y,
    w: display.size.width,
    h: display.size.height
  }
  const jpeg = src.thumbnail.toJPEG(70)
  // v21: JPEG determinístico — mesmo frame ⇒ mesmos bytes ⇒ fundo parado:
  // nada de re-codificar base64, partir IPC pro renderer ou re-render.
  if (glassLastJpeg?.equals(jpeg)) return false
  glassLastJpeg = jpeg
  glassBgUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
  return true
}

// O retrato inicial: roda ANTES da janela existir (fundo limpo, sem o
// próprio app) — é o que aparece no primeiro frame, antes do loop vivo.
async function captureGlassBg(): Promise<void> {
  try {
    await captureGlass(screen.getPrimaryDisplay())
    debug(`glass: tela capturada ${glassDisplay.w}x${glassDisplay.h}`)
  } catch (err) {
    debug(`⚠ glass: captura falhou (${err instanceof Error ? err.message : String(err)})`)
  }
}

// Posição da janela em relação à imagem capturada — o renderer alinha o
// fundo borrado com o que está de verdade atrás da janela.
function sendGlassBounds(): void {
  const b = mainWindow?.getBounds()
  if (b) {
    mainWindow?.webContents.send('glass:bounds', {
      x: b.x - glassDisplay.x,
      y: b.y - glassDisplay.y,
      w: glassDisplay.w,
      h: glassDisplay.h
    })
  }
}

// Movimento/redimensionou: alinha o fundo na hora (pan) E carimba a hora —
// o coalescer do vidro espera o gesto assentar e aí pede UMA foto nova.
function onGlassMove(): void {
  lastGlassMoveAt = Date.now()
  sendGlassBounds()
  requestGlassRefresh(false)
}

// koffi (FFI Win32 pré-compilado, N-API como o node-pty — zero rebuild) tem
// de vir por import() DINÂMICO: as versões atuais são ESM-only, e o main do
// electron-vite compila pra CJS — import estático vira require() no build e
// explode no boot (ERR_REQUIRE_ESM, erro que já tomamos). O import()
// dinâmico funciona de dentro de CJS e carrega qualquer formato. Tipagem
// local: só o que usamos (load/func), sem depender do .d.ts do pacote.
interface KoffiWin {
  load: (name: string) => { func: (proto: string) => (...args: any[]) => number }
  proto: (proto: string) => symbol | object
  register: (cb: (...args: any[]) => void, proto: symbol | object) => unknown
}

async function loadKoffi(): Promise<KoffiWin> {
  // Cinto E suspensório: o require.resolve acha o arquivo do pacote (na 1ª
  // tentativa chegou inclusive a CARREGAR — só recusou por ser ESM); o
  // import() por URL file:// carrega o arquivo direto, pulando a resolução
  // bare-specifier que dá "Cannot find package" mesmo com o pacote no disco.
  // Se até isso falhar (ex.: app empacotado, arquivo dentro do app.asar),
  // o require comum do Electron carrega CJS e redireciona .node pro
  // asar.unpacked sozinho.
  const nodeRequire = createRequire(__filename)
  const entry = nodeRequire.resolve('koffi')
  try {
    const mod = (await import(pathToFileURL(entry).href)) as unknown as { default?: KoffiWin }
    return mod.default ?? (mod as unknown as KoffiWin)
  } catch {
    return nodeRequire('koffi') as KoffiWin
  }
}

// Exclui a própria janela de TODAS as capturas de tela (verbete do Windows:
// "does not appear at all" — capturas mostram o que está por trás). É o
// segredo do vidro vivo — e um bônus de privacidade: o terminal não sai em
// printscreen nem gravação de tela.
// v20 — LIÇÃO DA SONDA (probe-vidro.cjs): chamar SetWindowDisplayAffinity
// durante o createWindow (janela pré-show, show: false) "sucede" SEM COLAR
// — retorno ok e GetWindowDisplayAffinity lendo 0x0. Jamais confiar no
// retorno: marca, LÊ DE VOLTA e tenta de novo até o próprio Windows
// confirmar 0x11. Só então o loop de captura pode ligar.
async function excludeSelfFromCapture(): Promise<boolean> {
  const win = mainWindow
  if (!win) return false
  const koffi = await loadKoffi()
  const user32 = koffi.load('user32.dll')
  const setWindowDisplayAffinity = user32.func(
    'int32_t __stdcall SetWindowDisplayAffinity(uint64_t hwnd, uint32_t affinity)'
  ) as (hwnd: bigint, affinity: number) => number
  const getWindowDisplayAffinity = user32.func(
    'int32_t __stdcall GetWindowDisplayAffinity(uint64_t hwnd, uint32_t *affinity)'
  ) as (hwnd: bigint, affinityOut: Buffer) => number
  const buf = win.getNativeWindowHandle() // HWND cru, little-endian (8b no x64)
  const hwnd = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))
  const affOut = Buffer.alloc(4)
  for (let attempt = 1; attempt <= 4; attempt++) {
    setWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
    affOut.writeUInt32LE(0, 0)
    getWindowDisplayAffinity(hwnd, affOut)
    const applied = affOut.readUInt32LE(0)
    if (applied === WDA_EXCLUDEFROMCAPTURE) {
      debug(`vidro vivo: exclusão CONFIRMADA pelo Windows (tentativa ${attempt})`)
      return true
    }
    debug(
      `vidro vivo: marcação não colou (tentativa ${attempt}, lido 0x${applied.toString(16)} vs 0x11) — reagendando`
    )
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  return false
}

// O coração do vidro (v23) — DIRIGIDO A EVENTOS, pedido do usuário: "ele
// só precisa mudar o fundo se eu mudar a janela de fundo". ZERO timer de
// captura. O Windows AVISA quando o desktop muda (WinEventHook):
//   · troca de app em foreground, janela abrindo/fechando/minimizando,
//     z-order, janela de OUTRO app sendo arrastada, troca de desktop
//     virtual — cada aviso pede UMA foto coalescida, não uma por segundo
//   · a NOSSA janela: drag/resize pedem foto quando o gesto assenta
//   · rede de segurança: a cada 12s, SÓ se a janela estiver sem foco
// DIGITAR NO TERMINAL NÃO DISPARA NADA — teclas não geram eventos de
// janela. Fundo parado = zero fotografias, por construção.
const GLASS_HOOK_EVENTS = new Set([
  0x0003, // EVENT_SYSTEM_FOREGROUND — trocou o app em foco
  0x0004, // EVENT_OBJECT_REORDER — mudou o z-order
  0x0016, // EVENT_SYSTEM_MINIMIZESTART
  0x0017, // EVENT_SYSTEM_MINIMIZEEND
  0x0020, // EVENT_SYSTEM_DESKTOPSWITCH — Win+Ctrl+Setas
  0x8000, // EVENT_OBJECT_CREATE
  0x8001, // EVENT_OBJECT_DESTROY
  0x8002, // EVENT_OBJECT_SHOW — janela apareceu
  0x8003, // EVENT_OBJECT_HIDE — janela sumiu
  0x800b // EVENT_OBJECT_LOCATIONCHANGE — janela de outro app em drag
])
const WINEVENT_SKIPOWNPROCESS = 0x0002 // pula eventos do NOSSO processo ( inclusive do nosso drag)

let glassRequestTimer: ReturnType<typeof setTimeout> | null = null
let glassDirty = false
let lastCaptureAt = 0

// Coalescer: rajada de eventos (um drag de outro app dispara LOCATIONCHANGE
// por pixel) vira NO MÁXIMO uma foto. followUp marca estímulos vindos do
// desktop — após a foto, uma de conferência 2.2s depois pega telas que
// ainda estavam se desenhando (app abrindo animado); a detecção de fundo
// idêntico no main (Buffer.equals) torna essa segunda foto quase grátis.
function requestGlassRefresh(followUp: boolean): void {
  glassDirty = true
  if (glassRequestTimer) return
  glassRequestTimer = setTimeout(() => void flushGlass(followUp), 450)
}

async function flushGlass(followUp: boolean): Promise<void> {
  glassRequestTimer = null
  const win = mainWindow
  if (!glassLive || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) {
    glassDirty = false
    return
  }
  // NOSSA janela em drag/resize: espera assentar (pan segue via bounds)
  if (Date.now() - lastGlassMoveAt < GLASS_MOVE_QUIET_MS) {
    glassRequestTimer = setTimeout(() => void flushGlass(followUp), 200)
    return
  }
  // O mundo de trás ainda se mexe (rajada de LOCATIONCHANGE)? espera a pausa
  if (Date.now() - lastCaptureAt < 700) {
    glassDirty = true
    glassRequestTimer = setTimeout(() => void flushGlass(followUp), 300)
    return
  }
  lastCaptureAt = Date.now()
  glassDirty = false
  try {
    const display = screen.getDisplayMatching(win.getBounds())
    const switched =
      display.bounds.x !== glassDisplay.x ||
      display.bounds.y !== glassDisplay.y ||
      display.size.width !== glassDisplay.w ||
      display.size.height !== glassDisplay.h
    const changed = await captureGlass(display)
    if (changed && glassBgUrl) win.webContents.send('glass:bg', glassBgUrl)
    if (switched) sendGlassBounds() // trocou de monitor → realinha a imagem
  } catch (err) {
    debug(`⚠ glass-live: captura falhou (${err instanceof Error ? err.message : String(err)})`)
  }
  if (followUp && !glassRequestTimer) {
    glassRequestTimer = setTimeout(() => void flushGlass(false), 2200)
  }
}

async function startLiveGlass(): Promise<void> {
  if (glassLive) return
  try {
    const excluded = await excludeSelfFromCapture()
    if (!excluded) {
      debug('⚠ glass-live: SetWindowDisplayAffinity recusou — vidro fica ESTÁTICO')
      return
    }
    glassLive = true
    debug('glass-live: janela fora das capturas ✓ — vidro vivo ligado')
  } catch (err) {
    debug(
      `⚠ glass-live: indisponível (${err instanceof Error ? err.message : String(err)}) — vidro estático`
    )
    return
  }

  // ── WinEventHook: o Windows nos conta quando o desktop muda (koffi) ──
  try {
    const koffi = await loadKoffi()
    const user32 = koffi.load('user32.dll')
    const winEventProc = koffi.proto(
      'void __stdcall WinEventProcGlass(void *hook, uint32_t event, void *hwnd, int32_t idObject, int32_t idChild, uint32_t thread, uint32_t time)'
    )
    const onWinEvent = koffi.register(
      (_hook, event, _hwnd, idObject) => {
        // só janelas (objeto 0): cursor/caret/menu não interessam e disputam
        if (idObject !== 0) return
        if (GLASS_HOOK_EVENTS.has(event)) requestGlassRefresh(true)
      },
      winEventProc
    )
    const SetWinEventHook = user32.func(
      'void * __stdcall SetWinEventHook(uint32_t min, uint32_t max, void *mod, WinEventProcGlass *proc, uint32_t pid, uint32_t tid, uint32_t flags)'
    ) as (...args: unknown[]) => unknown
    const hook = SetWinEventHook(0x0003, 0x800b, null, onWinEvent, 0, 0, WINEVENT_SKIPOWNPROCESS)
    debug(`glass-live: WinEventHook ${hook ? 'instalado ✓ (desktop vigiado por eventos)' : 'FALHOU — só rede de segurança'}`)
  } catch (err) {
    debug(`⚠ glass-live: WinEventHook indisponível (${err instanceof Error ? err.message : String(err)}) — só rede de segurança`)
  }

  // Monitor mudou (resolução, monitor plugado, desktop virtual)?
  screen.on('display-metrics-changed', () => requestGlassRefresh(false))

  // Rede de segurança: foto a cada 12s SÓ com a janela visível e SEM foco
  // (vídeo rodando atrás, por exemplo). Com foco — você digitando — zero.
  setInterval(() => {
    const win = mainWindow
    if (!glassLive || !win || win.isDestroyed()) return
    if (win.isVisible() && !win.isMinimized() && !win.isFocused()) requestGlassRefresh(false)
  }, 12_000)

  // Primeira foto pós-show (fundo perfeito desde o primeiro frame vivo)
  requestGlassRefresh(false)
}

// Logo do app (ícone da janela/taskbar no dev; no instalador o .exe carrega
// o ícone embutido pelo electron-builder). Dev: <projeto>/resources; app
// empacotado: o extraResources do builder põe em <resourcesPath>/resources.
const LOGO_PNG = join(
  app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources'),
  'logo.png'
)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    title: 'Aurora Terminal',
    icon: LOGO_PNG, // logo própria — nada do ícone default do Electron
    frame: false, // sem frame nativo (frameless)
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Evita o "flash" branco antes do conteúdo carregar — e a exclusão de
  // captura (vidro vivo) SÓ é marcada DEPOIS da janela existir na tela:
  // marcar pré-show "sucia" sem colar (lição probe-vidro.cjs acima).
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    void startLiveGlass()
  })

  // Links externos abrem no navegador padrão, não dentro do app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Janela fechada = todas as sessões encerradas junto (sem espera) + o
  // vidro vivo é desligado (a batida checa o glassLive antes de recapturar)
  mainWindow.on('closed', () => {
    glassLive = false
    mainWindow = null
    killAll()
  })

  // ── Vidro: manda a captura da tela + a posição da janela (o renderer
  // alinha a imagem-borrada com o que está atrás em tempo real). O carimbo
  // de "estou me movendo" alimenta a pausa de captura do tick (drag liso).
  mainWindow.on('moved', onGlassMove)
  mainWindow.on('resized', onGlassMove)
  mainWindow.webContents.once('did-finish-load', () => {
    if (glassBgUrl) mainWindow?.webContents.send('glass:bg', glassBgUrl)
    sendGlassBounds()
  })

  // v20: vidro vivo agora nasce no 'ready-to-show' (após o show) — ver acima

  // Dev: servidor do Vite | Produção (preview/empacotado): arquivo buildado em out/
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- IPC: xterm de cada aba (renderer) ⇄ sessões PTY no main ----
ipcMain.on('pty:create', (_e, id: string, cols: number, rows: number) =>
  createSession(id, cols, rows)
)
ipcMain.on('pty:write', (_e, id: string, data: string) => {
  const s = sessions.get(id)
  if (!s) return
  if (!s.loggedFirstWrite) {
    s.loggedFirstWrite = true
    debug(`✓ primeiro input de teclado ${id}`)
  }
  s.proc.write(data)
})
ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
  sessions.get(id)?.proc.resize(cols, rows)
})
ipcMain.on('pty:dispose', (_e, id: string) => scheduleKill(id))
// Recarga completa da página: o renderer novo começa do zero — as sessões
// do load anterior não têm mais dono e são varridas imediatamente.
ipcMain.on('pty:reset-all', () => {
  debug('reset-all: varrendo sessões órfãs')
  killAll()
})

// ---- Config do usuário (tema, etc.) ----
ipcMain.handle('config:get', () => loadConfig())
ipcMain.on('config:set', (_e, patch: { theme?: string; fontSize?: number; neon?: boolean }) => {
  saveConfig(patch)
  debug(`config.json atualizado: ${JSON.stringify(patch)}`)
})

// ---- Janela (botão fechar da barra, já que o frame é nosso) ----
ipcMain.on('window:close', () => {
  debug('fechando janela (botão da barra)')
  mainWindow?.close()
})

// ---- Clipboard (copiar/colar do terminal) ----
// O clipboard do Electron é a única ponta confiável pro sistema —
// navigator.clipboard no renderer depende de contexto seguro e permissão.
ipcMain.handle('clipboard:readText', () => clipboard.readText())

ipcMain.on('clipboard:writeText', (_e, text: unknown) => {
  // valida: só string não-vazia, com teto (nada de descarrilar o sistema)
  if (typeof text === 'string' && text.length > 0 && text.length < 1_048_576) {
    clipboard.writeText(text)
  }
})

// ---- Comandos personalizados (/cmd no terminal) ----
// O renderer salva a lista nova + a linha de ação; o main persiste o JSON,
// gera o relatório ANSI (o bash o imprime via ` cat` — alinhado), e
// devolve o texto pra quem estiver com sessão morta exibir local.
ipcMain.handle('commands:get', () => ({ commands: loadCustomCommands() }))

ipcMain.handle('commands:save', (_e, payload: { list: CustomCommand[]; action: string }) => {
  const list = Array.isArray(payload?.list)
    ? payload.list
        .filter(
          (c): c is CustomCommand =>
            !!c &&
            typeof c.name === 'string' &&
            c.name.length > 0 &&
            (typeof c.run === 'string' ||
              (Array.isArray(c.run) && c.run.every((r) => typeof r === 'string')))
        )
        // normaliza: o arquivo é SEMPRE formato array (regra do sistema)
        .map((c) => ({ name: c.name, run: Array.isArray(c.run) ? c.run : [c.run] }))
    : []
  saveCustomCommands(list)

  const action = typeof payload?.action === 'string' ? payload.action : ''
  const report = buildCmdReport(action, list, COMMANDS_PATH)
  try {
    writeFileSync(CMD_REPORT_PATH, report, 'utf8')
  } catch {
    /* o cat silencia com 2>/dev/null; o renderer tem o texto de volta */
  }

  // sincroniza TODAS as abas (inclusive a que pediu — mesmo valor, inofensivo)
  mainWindow?.webContents.send('commands:updated', { commands: list })
  debug(`custom-commands (${list.length}): ${action.replace(/\x1b\[[0-9;]*m/g, '')}`)
  return report
})

app.whenReady().then(async () => {
  // recomeça o log limpo a cada boot
  try {
    writeFileSync(DEBUG_LOG, `=== boot @ ${new Date().toISOString()} ===\n`, 'utf8')
  } catch {}

  // caminhos absolutos que não existem → cai para PowerShell com aviso no log
  if (/^[A-Z]:/i.test(SHELL.file) && !existsSync(SHELL.file)) {
    debug(`⚠ "${SHELL.file}" não encontrado — caindo para PowerShell`)
    SHELL = SHELLS.windows
  }
  debug(`shell em uso: ${SHELL.file} ${SHELL.args.join(' ')}`)
  debug(`config: ${CONFIG_PATH}`)
  if (SHELL_CHOICE === 'linux') debug(`histórico: ${HISTORY_FILE}`)
  if (SHELL_CHOICE === 'linux') debug(`custom-commands: ${COMMANDS_PATH}`)
  if (SHELL_CHOICE === 'linux') installBashIntegrations()

  // relatório inicial de /cmd (o bash só o lê sob demanda, mas deixamos
  // o arquivo pronto desde o boot)
  try {
    writeFileSync(
      CMD_REPORT_PATH,
      buildCmdReport('sessão iniciada', loadCustomCommands(), COMMANDS_PATH),
      'utf8'
    )
  } catch {
    /* sem relatório: o cat mostra vazio; /cmd add recria */
  }

  // captura a tela ANTES da janela existir (fundo limpo, sem o próprio app)
  await captureGlassBg()

  createWindow()

  app.on('activate', () => {
    // macOS: reabre a janela ao clicar no ícone do dock
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => killAll())
