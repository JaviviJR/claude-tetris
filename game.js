'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#a1887f', // N - tuerca (bronce)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca (reto: hueco central)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const themeText = document.getElementById('theme-text');
const themeColors = { grid: '#22222e', highlight: 'rgba(255,255,255,0.12)', edge: 'rgba(0,0,0,0)' };

function readThemeColors() {
  const s = getComputedStyle(document.documentElement);
  themeColors.grid = s.getPropertyValue('--grid').trim();
  themeColors.highlight = s.getPropertyValue('--block-highlight').trim();
  themeColors.edge = s.getPropertyValue('--block-edge').trim();
}

function applyTheme(theme, persist = true) {
  const light = theme === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  themeToggle.setAttribute('aria-pressed', String(light));
  themeToggle.setAttribute('aria-label', light ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  themeIcon.textContent = light ? '☀️' : '🌙';
  themeText.textContent = light ? 'Claro' : 'Oscuro';
  if (persist) {
    try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (e) {}
  }
  readThemeColors();
  // Redibujar: en pausa o game over el loop está detenido
  if (current && next) {
    draw();
    drawNext();
    drawHold();
  }
}

/* ---- Skins (temas visuales del tablero) ---- */
// Cada skin define su paleta (índices 1..8: I, O, T, S, Z, J, L, N) y su propia
// función de dibujo de bloque. drawBlock() delega en la skin activa.

// Rectángulo redondeado con fallback para navegadores sin ctx.roundRect
function roundRectPath(context, x, y, w, h, r) {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, w, h, r);
    return;
  }
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

// Textura pixel art cacheada por color y tamaño (patrón determinista, sin Math.random)
const pixelTextureCache = new Map();
function pixelTexture(color, size) {
  const key = color + '|' + size;
  let tex = pixelTextureCache.get(key);
  if (tex) return tex;
  tex = document.createElement('canvas');
  tex.width = tex.height = size;
  const t = tex.getContext('2d');
  const P = Math.max(2, Math.floor(size / 10)); // tamaño de cada "pixel"
  const n = Math.floor((size - 2) / P);
  const off = Math.floor((size - n * P) / 2);
  t.fillStyle = color;
  t.fillRect(off, off, n * P, n * P);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === 0 || j === 0) t.fillStyle = 'rgba(255,255,255,0.45)';          // borde claro (arriba/izq.)
      else if (i === n - 1 || j === n - 1) t.fillStyle = 'rgba(0,0,0,0.45)';   // borde oscuro (abajo/der.)
      else {
        const h = (i * 7 + j * 13 + i * j * 3) % 11;                            // patrón fijo pseudoaleatorio
        if (h === 0 || h === 5) t.fillStyle = 'rgba(255,255,255,0.22)';
        else if (h === 3 || h === 8) t.fillStyle = 'rgba(0,0,0,0.18)';
        else continue;
      }
      t.fillRect(off + i * P, off + j * P, P, P);
    }
  }
  pixelTextureCache.set(key, tex);
  return tex;
}

// drawBlock(ctx, px, py, color, size, alpha): px/py en píxeles; globalAlpha ya aplicado
const SKINS = {
  retro: {
    label: 'Retro',
    colors: COLORS,
    // Bloques cuadrados, colores planos (estilo original)
    drawBlock(context, px, py, color, size) {
      context.fillStyle = color;
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
      // highlight
      context.fillStyle = themeColors.highlight;
      context.fillRect(px + 1, py + 1, size - 2, 4);
      // borde para dar contraste sobre fondo claro
      context.strokeStyle = themeColors.edge;
      context.lineWidth = 1;
      context.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
    },
  },
  neon: {
    label: 'Neon',
    colors: [null, '#00f0ff', '#fff200', '#d400ff', '#39ff14', '#ff073a', '#2979ff', '#ff8c00', '#ff00c8'],
    // Contorno luminoso con glow (shadowBlur); drawBlock() restaura el contexto al terminar
    drawBlock(context, px, py, color, size, alpha) {
      context.shadowColor = color;
      context.shadowBlur = size * 0.4;
      context.globalAlpha = alpha * 0.25;
      context.fillStyle = color;
      context.fillRect(px + 3, py + 3, size - 6, size - 6);
      context.globalAlpha = alpha;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(px + 3, py + 3, size - 6, size - 6);
      context.shadowBlur = 0;
      context.fillStyle = 'rgba(255,255,255,0.7)';
      context.fillRect(px + 5, py + 5, 3, 3);
    },
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#a8e6ef', '#fdf1a7', '#d9c2f0', '#b8e6c1', '#f7b5b5', '#b9d4f7', '#ffd3a8', '#d7c4b8'],
    // Colores suaves con bordes redondeados simulados
    drawBlock(context, px, py, color, size) {
      roundRectPath(context, px + 1.5, py + 1.5, size - 3, size - 3, size * 0.28);
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = 'rgba(0,0,0,0.15)';
      context.lineWidth = 1;
      context.stroke();
      // brillo suave
      roundRectPath(context, px + size * 0.22, py + size * 0.16, size * 0.56, size * 0.18, size * 0.09);
      context.fillStyle = 'rgba(255,255,255,0.55)';
      context.fill();
    },
  },
  pixel: {
    label: 'Pixel art',
    colors: [null, '#3cbcfc', '#f8d838', '#b853f8', '#58d854', '#f83800', '#0078f8', '#fc9838', '#ac7c00'],
    // Patrón de textura pixelado sobre cada bloque
    drawBlock(context, px, py, color, size) {
      context.imageSmoothingEnabled = false;
      context.drawImage(pixelTexture(color, size), px, py);
    },
  },
};
const DEFAULT_SKIN = 'retro';
let activeSkin = DEFAULT_SKIN;
const skinSelect = document.getElementById('skin-select');

