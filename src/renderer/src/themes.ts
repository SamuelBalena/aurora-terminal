import type { ITheme } from '@xterm/xterm'

// Cada tema define: variáveis CSS (interface) + paleta xterm (terminal).
// Glassmorphism: com a janela transparente + acrylic do Windows 11
// (backgroundMaterial no main), as cores abaixo são TINTAS TRANSLÚCIDAS —
// a área de trabalho borrada do sistema aparece por trás delas.

export interface Theme {
  label: string
  /** Variáveis CSS aplicadas no <html> — a interface toda consome via var() */
  vars: Record<string, string>
  /** Paleta do xterm.js (background em RGBA = vidro por trás do terminal) */
  xterm: ITheme
}

export const THEME_IDS = ['aurora-dark', 'aurora-rose', 'dracula', 'catppuccin-mocha'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export const THEMES: Record<ThemeId, Theme> = {
  'aurora-dark': {
    label: 'Aurora Dark',
    vars: {
      '--bg': 'rgba(13, 17, 23, 0.55)', // tinta do terminal/abas ativas sobre o vidro
      '--fg': '#c9d1d9',
      '--chrome-bg': 'rgba(13, 17, 23, 0.55)', // MESMA tinta do corpo: barra e terminal iguais
      '--chrome-hover': 'rgba(255, 255, 255, 0.08)', // brilho sutil universal
      '--chrome-border': 'rgba(48, 54, 61, 0.9)',
      '--tab-fg': '#8b949e',
      '--brand-from': '#7ee0c0',
      '--brand-to': '#a78bfa',
      '--danger': '#da3633',
      '--neon': 'rgba(126, 224, 192, 0.55)' // halo neon das letras (teal da marca)
    },
    xterm: {
      background: '#00000000', // alfa EXPLÍCITO (v3): 100% transparente — quem pinta é o .shell (uma camada só)
      foreground: '#c9d1d9',
      cursor: '#c9d1d9',
      selectionBackground: '#264f78cc',
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc'
    }
  },

  // Aurora Rosé: vidro BRANCO (frosted), barra clara e letras/acerves em
  // vermelho e rosa. ANSI calibrado para fundo claro (tons escuros legíveis).
  'aurora-rose': {
    label: 'Aurora Rosé',
    vars: {
      '--bg': 'rgba(244, 240, 243, 0.6)', // vidro branco-esverdeado pro rosé
      '--fg': '#3d2b33',
      '--chrome-bg': 'rgba(244, 240, 243, 0.6)', // MESMA tinta do corpo: barra e terminal iguais
      '--chrome-hover': 'rgba(0, 0, 0, 0.06)',
      '--chrome-border': 'rgba(214, 157, 171, 0.55)',
      '--tab-fg': '#9d6b7a',
      '--brand-from': '#f43f5e',
      '--brand-to': '#fb7185',
      '--danger': '#dc2626',
      '--neon': 'rgba(244, 63, 94, 0.3)' // rosé suave — fundo branco pede neon discreto
    },
    xterm: {
      background: '#00000000',
      foreground: '#3d2b33',
      cursor: '#f43f5e',
      selectionBackground: '#fda4afcc',
      black: '#4a3f45',
      red: '#e11d48',
      green: '#3e7d5a',
      yellow: '#a87700',
      blue: '#6f56a8',
      magenta: '#ec4899',
      cyan: '#2b7f8f',
      white: '#3f3a3e',
      brightBlack: '#9b8f95',
      brightRed: '#f43f5e',
      brightGreen: '#2f7d4f',
      brightYellow: '#946d00',
      brightBlue: '#8a63c9',
      brightMagenta: '#ff7fa8',
      brightCyan: '#1f6d7c',
      brightWhite: '#716a6e'
    }
  },

  dracula: {
    label: 'Dracula',
    vars: {
      '--bg': 'rgba(40, 42, 54, 0.55)',
      '--fg': '#f8f8f2',
      '--chrome-bg': 'rgba(40, 42, 54, 0.55)', // MESMA tinta do corpo: barra e terminal iguais
      '--chrome-hover': 'rgba(255, 255, 255, 0.08)',
      '--chrome-border': 'rgba(68, 71, 90, 0.9)',
      '--tab-fg': '#6272a4',
      '--brand-from': '#ff79c6',
      '--brand-to': '#bd93f9',
      '--danger': '#ff5555',
      '--neon': 'rgba(189, 147, 249, 0.6)' // purple icônico do Dracula
    },
    xterm: {
      background: '#00000000', // alfa EXPLÍCITO (v3): 100% transparente — quem pinta é o .shell (uma camada só)
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475acc',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa3',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },

  'catppuccin-mocha': {
    label: 'Catppuccin Mocha',
    vars: {
      '--bg': 'rgba(30, 30, 46, 0.55)',
      '--fg': '#cdd6f4',
      '--chrome-bg': 'rgba(30, 30, 46, 0.55)', // MESMA tinta do corpo: barra e terminal iguais
      '--chrome-hover': 'rgba(255, 255, 255, 0.08)',
      '--chrome-border': 'rgba(88, 91, 112, 0.9)',
      '--tab-fg': '#a6adc8',
      '--brand-from': '#cba6f7',
      '--brand-to': '#f5c2e7',
      '--danger': '#f38ba8',
      '--neon': 'rgba(203, 166, 247, 0.55)' // lilac do Mocha
    },
    xterm: {
      background: '#00000000', // alfa EXPLÍCITO (v3): 100% transparente — quem pinta é o .shell (uma camada só)
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#585b70cc',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#eb7878',
      brightGreen: '#b1e9a7',
      brightYellow: '#f9e2af',
      brightBlue: '#a5b5fc',
      brightMagenta: '#f0b6d8',
      brightCyan: '#a3e5d3',
      brightWhite: '#ffffff'
    }
  }
}

// Aplica as variáveis CSS do tema direto no <html> — a UI inteira reage
// na hora, sem recarregar nada.
export function applyThemeVars(id: ThemeId): void {
  // carimbo no <html>: o CSS usa [data-aurora-theme='aurora-gradient'] para
  // aplicar o véu de gradiente nas letras do terminal
  document.documentElement.dataset.auroraTheme = id
  for (const [key, value] of Object.entries(THEMES[id].vars)) {
    document.documentElement.style.setProperty(key, value)
  }
}
