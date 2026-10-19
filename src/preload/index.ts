import { contextBridge, ipcRenderer } from 'electron'

// Ponte xterm de cada aba (renderer) ⇄ sessões PTY (main).
// Toda chamada carrega o id da aba; eventos voltam marcados com o mesmo id.
const pty = {
  create: (id: string, cols: number, rows: number): void => {
    ipcRenderer.send('pty:create', id, cols, rows)
  },

  write: (id: string, data: string): void => {
    ipcRenderer.send('pty:write', id, data)
  },

  resize: (id: string, cols: number, rows: number): void => {
    ipcRenderer.send('pty:resize', id, cols, rows)
  },

  // Não mata na hora (ver debounce no main): usada ao desmontar a aba
  dispose: (id: string): void => {
    ipcRenderer.send('pty:dispose', id)
  },

  // Recarga completa da página: derruba as sessões órfãs do load anterior.
  // Chamado em module scope do main.tsx, antes de qualquer aba montar.
  resetAll: (): void => {
    ipcRenderer.send('pty:reset-all')
  },

  // Saída do shell da aba `id` → xterm. Retorna função de dessubscrição.
  onData: (id: string, callback: (data: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, sessionId: string, data: string): void => {
      if (sessionId === id) callback(data)
    }
    ipcRenderer.on('pty:data', listener)
    return () => ipcRenderer.off('pty:data', listener)
  },

  // Shell da aba `id` encerrou (ex.: `exit`)
  onExit: (id: string, callback: () => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, sessionId: string): void => {
      if (sessionId === id) callback()
    }
    ipcRenderer.on('pty:exit', listener)
    return () => ipcRenderer.off('pty:exit', listener)
  }
}

// Config do usuário (config.json em userData) — lido no boot, salvo a cada troca
const config = {
  get: (): Promise<{ theme: string; fontSize: number; neon: boolean }> =>
    ipcRenderer.invoke('config:get') as Promise<{ theme: string; fontSize: number; neon: boolean }>,
  set: (patch: { theme?: string; fontSize?: number; neon?: boolean }): void => {
    ipcRenderer.send('config:set', patch)
  }
}

// Controles da janela (frameless: os botões são nossos)
const window = {
  close: (): void => {
    ipcRenderer.send('window:close')
  }
}

// Vidro determinístico: captura da tela (destruida em JPEG) + posição da
// janela em relação ao display — o renderer alinha o fundo borrado.
const glass = {
  onBg: (callback: (url: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('glass:bg', listener)
    return () => ipcRenderer.off('glass:bg', listener)
  },
  onBounds: (
    callback: (b: { x: number; y: number; w: number; h: number }) => void
  ): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      b: { x: number; y: number; w: number; h: number }
    ) => callback(b)
    ipcRenderer.on('glass:bounds', listener)
    return () => ipcRenderer.off('glass:bounds', listener)
  }
}

// Comandos personalizados (/cmd): main persiste em userData/custom-commands.json
// e devolve o relatório ANSI — impresso pelo bash (vivo) ou local (morto).
type ManagedCommand = { name: string; run: string | string[] }

const commands = {
  get: (): Promise<{ commands: ManagedCommand[] }> =>
    ipcRenderer.invoke('commands:get') as Promise<{ commands: ManagedCommand[] }>,
  save: (payload: { list: ManagedCommand[]; action: string }): Promise<string> =>
    ipcRenderer.invoke('commands:save', payload) as Promise<string>,
  onUpdated: (callback: (data: { commands: ManagedCommand[] }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: { commands: ManagedCommand[] }): void =>
      callback(data)
    ipcRenderer.on('commands:updated', listener)
    return () => ipcRenderer.off('commands:updated', listener)
  }
}

// Copiar/colar: clipboard Nativo via IPC (o do renderer é imprevisível)
const clipboard = {
  readText: (): Promise<string> =>
    ipcRenderer.invoke('clipboard:readText') as Promise<string>,
  writeText: (text: string): void => {
    ipcRenderer.send('clipboard:writeText', text)
  }
}

contextBridge.exposeInMainWorld('electron', { pty, config, window, glass, commands, clipboard })
