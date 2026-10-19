import { useCallback, useEffect, useRef, useState } from 'react'
import Terminal from './Terminal'
import { THEMES, THEME_IDS, applyThemeVars, type ThemeId } from './themes'
import { isAppShortcut } from './shortcuts'

interface Tab {
  id: string
}

const FIRST_TAB_ID = 's1'
const DEFAULT_THEME: ThemeId = 'aurora-dark'
const DEFAULT_FONT_SIZE = 14
const MIN_FONT_SIZE = 6
const MAX_FONT_SIZE = 40

const clampFontSize = (size: number): number =>
  Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size))

function App() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: FIRST_TAB_ID }])
  const [activeId, setActiveId] = useState(FIRST_TAB_ID)
  const counter = useRef(1) // 's1' já existe

  // ─── Tema, fonte e neon ───────────────────────────────────────────────────
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [neon, setNeon] = useState(true)

  const applyTheme = useCallback((id: ThemeId): void => {
    setThemeId(id)
    applyThemeVars(id) // UI reage na hora via variáveis CSS
    window.electron.config.set({ theme: id }) // persiste no config.json
  }, [])

  const applyFontSize = useCallback((size: number): void => {
    const next = clampFontSize(size)
    setFontSize(next)
    window.electron.config.set({ fontSize: next }) // persiste no config.json
  }, [])

  // Boot: aplica as preferências salvas (lidas pelo main no userData)
  useEffect(() => {
    window.electron.config.get().then((cfg) => {
      const savedTheme = cfg.theme as ThemeId
      if ((THEME_IDS as readonly string[]).includes(savedTheme)) applyTheme(savedTheme)
      if (typeof cfg.fontSize === 'number') setFontSize(clampFontSize(cfg.fontSize))
      if (typeof cfg.neon === 'boolean') setNeon(cfg.neon)
    })
  }, [applyTheme])

  // Neon (v24): carimbo no <html> (a regra CSS consome) + persiste a nova
  // preferência. O halo em si é drop-shadow sobre o canvas do terminal —
  // a cor vem da paleta de cada tema.
  const toggleNeon = useCallback((): void => {
    setNeon((on) => !on)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.neon = neon ? 'on' : 'off'
    window.electron.config.set({ neon })
  }, [neon])

  // ─── Vidro determinístico: fundo = captura real da tela, borrada ────────
  const [glassBg, setGlassBg] = useState<string | null>(null)
  const [glassOffset, setGlassOffset] = useState({ x: 0, y: 0, w: 0, h: 0 })

  useEffect(() => {
    // v19: glass:bg agora chega ~1x/s (vidro vivo). Frames idênticos → mesma
    // string → nada acontece; só re-render quando o fundo MUDOU de verdade.
    const offBg = window.electron.glass.onBg((url) =>
      setGlassBg((prev) => (prev === url ? prev : url))
    )
    // v21: bounds chegam na cadência do mouse (100+ Hz num drag) e cada
    // setState repintaria a camada do vidro borrado. Coalescência rAF: o
    // último bounds do frame vence — 1 flush por frame de tela, no máx.
    let pendingBounds: { x: number; y: number; w: number; h: number } | null = null
    let rafId = 0
    const offBounds = window.electron.glass.onBounds((b) => {
      pendingBounds = b
      if (rafId === 0) {
        rafId = requestAnimationFrame(() => {
          rafId = 0
          if (pendingBounds) setGlassOffset(pendingBounds)
        })
      }
    })
    return () => {
      offBg()
      offBounds()
      if (rafId !== 0) cancelAnimationFrame(rafId)
    }
  }, [])

  // ─── Seletor de tema (botão ◐ na barra) ──────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  // ─── Abas ─────────────────────────────────────────────────────────────────
  const newTab = (): void => {
    counter.current += 1
    const id = `s${counter.current}`
    setTabs((current) => [...current, { id }])
    setActiveId(id)
  }

  const closeTab = (id: string): void => {
    if (tabs.length <= 1) return // a última aba fica
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const next = tabs.filter((t) => t.id !== id)
    setTabs(next)
    // fechou a aba ativa? ativa a vizinha
    if (id === activeId) setActiveId(next[Math.min(idx, next.length - 1)].id)
  }

  const activateRelativeTab = (delta: number): void => {
    const idx = tabs.findIndex((t) => t.id === activeId)
    if (idx === -1 || tabs.length < 1) return
    setActiveId(tabs[(idx + delta + tabs.length) % tabs.length].id)
  }

  // ─── Atalhos globais do app ──────────────────────────────────────────────
  const handleShortcut = (e: KeyboardEvent): void => {
    // Ctrl+R: busca no histórico é NATIVA do readline do bash (reverse-i-search).
    // Aqui só a protegemos da ação padrão do Chromium no Electron (reload da
    // página) — o preventDefault não impede o xterm de emitir o \x12, que
    // segue normal até o PTY e ativa a busca de verdade.
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'r') {
      e.preventDefault()
      return
    }
    if (!isAppShortcut(e)) return
    e.preventDefault()
    const key = e.key.toLowerCase()

    if (key === 't' && e.altKey) {
      // Ctrl+Alt+T — ciclar tema
      const idx = THEME_IDS.indexOf(themeId)
      applyTheme(THEME_IDS[(idx + 1) % THEME_IDS.length])
      return
    }
    if (key === 'n' && e.altKey) {
      toggleNeon() // Ctrl+Alt+N — neon das letras
      return
    }
    if (key === 't') {
      newTab() // Ctrl+T — nova aba
      return
    }
    if (key === 'w') {
      closeTab(activeId) // Ctrl+W — fechar aba atual (a última fica)
      return
    }
    if (key === 'tab') {
      activateRelativeTab(e.shiftKey ? -1 : 1) // Ctrl+Tab / Ctrl+Shift+Tab
      return
    }
    if (key === '+' || key === '=') {
      applyFontSize(fontSize + 1) // Ctrl+ +
      return
    }
    if (key === '-') {
      applyFontSize(fontSize - 1) // Ctrl+ -
      return
    }
    if (key === '0') {
      applyFontSize(DEFAULT_FONT_SIZE) // Ctrl+0 — resetar
    }
  }

  // Handler sempre fresco (lê o estado de cada render); o listener em si é
  // registrado apenas UMA vez — em capture, chegando antes do xterm.
  const shortcutRef = useRef(handleShortcut)
  useEffect(() => {
    shortcutRef.current = handleShortcut
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => shortcutRef.current(e)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="shell">
      {/* Camada de vidro: screenshot real da tela, borrado pelo Chromium e
          alinhado com o que está atrás da janela (via glass:bounds) */}
      {glassBg && (
        <div className="glass-bg" aria-hidden="true">
          <div
            className="glass-img"
            style={{
              width: glassOffset.w || undefined,
              height: glassOffset.h || undefined,
              backgroundImage: `url(${glassBg})`,
              transform: `translate(${-glassOffset.x}px, ${-glassOffset.y}px)`
            }}
          />
        </div>
      )}

      {/* Barra de abas = também a área de arraste da janela frameless */}
      <header className="tabbar">
        {tabs.map((tab, i) => (
          <div
            key={tab.id}
            className={tab.id === activeId ? 'tab tab--active' : 'tab'}
            onClick={() => setActiveId(tab.id)}
            title="Clique para ativar esta aba"
          >
            <span className="tab-title">bash {i + 1}</span>
            {tabs.length > 1 && (
              <button
                className="tab-close"
                title="Fechar aba (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}

        <button className="tab-new" title="Nova aba (Ctrl+T)" onClick={newTab}>
          +
        </button>

        {/* restante da barra: arrasta a janela (duplo clique maximiza) */}
        <div className="tabbar-drag" />

        {/* seletor de tema — canto direito da barra */}
        <div className="theme-picker" ref={pickerRef}>
          <button
            className="theme-btn"
            title="Tema (Ctrl+Alt+T para ciclar)"
            onClick={(e) => {
              e.stopPropagation()
              setPickerOpen((open) => !open)
            }}
          >
            ◐
          </button>

          {pickerOpen && (
            <div className="picker">
              {THEME_IDS.map((id) => (
                <button
                  key={id}
                  className="picker-item"
                  onClick={() => {
                    applyTheme(id)
                    setPickerOpen(false)
                  }}
                >
                  <span
                    className="picker-dot"
                    style={{
                      background: `linear-gradient(135deg, ${THEMES[id].vars['--brand-from']}, ${THEMES[id].vars['--brand-to']})`
                    }}
                  />
                  {THEMES[id].label}
                  {id === themeId && <span className="picker-check">✓</span>}
                </button>
              ))}
              <div className="picker-hint">Ctrl+Alt+T troca de tema</div>
            </div>
          )}
        </div>

        {/* fecha a janela (frameless não tem o botão do Windows) */}
        <button
          className="window-close"
          title="Fechar"
          onClick={() => window.electron.window.close()}
        >
          ✕
        </button>
      </header>

      {/* Um pane por aba, todos montados; só a ativa aparece.
          Manter montados preserva scrollback e o processo de cada sessão. */}
      <div className="panes">
        {tabs.map((tab) => (
          <Terminal
            key={tab.id}
            id={tab.id}
            active={tab.id === activeId}
            theme={THEMES[themeId].xterm}
            fontSize={fontSize}
          />
        ))}
      </div>
    </div>
  )
}

export default App
