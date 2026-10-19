// ─── probe-vidro.cjs — O VEREDITO do vidro vivo ────────────────────────────
// Pergunta: nesta máquina, a exclusão de captura (EXCLUDEFROMCAPTURE) que o
// app marca na própria janela está (a) realmente aplicada e (b) respeitada
// por uma captura GDI (BitBlt — o mecanismo do PrintScreen)?
//
//   affinity 0x11 + região clara  → GDI respeita → dá pra fazer o vidro
//                                   vivo capturando por GDI/koffi
//   affinity 0x11 + região escura → exclusão aplicada mas ignorada na
//                                   captura → WDA inútil nesta máquina
//   affinity 0x0                  → o app NÃO conseguiu marcar a janela
//                                   → fix é re-aplicar após a janela aparecer
//
// Como: acha a janela "Aurora Terminal", lê a affinity REAL (de fora),
// captura a tela inteira por BitBlt e mede a luminância da região embaixo
// dela. Prepare o cenário antes: página BRANCA maximizada atrás do
// terminal (tela toda branca, terminal flutuando por cima) — assim
// "excluído" = branco (~240) e "capturado" = vidro escuro do app (~60-120).
// Salva gdi-probe.bmp para auditoria pixel-a-pixel.

const koffi = require('koffi')
const fs = require('node:fs')

const user32 = koffi.load('user32.dll')
const gdi32 = koffi.load('gdi32.dll')

const FindWindowW = user32.func('void * __stdcall FindWindowW(void *cls, str16 title)')
const GetWindowDisplayAffinity = user32.func(
  'int32_t __stdcall GetWindowDisplayAffinity(void *hwnd, uint32_t *affinity)'
)
const GetWindowRect = user32.func('int32_t __stdcall GetWindowRect(void *hwnd, void *rect)')
const GetSystemMetrics = user32.func('int32_t __stdcall GetSystemMetrics(int32_t index)')
const GetDC = user32.func('void * __stdcall GetDC(void *hwnd)')
const ReleaseDC = user32.func('int32_t __stdcall ReleaseDC(void *hwnd, void *dc)')
const CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void *dc)')
const CreateCompatibleBitmap = gdi32.func(
  'void * __stdcall CreateCompatibleBitmap(void *dc, int32_t w, int32_t h)'
)
const SelectObject = gdi32.func('void * __stdcall SelectObject(void *dc, void *obj)')
const DeleteObject = gdi32.func('int32_t __stdcall DeleteObject(void *obj)')
const DeleteDC = gdi32.func('int32_t __stdcall DeleteDC(void *dc)')
const BitBlt = gdi32.func(
  'int32_t __stdcall BitBlt(void *dst, int32_t x, int32_t y, int32_t w, int32_t h, void *src, int32_t sx, int32_t sy, uint32_t rop)'
)
const GetDIBits = gdi32.func(
  'int32_t __stdcall GetDIBits(void *dc, void *bmp, uint32_t start, uint32_t lines, void *bits, void *bmi, uint32_t usage)'
)

// ── 1. tela virtual inteira (todos os monitores) — referência de coordenadas
const vx = GetSystemMetrics(76)
const vy = GetSystemMetrics(77)
const vw = GetSystemMetrics(78)
const vh = GetSystemMetrics(79)
console.log(
  `tela virtual: ${vw}x${vh} @ (${vx},${vy}) · primária física: ${GetSystemMetrics(0)}x${GetSystemMetrics(1)}`
)

// ── 2. a janela do app (sem ela, vira pré-voo do pipeline GDI) ──────────────
let hwnd = FindWindowW(null, 'Aurora Terminal')
if (!hwnd) hwnd = FindWindowW(null, 'Aurora')
let wr
let aff = -1
if (hwnd) {
  console.log('✓ janela encontrada')

  // affinity REAL carregada pela janela (o app é quem marcou)
  const affOut = Buffer.alloc(4)
  const gotAff = GetWindowDisplayAffinity(hwnd, affOut)
  aff = affOut.readUInt32LE(0)
  if (!gotAff) {
    console.log('⚠ GetWindowDisplayAffinity FALHOU — não dá nem pra ler a affinity.')
  } else if (aff === 0x11) {
    console.log('✓ janela MARCADA com EXCLUDEFROMCAPTURE (0x11) — o app aplicou certo')
  } else {
    console.log(
      `⚠ affinity da janela = 0x${aff.toString(16)} (esperado 0x11) → o app NÃO marcou a exclusão — causa raiz é ESSA!`
    )
  }

  const rect = Buffer.alloc(16)
  GetWindowRect(hwnd, rect)
  wr = {
    left: rect.readInt32LE(0),
    top: rect.readInt32LE(4),
    right: rect.readInt32LE(8),
    bottom: rect.readInt32LE(12)
  }
  console.log(`janela: ${wr.right - wr.left}x${wr.bottom - wr.top} @ (${wr.left},${wr.top})`)
} else {
  console.log('⚠ janela "Aurora Terminal" NÃO encontrada — modo pré-voo do pipeline GDI')
  console.log('  (veredito abaixo NÃO vale: abra o app e rode de novo)')
  const cx = vx + Math.floor(vw / 2)
  const cy = vy + Math.floor(vh / 2)
  wr = { left: cx - 400, top: cy - 250, right: cx + 400, bottom: cy + 250 }
}

