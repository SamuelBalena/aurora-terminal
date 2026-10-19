import { useEffect, useRef } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { isAppShortcut } from './shortcuts'
import { runInternalCommand, isInternalCommand } from './help'
import { applyCmdDirective, type CustomCommand } from '../../shared/customCommands'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  id: string // id da aba/sessão — estável (é a key do React no App)
  active: boolean // aba visível? abas ocultas não recalculam o grid
  theme: ITheme // paleta do tema atual (troca em tempo real)
  fontSize: number // tamanho de fonte atual (Ctrl +/-/0)
}

function Terminal({ id, active, theme, fontSize }: TerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<XTerm | null>(null)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  // Troca de tema em tempo real: o xterm re-renderiza na hora
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = theme
  }, [theme])

  // Zoom da fonte: aplica e refaz o fit (células maiores → novo grid → PTY)
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    if (activeRef.current) requestAnimationFrame(() => fitRef.current?.fit())
  }, [fontSize])

  // Copiar/colar PADRÃO estilo Windows Terminal — captura na janela com
  // stopPropagation (o xterm jamais interpreta: senão vira ^C/"^V" pro shell):
  //   Ctrl+C  → tem seleção? COPIA — senão vira o Ctrl+C de interromper
  //   Ctrl+V  → cola sempre
  //   Ctrl+A  → seleção a linha do cursor; já com seleção: TODO o texto
  //   (Ctrl+Shift+C/V e Shift+Insert continuam valendo — mesmos ramos)
  //   botão direito → copia (com seleção) / cola (sem)
  // Colar usa term.paste — o MESMO funnel da colagem: bracketed-paste do
  // readline + rastreio de linha com o guard multiline da saga /cmd.
  useEffect(() => {
    const XTermLocal = XTerm

    const copySelection = (term: XTermLocal): boolean => {
      const sel = term.getSelection()
      if (sel) {
        window.electron.clipboard.writeText(sel)
        return true
      }
      return false
    }

    const pasteFromClipboard = (term: XTermLocal): void => {
      void window.electron.clipboard
        .readText()
        .then((text) => {
          if (text) term.paste(text)
        })
        .catch(() => {
          /* main inacessível (dev reiniciando): falha silenciosa e segura */
        })
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || !activeRef.current || e.altKey || e.metaKey) return
      const term = termRef.current
      if (!term) return
      const k = e.key.toLowerCase()

      // Shift+Insert — o clássico do Windows (não usa Ctrl)
      if (e.shiftKey && !e.ctrlKey && k === 'insert') {
        e.preventDefault()
        e.stopPropagation()
        pasteFromClipboard(term)
        return
      }
      // Backspace/Delete com SELEÇÃO: apaga o COMANDO inteiro via \u0015 (o
      // Ctrl+U nativo do readline) — decisão TEXTUAL (o texto selecionado
      // pertence à linha do cursor?), zero coordenadas, imune a 1-based.
      // v13: o instrumento [del] da v12 saiu — imprimir local sobre a
      // linha viva do readline DESALINHA (lição nº 1 da saga /help); o
      // Ctrl+U sozinho limpa a linha e MANTÉM o prompt no mesmo lugar.
      if (!e.ctrlKey && !e.shiftKey && (k === 'backspace' || k === 'delete')) {
        const pos = term.getSelectionPosition()
        if (!pos) return // sem seleção: segue o backspace normal (1 char)
        const cur = term.buffer.active
        const row = cur.baseY + cur.cursorY
        const lineText = cur.getLine(row)?.translateToString(true) ?? ''
        const selText = term.getSelection().replace(/[\r\n]+/g, ' ').trim()
        if (selText.length > 0 && lineText.includes(selText)) {
          e.preventDefault()
          e.stopPropagation()
          window.electron.pty.write(id, '\u0015') // Ctrl+U: limpa a linha TODA
          term.clearSelection()
        }
        // fora do caso (seleção no scrollback): segue o backspace normal
        return
      }

      if (!e.ctrlKey) return

      if (k === 'c') {
        // Ctrl+C / Ctrl+Shift+C → copia a seleção; sem seleção interrompe
        e.preventDefault()
        e.stopPropagation()
        if (!copySelection(term)) window.electron.pty.write(id, '\x03')
        return
      }
      if (k === 'v') {
        // Ctrl+V / Ctrl+Shift+V → cola
        e.preventDefault()
        e.stopPropagation()
        pasteFromClipboard(term)
        return
      }
      if (!e.shiftKey && k === 'a') {
        // Ctrl+A → 1ª vez: o COMANDO da linha (o prompt, "cifrão" incluso,
        // fica de fora da seleção); já com seleção: TODO o texto
        e.preventDefault()
        e.stopPropagation()
        if (term.getSelection()) {
          term.selectAll()
        } else {
          const cur = term.buffer.active
          const row = cur.baseY + cur.cursorY
          const line = cur.getLine(row)
          const text = line ? line.translateToString(true) : ''
          const promptEnd = text.indexOf('$ ') // 1º "$ " = fim do prompt
          if (promptEnd >= 0) {
            const startCol = promptEnd + 2
            const len = cur.cursorX - startCol
            if (len > 0) term.select(startCol, row, len)
            else term.clearSelection() // comando vazio: nada a selecionar
          } else {
            // linha sem prompt (output de programa): a linha inteira
            term.select(0, row, term.cols)
          }
        }
        return
      }
    }
    window.addEventListener('keydown', onKey, true)

    // botão direito: copia se houver seleção, senão cola
    const onMenu = (e: MouseEvent): void => {
      if (!activeRef.current) return
      const term = termRef.current
      if (!term) return
      e.preventDefault()
      if (!copySelection(term)) pasteFromClipboard(term)
    }
    hostRef.current?.addEventListener('contextmenu', onMenu)

    return () => {
      window.removeEventListener('keydown', onKey, true)
      hostRef.current?.removeEventListener('contextmenu', onMenu)
    }
  }, [id])

  // Ao virar visível: refaz o fit (enquanto oculta o container não é medível)
  // e garante o foco do teclado
  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      fitRef.current?.fit()
      if (activeRef.current) termRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [active])

  useEffect(() => {
    const term = new XTerm({
      theme,
      fontFamily: '"Cascadia Code", Consolas, monospace',
      fontSize,
      cursorBlink: true,
      // v22: scrollback 5000→2000 (padrão do VS Code é 1000). Cada linha da
      // janela histórica custa buffer + render mesmo sem estar visível;
      // 2000 dá bastante histórico sem carregar o buffer.
      scrollback: 2000,
      // ESSENCIAL pro glass: sem isto o xterm IGNORA o canal alfa do
      // background e pinta RGB puro (rgba(0,0,0,0) → preto — era a
      // "coluna cinza" + terminal preto do medir.log). Custo de render
      // aceito: é o que faz o vidro existir de verdade.
      allowTransparency: true
    })
    termRef.current = term

    // Atalhos do app (Ctrl+T, Ctrl+W, Ctrl+Tab, zoom…) ficam com o App e
    // NUNCA são repassados ao shell — o xterm os ignora por completo.
    term.attachCustomKeyEventHandler((ev) => !isAppShortcut(ev))

    // FitAddon: recalcula colunas/linhas quando a janela muda de tamanho
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)

    // Links clicáveis no output do terminal
    term.loadAddon(new WebLinksAddon())

    term.open(hostRef.current!)

    // v22 — RENDERER GPU: sem addon nenhum o xterm usa o DOM renderer (um
    // elemento por célula de texto — o gargalo clássico de performance de
    // terminais xterm.js). O WebGL addon desenha o grid inteiro na GPU em
    // um canvas, com atlas de glifos; suporta allowTransparency (lido no
    // código do addon) — o vidro continua vivo. Se o contexto cair (OOM/
    // suspensão), o dispose devolve ao DOM renderer como fallback.
    // https://github.com/xtermjs/xterm.js/blob/master/addons/addon-webgl/README.md
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    try {
      term.loadAddon(webgl)
    } catch {
      webgl.dispose() // GPU indisponível aqui: DOM renderer segue como antes
    }

    fit.fit()

    // Canário visível: prova que o xterm desta aba está renderizando + o
    // carimbo da versão do vidro — o que estiver AQUI é o build RODANDO
    term.writeln('\x1b[2mconectando ao shell… [vidro v24 · neon] · /help p/ ajuda\x1b[0m')

    // Se qualquer coisa quebrar na conexão, o erro aparece AQUI na tela
    let offData: (() => void) | null = null
    let offExit: (() => void) | null = null
    let offTermData: { dispose(): void } | null = null
    let offTermResize: { dispose(): void } | null = null

    // ── Sessão viva/morta ── comandos internos funcionam nos dois estados ──
    let shellAlive = true

    // ── Teclado ───────────────────────────────────────────────────────────────
    // Rastreia a linha sendo digitada. Se ao Enter ela for um comando interno
    // (ex.: /help), o Aurora mesmo imprime a resposta no xterm e envia um
    // Ctrl+C (\x03) ao readline para descartar a linha pendente e devolver o
    // prompt limpo — sem brigar com o editor de linha do bash.
    let line = ''
    let trackable = true // setas/escapes/ctrl deixam a linha imprevisível

    // ── Comandos personalizados (/cmd): registry vivo por aba ──────────────
    let customCommands: CustomCommand[] = []
    let commandsReady = false
    const offCommandsUpdated = window.electron.commands.onUpdated((data) => {
      customCommands = data.commands
      commandsReady = true
    })
    // log de caça: estado do /cmd no pty-debug.log (o main carimba hard)
    window.electron.commands
      .get()
      .then((data) => {
        customCommands = data.commands
        commandsReady = true
        term.writeln('\x1b[2m[cmd registry OK · ' + customCommands.length + ' comando(s)]\x1b[0m')
      })
      .catch((err) => {
        // main sem os handlers (= dev não reiniciado) — sem silêncio:
        // aviso VISÍVEL elimina o misterioso "não aconteceu nada"
        term.writeln(
          `\x1b[31m[cmd indisponível: ${
            err instanceof Error ? err.message : String(err)
          } — reinicie o npm run dev]\x1b[0m`
        )
      })

    /** Diretiva /cmd: aplica, persiste via main e mostra o relatório —
     *  vivo: pelo ` cat` do bash (alinhado por construção); morto: local. */
    const runCmdDirective = (entered: string): void => {
      const res = applyCmdDirective(customCommands, entered.split(/\s+/).slice(1))
      customCommands = res.list
      void window.electron.commands
        .save({ list: customCommands, action: res.action })
        .then((report) => {
          if (shellAlive) {
            // o relatório já foi escrito no disco ANTES de resolve ⇒ cat lê fresco
            window.electron.pty.write(id, '\u0015' + ' cat "$AURORA_CMD_ANSI"\r')
          } else {
            term.write('\r\n' + report)
          }
        })
    }

    const deadFeed = (chunk: string): void => {
      // Sessão morta: mini-editor LOCAL (eco) — comandos internos continuam
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          const entered = line.trim()
          line = ''
          // /cmd funciona até offline (só salva o JSON; execução exige shell)
          if (entered === '/cmd' || entered.startsWith('/cmd ')) {
            if (commandsReady) runCmdDirective(entered)
            else term.write('\r\n')
            term.write('\r\n') // fecho de linha: o relatório entra depois
            continue
          }
          term.write('\r\n')
          if (isInternalCommand(entered)) {
            runInternalCommand(term, entered)
          } else {
            const words = entered.split(/\s+/)
            const def = commandsReady ? customCommands.find((c) => c.name === words[0]) : undefined
            if (def) {
              term.write('\x1b[2m— precisa de um shell vivo para executar (expansão: ')
              term.write(Array.isArray(def.run) ? def.run.join(' ; ') : def.run)
              term.write(')\x1b[0m\r\n')
            }
          }
        } else if (ch === '\u007f') {
          line = line.slice(0, -1)
          term.write('\b \b')
        } else if (ch === '\u0015') {
          line = ''
          term.write('\r\x1b[2K')
        } else if (ch >= ' ' && ch <= '~') {
          line += ch
          term.write(ch)
        }
      }
    }

    const feed = (chunk: string): void => {
      if (!shellAlive) {
        deadFeed(chunk)
        return
      }

      // Sequências meta do xterm — chegam como chunk PRÓPRIO, separado das
      // teclas, e não editam a linha:
      //   \x1b[I / \x1b[O  → relatórios de foco (o ConPTY ativa ?1004h em toda
      //     sessão; o term.focus() ao abrir/trocar de aba emite ESC[I, que
      //     antes "envenenava" o tracker e quebrava o 1º /help de cada aba)
      //   \x1b[200~ / \x1b[201~ → moldura de colagem (paste). Conteúdo colado
      //     não é rastreável: o tracker desiste e o Enter vai pro shell
      if (chunk === '\u001b[I' || chunk === '\u001b[O') {
        window.electron.pty.write(id, chunk)
        return
      }
      // Colagem (bracketed paste): o marcador \x1b[200~…\x1b[201~ é DO BASH
      // (?2004h) — encaminhamos o chunk INTACTO pro readline cuidar. Mas o
      // CONTEÚDO colado passa a contar como digitação no tracker: colar
      // "/cmd add …" e teclar Enter volta a disparar os interceptores (bug
      // real: antes o marcador "envenenava" o tracker e o Enter caía pro
      // bash → "bash: /cmd: Is a directory"). Colagem com quebras internas
      // de linha fica guardada com \r no rastreio — o Enter a ignora (o
      // guard abaixo) e o bash decide, como numa colagem comum.
      if (chunk.includes('\u001b[200~') || chunk.includes('\u001b[201~')) {
        window.electron.pty.write(id, chunk) // intacto: readline cuida da colagem
        for (const ch of chunk.replaceAll('\u001b[200~', '').replaceAll('\u001b[201~', '')) {
          if (ch === '\r' || ch === '\n') {
            if (line.length < 1024) line += '\r'
          } else if (ch >= ' ' && ch <= '~') {
            if (line.length < 1024) line += ch
            else trackable = false
          } // demais controles da colagem: fora do rastreio
        }
        return
      }

      let fwd = ''
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          // guard: \r interno (colagem multilinha) ⇒ deixa o bash decidir.
          // trim() sozinho resolve a colagem de UMA linha que copiou \r final.
          const candidate = trackable ? line.trim() : ''
          const entered = candidate.includes('\r') ? '' : candidate
          line = ''
          trackable = true
          if (isInternalCommand(entered)) {
            // O bash NÃO chama command_not_found_handle para comandos com "/"
            // no nome ("No such file or directory" ≠ "command not found") —
            // repro3 provou: handler definido + env ok + /help ainda assim
            // falhando. Então pedimos ao bash, em idioma dele:
            //   Ctrl+U     → apaga a linha "/help" pendente no readline
            //   " cat …\r" → com espaço inicial (ignorespace do HISTCONTROL),
            //                roda FORA do histórico e imprime a ajuda com o
            //                alinhamento nativo do próprio shell.
            fwd += '\u0015' + ' cat "$AURORA_HELP_ANSI"\r'
            continue
          }
          // /cmd — gerenciamento de comandos personalizados: aplica a
          // diretiva, o main persiste + regenera o relatório, e O PRÓPRIO
          // bash o imprime (alinhado; o cat só acontece DEPOIS do resolve).
          if (entered === '/cmd' || entered.startsWith('/cmd ')) {
            if (commandsReady) runCmdDirective(entered)
            // registro ainda carregando: nada a fazer — o Enter segue reto
            // pro bash (caso raríssimo de corrida nos primeiros ~10ms)
            if (!commandsReady) fwd += ch
            continue
          }
          // Comando personalizado: troca a linha digitada pela expansão —
          // Ctrl+U apaga o nome, e o comando real entra no histórico limpo
          // (↑/editável depois). Sequências (array): uma linha `\r` por
          // passo — o bash roda cada qual no MESMO shell (cd persiste entre
          // os passos). Args extras: só anexam em definições de comando único.
          if (commandsReady && entered.length > 0) {
            const words = entered.split(/\s+/)
            const def = customCommands.find((c) => c.name === words[0])
            if (def) {
              const runs = Array.isArray(def.run) ? def.run.slice() : [def.run]
              if (runs.length === 1 && words.length > 1) {
                runs[0] = runs[0] + ' ' + words.slice(1).join(' ')
              }
              fwd += '\u0015' + runs.join('\r') + '\r'
              continue
            }
          }
          fwd += ch
        } else {
          fwd += ch
          if (ch === '\u007f') line = line.slice(0, -1)
          else if (ch === '\u0015') line = ''
          else if (ch >= ' ' && ch <= '~') {
            // era 64 — matava /cmd add com caminhos longos (bug real de
            // produção: linha >64 ficava não-rastreável e o Enter caía pro
            // bash → "bash: /cmd: Is a directory"). 1024 é generoso e
            // continua protegendo contra linhas absurdas.
            if (line.length < 1024) line += ch
            else trackable = false
          } else trackable = false // ESC/ctrl/setas: linha imprevisível
        }
      }
      if (fwd) window.electron.pty.write(id, fwd)
    }

    try {
      // Assina os canais ANTES de criar a sessão (não perde o 1º output)
      offData = window.electron.pty.onData(id, (data) => term.write(data))
      offExit = window.electron.pty.onExit(id, () => {
        shellAlive = false
        term.write('\r\n\x1b[2m— sessão encerrada — (comandos internos vivem: /help)\x1b[0m\r\n')
      })

      // Teclado: xterm → [intercepta internos] → shell da aba
      offTermData = term.onData(feed)

      // Grid recalculado → repassa as dimensões ao PTY da aba
      offTermResize = term.onResize(({ cols, rows }) => {
        window.electron.pty.resize(id, cols, rows)
      })

      // Cria a sessão desta aba já com o tamanho real da tela
      window.electron.pty.create(id, term.cols, term.rows)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      term.write(`\r\n\x1b[31m[ERRO ao inicializar o shell] ${msg}\x1b[0m\r\n`)
      term.write('\x1b[2m— comandos internos ainda funcionam: digite /help —\x1b[0m\r\n')
      shellAlive = false
    }

    // Janela redimensionada: só a aba VISÍVEL recalcula (uma oculta mediria 0x0)
    const onResize = (): void => {
      if (activeRef.current) fit.fit()
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      offCommandsUpdated()
      offTermData?.dispose()
      offTermResize?.dispose()
      offData?.()
      offExit?.()
      if (offData) window.electron.pty.dispose(id)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [id])

  // Abas ocultas ficam display:none (continuam vivas: scrollback e processos)
  return <div className={active ? 'pane pane--active' : 'pane'} ref={hostRef} />
}

export default Terminal
