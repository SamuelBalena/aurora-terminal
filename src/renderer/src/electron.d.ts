// Tipos do que o preload expõe em window.electron
// (mantém o autocomplete e o type-check do lado do renderer)

export interface PtyApi {
  create(id: string, cols: number, rows: number): void
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  dispose(id: string): void
  resetAll(): void
  onData(id: string, callback: (data: string) => void): () => void
  onExit(id: string, callback: () => void): () => void
}

export interface ConfigApi {
  get(): Promise<{ theme: string; fontSize: number }>
  set(patch: { theme?: string; fontSize?: number }): void
}

export interface WindowApi {
  close(): void
}

export interface GlassApi {
  onBg(callback: (url: string) => void): () => void
  onBounds(callback: (b: { x: number; y: number; w: number; h: number }) => void): () => void
}

export interface ManagedCommand {
  name: string
  run: string | string[]
}

export interface CommandsApi {
  get(): Promise<{ commands: ManagedCommand[] }>
  save(payload: { list: ManagedCommand[]; action: string }): Promise<string>
  onUpdated(callback: (data: { commands: ManagedCommand[] }) => void): () => void
}

export interface ClipboardApi {
  readText(): Promise<string>
  writeText(text: string): void
}

declare global {
  interface Window {
    electron: {
      pty: PtyApi
      config: ConfigApi
      window: WindowApi
      glass: GlassApi
      commands: CommandsApi
      clipboard: ClipboardApi
    }
  }
}

export {}
