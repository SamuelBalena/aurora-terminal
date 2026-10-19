// MEDIR — transforma print (PNG) em texto: mapa de faixas de cor.
// Uso:  node medir.cjs            → analisa o print mais recente do chat
//       node medir.cjs <arquivo>  → analisa um PNG específico
// Escreve medir.log (o Claude lê) — sem bibliotecas (zlib nativo do Node).
const fs = require('fs')
const zlib = require('zlib')
const path = require('path')

const DIR =
  'C:/Users/balen/AppData/Local/Temp/claude/c--Users-balen-Desktop-aurora-terminal/913df606-81fe-497b-a24b-527e8e9fb6f5/images'

function newestPng() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => ({ f, m: fs.statSync(path.join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return files.length ? path.join(DIR, files[0].f) : null
}

const file = process.argv[2] ?? newestPng()
if (!file || !fs.existsSync(file)) {
  console.log('nenhum PNG encontrado')
  process.exit(1)
}

const LOG = path.join(__dirname, 'medir.log')
fs.writeFileSync(LOG, `=== medir @ ${new Date().toISOString()} ===\n`, 'utf8')
const out = (m) => fs.appendFileSync(LOG, m + '\n', 'utf8')
out(`arquivo: ${file}`)

// ─── decodificador PNG mínimo (bitDepth 8, colorType 2/6, sem interlace) ───
const buf = fs.readFileSync(file)
if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
  out('não é PNG')
  process.exit(1)
}
let off = 8,
  w = 0,
  h = 0,
  bd = 0,
  ct = 0,
  interlace = 0
const idat = []
while (off < buf.length) {
  const len = buf.readUInt32BE(off)
  const type = buf.toString('ascii', off + 4, off + 8)
  const data = buf.subarray(off + 8, off + 8 + len)
  off += 12 + len
  if (type === 'IHDR') {
    w = data.readUInt32BE(0)
    h = data.readUInt32BE(4)
    bd = data[8]
    ct = data[9]
    interlace = data[12]
  } else if (type === 'IDAT') idat.push(data)
  else if (type === 'IEND') break
}
out(`dimensões: ${w}x${h} · bitDepth=${bd} · colorType=${ct} · interlace=${interlace}`)
if (bd !== 8 || (ct !== 2 && ct !== 6) || interlace === 1) {
  out('formato não suportado pelo medidor — me avisa')
  process.exit(1)
}

const bpp = ct === 6 ? 4 : 3
const stride = w * bpp
const raw = zlib.inflateSync(Buffer.concat(idat))
const rows = []
let prev = new Uint8Array(stride)
const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
for (let y = 0; y < h; y++) {
  const ptr = y * (stride + 1)
  const filter = raw[ptr]
  const curBuf = new Uint8Array(stride)
  for (let i = 0; i < stride; i++) {
    const rawByte = raw[ptr + 1 + i]
    const left = i >= bpp ? curBuf[i - bpp] : 0
    const up = prev[i]
    const ul = i >= bpp ? prev[i - bpp] : 0
    let v
    switch (filter) {
      case 0: v = rawByte; break
      case 1: v = rawByte + left; break
      case 2: v = rawByte + up; break
      case 3: v = rawByte + ((left + up) >> 1); break
      case 4: v = rawByte + paeth(left, up, ul); break
      default: v = rawByte
    }
    curBuf[i] = v & 0xff
  }
  rows.push(curBuf)
  prev = curBuf
}
const px = (x, y) => {
  const r = rows[y][x * bpp]
  const g = rows[y][x * bpp + 1]
  const b = rows[y][x * bpp + 2]
  return [r, g, b]
}
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

// ─── faixas horizontais (tolerância 8) em alturas variadas ───
const scan = (y) => {
  const runs = []
  let start = 0,
    last = px(0, y)
  const near = (a, b) => Math.abs(a[0] - b[0]) <= 8 && Math.abs(a[1] - b[1]) <= 8 && Math.abs(a[2] - b[2]) <= 8
  for (let x = 1; x < w; x++) {
    const c = px(x, y)
    if (!near(c, last)) {
      runs.push({ from: start, to: x - 1, color: hex(last), len: x - start })
      start = x
      last = c
    }
  }
  runs.push({ from: start, to: w - 1, color: hex(last), len: w - start })
  return runs.filter((r) => r.len >= 3)
}

for (const pct of [10, 25, 50, 75, 90]) {
  const y = Math.floor((h * pct) / 100)
  out(`\nSCAN y=${y} (${pct}%):`)
  for (const r of scan(y)) out(`  x ${r.from}..${r.to} (len ${r.len})  ${r.color}`)
}

// ─── ppick das primeiroas 80 colunas (a "faixa esquerda") ───
out('\nBORDA ESQUERDA (amostras em várias alturas, x=2/8/16/24/40/64):')
for (const pct of [20, 50, 80]) {
  const y = Math.floor((h * pct) / 100)
  out(`  y=${y}:  ` + [2, 8, 16, 24, 40, 64].map((x) => `x${x}=${hex(px(x, y))}`).join('  '))
}
out('\nBORDA DIREITA:')
for (const pct of [20, 50, 80]) {
  const y = Math.floor((h * pct) / 100)
  out(
    `  y=${y}:  ` +
      [2, 8, 16, 24, 40, 64]
        .map((d) => `x${w - 1 - d}=${hex(px(w - 1 - d, y))}`)
        .join('  ')
  )
}
out('\nfim.')
console.log('medir.log gravado.')
