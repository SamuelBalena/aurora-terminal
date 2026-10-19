// ═══════════════════════════════════════════════════════════════════════════
// GLASS LAB — descobre qual receita de vidro funciona NESTA máquina.
//
//   Uso: npx electron glasslab.cjs
//
// Abre 5 janelas com as receitas candidatas. Para cada letra, anote:
//   (1) VIDRO?  → o wallpaper atrás aparece BORRADO?
//   (2) RESIZE? → dá pra redimensionar arrastando as bordas?
//
//   Exemplo de resposta: "A: sem vidro, resize — B: vidro, sem resize —
//                         C: vidro, resize ok — D: normal — E: vidro fraco, resize"
// ═══════════════════════════════════════════════════════════════════════════
const { app, BrowserWindow } = require('electron')

function page(label, note) {
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
  <div style="height:100vh;box-sizing:border-box;background:rgba(13,17,23,0.68);
              color:#e6edf3;font:14px 'Segoe UI',sans-serif;display:flex;
              flex-direction:column;align-items:center;justify-content:center;gap:10px">
    <div style="font-size:26px;font-weight:700">RECEITA ${label}</div>
    <div style="opacity:.9">${note}</div>
    <div style="opacity:.65;font-size:12px;margin-top:14px;text-align:center;line-height:1.7">
      1. clique na janela pra focar<br>2. o wallpaper atrás está borrado?<br>3. arraste as bordas: redimensiona?<br>4. tem faixa/tira cinza esquisita?
    </div>
  </div></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

const RECIPES = [
  { label: 'A', note: 'acrylic + #00000000 (receita atual do app)', opts: { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' } },
  { label: 'B', note: 'transparent legacy (#00000000)', opts: { transparent: true, backgroundColor: '#00000000' } },
  { label: 'C', note: 'transparent legacy + acrylic (1ª tentativa)', opts: { transparent: true, backgroundColor: '#00000000', backgroundMaterial: 'acrylic' } },
  { label: 'D', note: 'controle opaco (janela normal)', opts: {} },
  { label: 'E', note: 'mica + #00000000 (vidro "sutil" do Fluent)', opts: { backgroundMaterial: 'mica', backgroundColor: '#00000000' } }
]

app.whenReady().then(() => {
  RECIPES.forEach((r, i) => {
    const win = new BrowserWindow({
      x: 40 + i * 460,
      y: 120,
      width: 440,
      height: 320,
      frame: false,
      show: true,
      title: 'Receita ' + r.label,
      ...r.opts
    })
    win.loadURL(page(r.label, r.note))
  })

  app.on('window-all-closed', () => app.quit())
})
