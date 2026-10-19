// Texto da ajuda do Aurora — compartilhado entre o renderer (imprime no xterm
// quando a sessão está morta) e o main (grava o .ansi que o bash exibe via
// ` cat` quando a sessão está viva).

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'

type Section = [title: string, entries: Array<[cmd: string, desc: string]>]

const SECTIONS: Section[] = [
  [
    'NAVEGAÇÃO',
    [
      ['cd <pasta>', 'vai para a pasta (cd .. volta uma; cd - volta à anterior)'],
      ['ls', 'lista o conteúdo da pasta (-la: detalhado, com ocultos)'],
      ['pwd', 'mostra em qual pasta você está'],
      ['clear', 'limpa a tela (atalho: Ctrl+L)']
    ]
  ],
  [
    'ARQUIVOS & PASTAS',
    [
      ['mkdir <nome>', 'cria pasta'],
      ['touch <arquivo>', 'cria arquivo vazio'],
      ['cp / mv', 'copia / move (ou renomeia); -r para pastas'],
      ['rm', 'apaga arquivo — rm -rf apaga pasta (sem volta!)'],
      ['cat / less', 'mostra arquivo (less: pagina; sair com q)'],
      ['nano / vim', 'editores de texto direto no terminal']
    ]
  ],
  [
    'GIT',
    [
      ['git status', 'o que mudou no projeto'],
      ['git add -A', 'prepara todas as mudanças para commit'],
      ['git commit -m "…"', 'grava a versão com uma mensagem'],
      ['git push / pull', 'envia / baixa do repositório remoto'],
      ['git branch / switch', 'lista / troca de branch'],
      ['git log --oneline', 'histórico resumido do projeto']
    ]
  ],
  [
    'SISTEMA & PROCESSOS',
    [
      ['htop / top', 'monitor de processos ao vivo (sair: q ou F10)'],
      ['ps aux | grep <x>', 'procura um processo pelo nome'],
      ['kill <pid>', 'encerra um processo'],
      ['df -h', 'quanto espaço livre resta no disco'],
      ['du -sh *', 'tamanho de cada item da pasta atual'],
      ['uname -a', 'informações do sistema']
    ]
  ],
  [
    'OUTROS ÚTEIS',
    [
      ['grep -ri "<x>" .', 'busca um texto na pasta (i: ignora maiúsculas)'],
      ['find . -name "<x>"', 'acha arquivos pelo nome'],
      ['curl / ssh', 'requisições HTTP / terminal remoto'],
      ['history | tail', 'últimos comandos digitados'],
      ['man <comando>', 'manual completo de qualquer comando']
    ]
  ],
  [
    'ATALHOS DO AURORA TERMINAL',
    [
      ['Ctrl+T', 'abre uma nova aba'],
      ['Ctrl+W', 'fecha a aba atual (a última sempre fica)'],
      ['Ctrl+Tab', 'próxima aba (Ctrl+Shift+Tab: anterior)'],
      ['Ctrl + +', 'aumenta a fonte'],
      ['Ctrl + -', 'diminui a fonte'],
      ['Ctrl + 0', 'fonte de volta ao padrão'],
      ['Ctrl+Alt+T', 'troca o tema (◐ na barra: menu com preview)'],
      ['Ctrl+Alt+N', 'liga/desliga o NEON das letras'],
      ['Ctrl+R', 'busca no histórico digitando (Enter executa; Esc sai)'],
      ['Ctrl+C / Ctrl+V', 'copia a seleção (sem seleção: interrompe) / cola'],
      ['Ctrl+A', 'seleciona o COMANDO (sem o prompt) — de novo: todo o texto'],
      ['Backspace/Del com seleção', 'apaga o comando TODO de uma vez (Ctrl+U)'],
      ['Shift+Insert / botão direito', 'cola / copia↔cola pela seleção'],
      ['Duplo clique na barra', 'maximiza ou restaura a janela'],
      ['/cmd add <nome> <cmds…>', 'cria um comando SEU; use ; p/ sequência: /cmd add start cd proj; npm i; npm run dev'],
      ['/cmd list · /cmd rm <nome>', 'lista e remove comandos personalizados'],
      ['/help', 'mostra esta ajuda — até sem shell conectado']
    ]
  ]
]

export function buildHelpText(): string {
  const out: string[] = []
  const RULE = 56

  // banner
  out.push('')
  out.push(`  ${DIM}${'─'.repeat(RULE)}${RESET}`)
  out.push(`  ${BOLD}${CYAN}✦ AURORA TERMINAL${RESET}  ${DIM}— comandos & atalhos${RESET}`)
  out.push(`  ${DIM}digite /help a qualquer momento para rever${RESET}`)
  out.push(`  ${DIM}${'─'.repeat(RULE)}${RESET}`)

  // largura de coluna ÚNICA entre todas as seções: a borda esquerda das
  // descrições fica perfeitamente alinhada da primeira à última linha
  const width = Math.max(
    ...SECTIONS.flatMap(([, entries]) => entries.map(([cmd]) => cmd.length))
  )

  for (const [title, entries] of SECTIONS) {
    out.push('')
    out.push(`  ${BOLD}${CYAN}▸ ${title}${RESET}`)
    for (const [cmd, desc] of entries) {
      // comando em VERDE+BOLD, descrição na cor neutra do tema
      out.push(`    ${BOLD}${GREEN}${cmd.padEnd(width)}${RESET}  ${desc}`)
    }
  }

  // rodapé
  out.push('')
  out.push(`  ${DIM}${'─'.repeat(RULE)}${RESET}`)
  out.push(`  ${DIM}↑/↓ navegam pelo histórico · Ctrl+R busca · man <comando> = manual${RESET}`)
  out.push('')

  return out.join('\r\n')
}
