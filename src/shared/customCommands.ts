// ─────────────────────────────────────────────────────────────────────────────
// Comandos personalizados do Aurora — compartilhado entre main e renderer.
//
// O renderer intercepta o Enter (mesma maquinaria do /help), aplica a
// diretiva /cmd (ou expande um comando salvo) e o main grava o
// custom-commands.json + regenera o relatório ANSI que o próprio bash
// imprime via ` cat` — alinhado por construção, igual ao /help vivo.

export interface CustomCommand {
  name: string
  run: string | string[] // comando único, ou sequência (uma linha por comando)
}

export interface CmdDirectiveResult {
  list: CustomCommand[] // SEMPRE uma lista nova — entrada nunca é mutada
  action: string // linha de status/erro pra aparecer no relatório
  changed: boolean // true ⇒ main deve persistir
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/
const RED = '\x1b[31m'
const err = (msg: string): string => `${RED}${msg}\x1b[0m`

/** Divide em `;` de nível superior (fora de aspas) — p/ sequências:
 *  `/cmd add start cd proj; npm i; npm run dev` → 3 comandos em array. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (const c of input) {
    if (quote) {
      current += c
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
      current += c
    } else if (c === ';') {
      parts.push(current.trim())
      current = ''
    } else {
      current += c
    }
  }
  parts.push(current.trim())
  return parts.filter((p) => p.length > 0)
}

/** Aplica uma diretiva /cmd (`add`, `rm` ou `list`). Função pura. */
export function applyCmdDirective(current: CustomCommand[], words: string[]): CmdDirectiveResult {
  const cmd = (words[0] ?? 'list').toLowerCase()

  if (words.length === 0 || cmd === 'list') {
    const n = current.length
    return {
      list: current,
      action: n === 0 ? 'nenhum comando criado ainda' : `${n} comando(s) personalizado(s)`,
      changed: false
    }
  }

  if (cmd === 'add') {
    const name = words[1] ?? ''
    const run = words.slice(2).join(' ').trim()
    if (!NAME_RE.test(name)) {
      return {
        list: current,
        action: err(`nome inválido "${name}" — use letras, números, . _ -`),
        changed: false
      }
    }
    if (!run) {
      return {
        list: current,
        action: err(`sem comando pra "${name}" — uso: /cmd add <nome> <comando…>`),
        changed: false
      }
    }
    const existed = current.some((c) => c.name === name)
    // `;` de nível superior separa os passos → SEMPRE array no arquivo
    const segments = splitTopLevel(run)
    const list = [...current.filter((c) => c.name !== name), { name, run: segments }]
    return {
      list,
      action: existed
        ? `"${name}" atualizado → ${segments.join(' ; ')}`
        : `"${name}" criado → ${segments.join(' ; ')}`,
      changed: true
    }
  }

  if (cmd === 'rm') {
    const name = words[1] ?? ''
    const list = current.filter((c) => c.name !== name)
    if (list.length === current.length) {
      return { list: current, action: err(`"${name}" não existe`), changed: false }
    }
    return { list, action: `"${name}" removido`, changed: true }
  }

  return {
    list: current,
    action: err('subcomando inválido — uso: /cmd add <nome> <cmd…> · /cmd rm <nome> · /cmd list'),
    changed: false
  }
}

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'

/** Relatório ANSI — quem o imprime é o próprio bash (alinhado por construção). */
export function buildCmdReport(action: string, list: CustomCommand[], filePath: string): string {
  const rule = `  ${DIM}${'─'.repeat(58)}${RESET}`
  const out: string[] = []

  out.push('')
  out.push(rule)
  out.push(`  ${BOLD}${CYAN}✦ COMANDOS PERSONALIZADOS${RESET}`)
  out.push(`  ${action}`) // já pode vir com ANSI embutido (erros em vermelho)
  out.push(rule)

  if (list.length === 0) {
    out.push('')
    out.push(`  ${DIM}(nenhum comando — crie com /cmd add <nome> <comando…>)${RESET}`)
  } else {
    const width = Math.max(...list.map((c) => c.name.length))
    for (const c of list) {
      const runLabel = Array.isArray(c.run) ? c.run.join(`  ${DIM};${RESET} `) : c.run
      out.push(`    ${BOLD}${GREEN}${c.name.padEnd(width)}${RESET}  ${runLabel}`)
    }
  }

  out.push('')
  out.push(`  ${DIM}arquivo: ${filePath}${RESET}`)
  out.push(`  ${DIM}executa: digite o nome · sequências: use ";" no /cmd add${RESET}`)
  out.push('')

  return out.join('\r\n')
}
