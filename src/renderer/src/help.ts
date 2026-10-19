import type { Terminal } from '@xterm/xterm'
import { buildHelpText } from '../../shared/helpText'

// O texto da ajuda vive em src/shared/helpText.ts: o renderer usa quando a
// sessão está MORTA (a tela é toda nossa, impressão local é segura); com o
// bash vivo, quem imprime é o próprio shell (command_not_not_found_handle
// injetado pelo main) — assim o readline dele nunca desalinha CADA linha.

export { buildHelpText }

type InternalHandler = (term: Terminal) => void

const INTERNAL_COMMANDS: Record<string, InternalHandler> = {
  '/help': (term) => term.write(buildHelpText())
}

/** A linha digitada é um comando interno do terminal? */
export function isInternalCommand(line: string): boolean {
  return Object.prototype.hasOwnProperty.call(INTERNAL_COMMANDS, line)
}

/** Executa um comando interno. Retorna false se a linha não for um deles. */
export function runInternalCommand(term: Terminal, line: string): boolean {
  const handler = INTERNAL_COMMANDS[line]
  if (!handler) return false
  handler(term)
  return true
}
