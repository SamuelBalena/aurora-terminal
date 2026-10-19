// Atalhos que pertencem ao APP — nunca devem chegar ao shell dentro do xterm.
// Cada Terminal registra este predicado via attachCustomKeyEventHandler, e o
// App trata os mesmos atalhos num keydown global (fase de captura).
export function isAppShortcut(e: {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  key: string
}): boolean {
  if (e.metaKey) return false // atalhos do app são todos via Ctrl

  // Ctrl+Alt+T — ciclar tema · Ctrl+Alt+N — liga/desliga o neon (únicos c/ Alt)
  if (e.altKey) return e.ctrlKey && ['t', 'n'].includes(e.key.toLowerCase())

  if (!e.ctrlKey) return false

  const k = e.key.toLowerCase()
  // Ctrl+R (busca no histórico) fica DE FORA deliberadamente: é do readline
  // do bash — nossa lição gravada em cimento: quem é do readline, o
  // readline faz. O App só bloqueia o reload padrão do Chromium (o byte
  // \x12 segue seu curso até o PTY normalmente).
  return (
    k === 't' || // nova aba
    k === 'w' || // fechar aba atual
    k === 'tab' || // próxima aba / anterior (Ctrl+Tab, Ctrl+Shift+Tab)
    k === '+' || // aumentar fonte (Ctrl+Shift+= também cai aqui)
    k === '=' ||
    k === '-' || // diminuir fonte
    k === '0' // resetar fonte
  )
}
