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
    level = Math.max(gameStartLevel, Math.floor(lines / 10) + 1);
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
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = themeColors.highlight;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  // borde para dar contraste sobre fondo claro
  context.strokeStyle = themeColors.edge;
  context.lineWidth = 1;
  context.strokeRect(x * size + 1.5, y * size + 1.5, size - 3, size - 3);
  context.globalAlpha = 1;
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
    closePauseMenu();
    // Reinicia el reloj de caída para no "saltar" al volver
    dropAccum = 0;
    lastTime = performance.now();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
  } else {
    cancelAnimationFrame(animId);
    openPauseMenu();
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
  gameStartLevel = startLevel;
  level = gameStartLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  held = null;
  holdUsed = false;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  closePauseMenu();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

// ==== Menú de pausa ====
const START_LEVEL_MIN = 1;
const START_LEVEL_MAX = 15;

const pauseMenu = document.getElementById('pause-menu');
const pauseResumeBtn = document.getElementById('pause-resume');
const pauseRestartBtn = document.getElementById('pause-restart');
const pauseControlsBtn = document.getElementById('pause-controls-btn');
const pauseControls = document.getElementById('pause-controls');
const startLevelEl = document.getElementById('start-level');
const startLevelValue = document.getElementById('start-level-value');
const startLevelDec = document.getElementById('start-level-dec');
const startLevelInc = document.getElementById('start-level-inc');
// Elementos navegables con ↑/↓ dentro del menú (en orden)
const pauseFocusables = [pauseResumeBtn, pauseRestartBtn, pauseControlsBtn, startLevelEl];

function clampStartLevel(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return START_LEVEL_MIN;
  return Math.min(START_LEVEL_MAX, Math.max(START_LEVEL_MIN, n));
}

function loadStartLevel() {
  try { return clampStartLevel(localStorage.getItem('startLevel') ?? START_LEVEL_MIN); } catch (e) { return START_LEVEL_MIN; }
}

// Preferencia para la próxima partida; gameStartLevel es el de la partida en curso
let startLevel = loadStartLevel();
let gameStartLevel = startLevel;

function setStartLevel(n) {
  startLevel = clampStartLevel(n);
  try { localStorage.setItem('startLevel', String(startLevel)); } catch (e) {}
  renderStartLevel();
}

function renderStartLevel() {
  startLevelValue.textContent = startLevel;
  startLevelEl.setAttribute('aria-valuenow', String(startLevel));
  startLevelDec.disabled = startLevel <= START_LEVEL_MIN;
  startLevelInc.disabled = startLevel >= START_LEVEL_MAX;
}

function setControlsVisible(show) {
  pauseControls.classList.toggle('hidden', !show);
  pauseControlsBtn.setAttribute('aria-expanded', String(show));
  pauseControlsBtn.textContent = show ? 'Ocultar controles' : 'Ver controles';
}

function openPauseMenu() {
  setControlsVisible(false);
  renderStartLevel();
  pauseMenu.classList.remove('hidden');
  pauseResumeBtn.focus();
}

function closePauseMenu() {
  pauseMenu.classList.add('hidden');
  // Quita el foco de los botones del menú para que Space/Enter no los reactiven en juego
  if (pauseMenu.contains(document.activeElement)) document.activeElement.blur();
}

// Teclas mientras el menú está abierto: nunca llegan al juego
function handlePauseMenuKey(e) {
  const idx = pauseFocusables.indexOf(document.activeElement);
  switch (e.code) {
    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      const step = e.code === 'ArrowDown' ? 1 : -1;
      const from = idx === -1 ? (step === 1 ? -1 : 0) : idx;
      const n = pauseFocusables.length;
      pauseFocusables[(from + step + n) % n].focus();
      break;
    }
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault();
      if (document.activeElement === startLevelEl) {
        setStartLevel(startLevel + (e.code === 'ArrowRight' ? 1 : -1));
      }
      break;
    case 'Space':
    case 'Enter':
    case 'NumpadEnter':
      // Sobre un botón: activación nativa. En otro sitio: evitar scroll/efectos.
      if (!(document.activeElement instanceof HTMLButtonElement)) e.preventDefault();
      break;
  }
}

pauseResumeBtn.addEventListener('click', () => { if (paused) togglePause(); });
pauseRestartBtn.addEventListener('click', init);
pauseControlsBtn.addEventListener('click', () => {
  setControlsVisible(pauseControls.classList.contains('hidden'));
});
startLevelDec.addEventListener('click', () => { setStartLevel(startLevel - 1); startLevelEl.focus(); });
startLevelInc.addEventListener('click', () => { setStartLevel(startLevel + 1); startLevelEl.focus(); });
renderStartLevel();
// ==== Fin menú de pausa ====

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP' || e.code === 'Escape') {
    e.preventDefault();
    if (!e.repeat) togglePause();
    return;
  }
  if (paused) { handlePauseMenuKey(e); return; }
  if (gameOver) return;
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

init();