// ── 5. BitBlt da tela → buffer BGRA top-down ────────────────────────────────
const hdcScreen = GetDC(null)
const hdcMem = CreateCompatibleDC(hdcScreen)
const hbm = CreateCompatibleBitmap(hdcScreen, vw, vh)
const old = SelectObject(hdcMem, hbm)
const SRCCOPY = 0x00cc0020
const CAPTUREBLT = 0x40000000
const blitted = BitBlt(hdcMem, 0, 0, vw, vh, hdcScreen, vx, vy, SRCCOPY | CAPTUREBLT)
if (!blitted) {
  console.log('⚠ BitBlt falhou')
  process.exit(1)
}
// BITMAPINFOHEADER empacotado na mão: 32bpp, BI_RGB, top-down (biHeight<0)
const bmi = Buffer.alloc(44)
bmi.writeUInt32LE(40, 0)
bmi.writeInt32LE(vw, 4)
bmi.writeInt32LE(-vh, 8)
bmi.writeUInt16LE(1, 12)
bmi.writeUInt16LE(32, 14)
bmi.writeUInt32LE(0, 16)
const bits = Buffer.alloc(vw * vh * 4)
const got = GetDIBits(hdcScreen, hbm, 0, vh, bits, bmi, 0)
SelectObject(hdcMem, old)
DeleteObject(hbm)
DeleteDC(hdcMem)
ReleaseDC(null, hdcScreen)
if (got !== vh) {
  console.log(`⚠ GetDIBits retornou ${got} de ${vh} linhas`)
  process.exit(1)
}
console.log('✓ BitBlt + GetDIBits: captura GDI completa')

// ── 6. luminância dentro da região da janela vs anel ao redor ──────────────
function lumAt(x, y) {
  const px = ((y - vy) * vw + (x - vx)) * 4
  return 0.299 * bits[px + 2] + 0.587 * bits[px + 1] + 0.114 * bits[px]
}
let inSum = 0
let inN = 0
for (let y = wr.top + 8; y < wr.bottom - 8; y += 16) {
  for (let x = wr.left + 8; x < wr.right - 8; x += 16) {
    inSum += lumAt(x, y)
    inN++
  }
}
const M = 60 // anel 60px pra fora da janela = o que dá pra ver da página branca
let outSum = 0
let outN = 0
for (let y = wr.top - M; y < wr.bottom + M; y += 24) {
  for (let x = wr.left - M; x < wr.right + M; x += 24) {
    const dentroJanela = x >= wr.left && x < wr.right && y >= wr.top && y < wr.bottom
    const dentroTela = x >= vx && y >= vy && x < vx + vw && y < vy + vh
    if (dentroJanela || !dentroTela) continue
    outSum += lumAt(x, y)
    outN++
  }
}
const inAvg = inN ? inSum / inN : -1
const outAvg = outN ? outSum / outN : -1
console.log(`luminância DENTRO da janela: ${inAvg.toFixed(1)} (${inN} amostras)`)
console.log(`luminância no ANEL ao redor: ${outAvg.toFixed(1)} (${outN} amostras)`)

// ── 7. BMP de auditoria (bottom-up) pra eu decodificar pixel-a-pixel ────────
const rowSize = vw * 4
const imgSize = rowSize * vh
const bmpHeader = Buffer.alloc(54)
bmpHeader.write('BM', 0)
bmpHeader.writeUInt32LE(54 + imgSize, 2)
bmpHeader.writeUInt32LE(54, 10)
bmpHeader.writeUInt32LE(40, 14)
bmpHeader.writeInt32LE(vw, 18)
bmpHeader.writeInt32LE(vh, 22)
bmpHeader.writeUInt16LE(1, 26)
bmpHeader.writeUInt16LE(32, 28)
bmpHeader.writeUInt32LE(0, 30)
bmpHeader.writeUInt32LE(imgSize, 34)
const flipped = Buffer.alloc(imgSize)
for (let row = 0; row < vh; row++) {
  bits.copy(flipped, (vh - 1 - row) * rowSize, row * rowSize, (row + 1) * rowSize)
}
fs.writeFileSync('gdi-probe.bmp', Buffer.concat([bmpHeader, flipped]))
console.log(`gdi-probe.bmp salvo (${((54 + imgSize) / 1024 / 1024).toFixed(1)} MB)`)

// ── 8. veredito ─────────────────────────────────────────────────────────────
if (aff < 0) {
  console.log('PRÉ-VOO OK — o pipeline GDI inteiro funcionou (BitBlt→GetDIBits→BMP).')
  process.exit(0)
}
const gap = outAvg - inAvg
if (inAvg > 170) {
  console.log('VEREDITO: EXCLUÍDO — a região da janela está CLARA: o GDI mostra')
  console.log('  o que há ATRÁS (página branca). Vidro vivo VIÁVEL capturando por GDI/koffi.')
} else if (inAvg < 160 && gap > 50) {
  console.log('VEREDITO: CAPTURADO — a região da janela está ESCURA: o próprio')
  console.log('  terminal (vidro escuro) entrou na captura. A exclusão NÃO remove a janela.')
  if (aff !== 0x11) console.log('  (coerente: a affinity nem estava aplicada — fix no app!)')
} else {
  console.log('VEREDITO AMBÍGUO — cenário mal posicionado? Conferir:')
  console.log('  · tela toda branca atrás do terminal?')
  console.log('  · gdi-probe.bmp salvo pra análise manual.')
}
