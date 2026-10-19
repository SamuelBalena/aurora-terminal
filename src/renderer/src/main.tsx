import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Recarga completa da página: derruba as sessões PTY órfãs do load anterior.
// Em module scope, roda antes de qualquer aba montar (e o reset é idempotente).
window.electron.pty.resetAll()

// Sem <StrictMode> por decisão consciente: o StrictMode monta→desmonta→remonta
// os componentes em dev, e os efeitos do Terminal gerenciam processos REAIS
// (spawn de PTY). O remonte com <2s de vida causava o "\r" fantasma no boot
// (linha vazia submetida → prompt duplicado) e corridas na fila do ConPTY.
// A limpeza é coberta pelos cleanups (dispose com debounce no main).
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
