export function drawQRToCanvas(canvas: HTMLCanvasElement, text: string, size = 280) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const qr = generateQR(text, 'L')
  const len = qr.length
  const cell = size / len
  canvas.width = size
  canvas.height = size

  ctx.fillStyle = '#0a0a1a'
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = '#00f5ff'
  const pad = 2
  for (let r = 0; r < len; r++) {
    for (let c = 0; c < len; c++) {
      if (qr[r][c]) {
        ctx.fillRect(Math.floor((c + pad) * cell), Math.floor((r + pad) * cell), Math.ceil(cell) - 1, Math.ceil(cell) - 1)
      }
    }
  }

  const logoSize = size * 0.18
  const lx = (size - logoSize) / 2
  const ly = (size - logoSize) / 2
  ctx.fillStyle = '#0a0a1a'
  ctx.fillRect(lx - 4, ly - 4, logoSize + 8, logoSize + 8)
  ctx.fillStyle = '#8b5cf6'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, logoSize / 2.5, 0, Math.PI * 2)
  ctx.fill()
}

type ErrLevel = 'L' | 'M' | 'Q' | 'H'

function generateQR(text: string, level: ErrLevel): boolean[][] {
  const version = getVersion(text.length, level)
  const modules = version * 4 + 17
  const grid: boolean[][] = Array.from({ length: modules }, () => Array(modules).fill(false))

  addFinderPatterns(grid, modules)
  addTimingPatterns(grid, modules)
  addFormatBits(grid, modules, level)
  addData(grid, text, version, modules)
  applyMask(grid, modules)

  return grid
}

function getVersion(len: number, level: ErrLevel): number {
  const caps: Record<ErrLevel, number[]> = {
    L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
    M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331],
    Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482, 509, 565, 611, 661, 715, 751, 805, 868, 908, 982, 1026, 1090, 1156, 1202, 1261, 1315, 1374, 1446, 1491, 1550],
    H: [9, 16, 26, 36, 44, 52, 60, 72, 80, 96, 108, 120, 136, 156, 168, 184, 196, 218, 239, 261, 277, 295, 322, 348, 374, 382, 410, 442, 464, 488, 516, 526, 561, 581, 609, 627, 647, 679, 695, 735],
  }
  for (let v = 0; v < 40; v++) {
    if (len <= caps[level][v]) return v + 1
  }
  return 40
}

function addFinderPatterns(grid: boolean[][], mod: number) {
  for (const [row, col] of [[0, 0], [0, mod - 7], [mod - 7, 0]]) {
    for (let r = -1; r < 8; r++) {
      for (let c = -1; c < 8; c++) {
        const nr = row + r, nc = col + c
        if (nr < 0 || nr >= mod || nc < 0 || nc >= mod) continue
        const isWhite = (r >= 0 && r <= 6 && c >= 0 && c <= 6) &&
          (r === 0 || r === 6 || c === 0 || c === 6 ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4))
        grid[nr][nc] = isWhite
      }
    }
  }
}

function addTimingPatterns(grid: boolean[][], mod: number) {
  for (let i = 8; i < mod - 8; i++) {
    grid[6][i] = i % 2 === 0
    grid[i][6] = i % 2 === 0
  }
}

function addFormatBits(grid: boolean[][], mod: number, level: ErrLevel) {
  const levelBits: Record<ErrLevel, number> = { L: 1, M: 0, Q: 3, H: 2 }
  const lv = levelBits[level]
  const data = ((lv << 13) | 0b010011011101101) & 0x7FFF
  const poly = 0b10100110111
  let rem = data << 10
  for (let i = 14; i >= 0; i--) {
    if (rem & (1 << (i + 10))) rem ^= poly << i
  }
  const codeword = ((data << 10) | rem) & 0x7FFF

  for (let i = 0; i < 15; i++) {
    const bit = (codeword >> (14 - i)) & 1
    if (i < 6) { grid[8][i] = !!bit; grid[i][8] = !!bit }
    else if (i < 7) { grid[8][i + 1] = !!bit; grid[i + 1][8] = !!bit }
    else if (i < 8) { grid[8][mod - 15 + i] = !!bit }
    else { grid[mod - 15 + i][8] = !!bit }
  }
}

function addData(grid: boolean[][], text: string, version: number, mod: number) {
  const bytes = new TextEncoder().encode(text)
  const total = (version * 4 + 17) * (version * 4 + 17)
  const data: number[] = []

  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) data.push((b >> i) & 1)
  }

  let pos = 0
  let dir = -1
  for (let c = mod - 1; c > 0; c -= 2) {
    if (c === 6) c = 5
    for (let r = dir === -1 ? mod - 1 : 0; r >= 0 && r < mod; r += dir) {
      for (const dc of [0, -1]) {
        const col = c + dc
        if (grid[r][col]) continue
        if (pos < data.length) {
          grid[r][col] = data[pos++] === 1
        }
      }
    }
    dir = -dir
  }
}

function applyMask(grid: boolean[][], mod: number) {
  let bestScore = Infinity
  let best: boolean[][] = []

  for (let mask = 0; mask < 8; mask++) {
    const copy = grid.map((r) => [...r])
    for (let r = 0; r < mod; r++) {
      for (let c = 0; c < mod; c++) {
        if (isReserved(r, c, mod)) continue
        const val = (r * c + r * c + r + c) % 2 === mask % 2
        const cellVal = copy[r][c]
        copy[r][c] = val ? !cellVal : cellVal
      }
    }
    const score = scoreMask(copy, mod)
    if (score < bestScore) { bestScore = score; best = copy }
  }

  for (let r = 0; r < mod; r++)
    for (let c = 0; c < mod; c++)
      grid[r][c] = best[r][c]
}

function isReserved(r: number, c: number, mod: number): boolean {
  if (r === 6 || c === 6) return true
  if (r === 8 || c === 8) return true
  if (r < 8 && c < 8) return true
  if (r < 8 && c >= mod - 8) return true
  if (r >= mod - 8 && c < 8) return true
  if (r === mod - 8 && c === 8) return true
  return false
}

function scoreMask(grid: boolean[][], mod: number): number {
  let score = 0
  for (let r = 0; r < mod; r++) {
    let run = 1
    for (let c = 1; c < mod; c++) {
      if (grid[r][c] === grid[r][c - 1]) { run++ } else { if (run >= 5) score += run + 2; run = 1 }
    }
    if (run >= 5) score += run + 2
  }
  return score
}