function applySkin(name, persist = true) {
  if (!Object.prototype.hasOwnProperty.call(SKINS, name)) name = DEFAULT_SKIN;
  activeSkin = name;
  document.documentElement.dataset.skin = name;
  skinSelect.value = name;
  if (persist) {
    try { localStorage.setItem('skin', name); } catch (e) {}
  }
  readThemeColors(); // la skin puede sobrescribir --grid y demás variables en CSS
  // Redibujar: en pausa o game over el loop está detenido
  if (current && next) {
    draw();
    drawNext();
    drawHold();
  }
}
/* ---- Fin skins ---- */

let board, current, next, held, holdUsed, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  holdUsed = false;
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
  drawHold();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  // Delega en la skin activa (ver sección "Skins")
  const skin = SKINS[activeSkin];
  const a = alpha ?? 1;
  context.save();
  context.globalAlpha = a;
  skin.drawBlock(context, x * size, y * size, skin.colors[colorIndex], size, a);
  context.restore(); // resetea globalAlpha, shadowBlur, etc. (evita fugas del glow)
}

function drawGrid() {
  ctx.strokeStyle = themeColors.grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function drawHold() {
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  holdCanvas.classList.toggle('hold-locked', !!holdUsed);
  holdCanvas.setAttribute('aria-label', holdUsed ? 'Reserva bloqueada hasta la siguiente pieza' : 'Reserva disponible');
  if (!held) return;
  const shape = held.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(holdCtx, offX + c, offY + r, shape[r][c], 30);
}

function holdPiece() {
  if (holdUsed) return;
  // Pieza con forma original (sin rotaciones) en posición de spawn
  const fresh = type => {
    const shape = PIECES[type].map(row => [...row]);
    return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
  };
  const stored = fresh(current.type);
  if (!held) {
    held = stored;
    spawn();
  } else {
    current = held;
    held = stored;
    if (collide(current.shape, current.x, current.y)) endGame();
  }
  holdUsed = true;
  dropAccum = 0;
  drawHold();
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  // endGame() puede ejecutarse dentro de este frame; no reprogramar el loop
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  held = null;
  holdUsed = false;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'KeyC':
    case 'ShiftLeft':
    case 'ShiftRight':
      e.preventDefault();
      if (!e.repeat) holdPiece();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

themeToggle.addEventListener('click', () => {
  const isLight = document.documentElement.dataset.theme === 'light';
  applyTheme(isLight ? 'dark' : 'light');
  themeToggle.blur(); // evita que Space/Enter del juego reactiven el botón
});

let savedTheme = null;
try { savedTheme = localStorage.getItem('theme'); } catch (e) {}
applyTheme(savedTheme === 'light' ? 'light' : 'dark', false);

// Skins: rellenar selector, restaurar preferencia y cambiar sin recargar
for (const [key, skin] of Object.entries(SKINS)) {
  skinSelect.add(new Option(skin.label, key));
}
skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  skinSelect.blur(); // evita que las flechas/espacio del juego cambien la skin
});
let savedSkin = null;
try { savedSkin = localStorage.getItem('skin'); } catch (e) {}
applySkin(savedSkin, false);

init();
