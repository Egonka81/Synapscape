// High-Performance Pheromone Diffusion Grid (Cellular Automata)
// 90x60 cells (10px per cell) over a 900x600 px world
// Double-buffered (ping-pong) Float32Array for zero-allocation simulation

export class PheromoneGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly worldW: number;
  readonly worldH: number;
  readonly totalCells: number;

  private gridA: Float32Array;
  private gridB: Float32Array;
  private current: Float32Array;
  private next: Float32Array;

  readonly diffusionRate: number;
  readonly evaporationRate: number;

  constructor(
    worldW = 900,
    worldH = 600,
    cellSize = 10,
    diffusionRate = 0.12,
    evaporationRate = 0.015
  ) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.cellSize = cellSize;
    this.cols = Math.max(1, (worldW / cellSize) | 0);
    this.rows = Math.max(1, (worldH / cellSize) | 0);
    this.totalCells = this.cols * this.rows;

    this.diffusionRate = diffusionRate;
    this.evaporationRate = evaporationRate;

    this.gridA = new Float32Array(this.totalCells);
    this.gridB = new Float32Array(this.totalCells);
    this.current = this.gridA;
    this.next = this.gridB;
  }

  reset() {
    this.gridA.fill(0);
    this.gridB.fill(0);
    this.current = this.gridA;
    this.next = this.gridB;
  }

  // Discrete 2D Laplacian diffusion + evaporation with toroidal boundary wrap
  step() {
    const { cols, rows, diffusionRate: D, evaporationRate: evap } = this;
    const cur = this.current;
    const nxt = this.next;
    const retain = 1.0 - evap;

    for (let y = 0; y < rows; y++) {
      const yU = y === 0 ? rows - 1 : y - 1;
      const yD = y === rows - 1 ? 0 : y + 1;
      const rowOffset = y * cols;
      const rowU = yU * cols;
      const rowD = yD * cols;

      for (let x = 0; x < cols; x++) {
        const xL = x === 0 ? cols - 1 : x - 1;
        const xR = x === cols - 1 ? 0 : x + 1;

        const p = cur[rowOffset + x];
        const laplacian =
          cur[rowOffset + xR] +
          cur[rowOffset + xL] +
          cur[rowD + x] +
          cur[rowU + x] -
          4.0 * p;

        const val = retain * (p + D * laplacian);
        // Clean floor cutoff to prevent floating-point denormals
        nxt[rowOffset + x] = val > 0.0005 ? (val > 1.0 ? 1.0 : val) : 0.0;
      }
    }

    // Ping-pong buffer swap
    const temp = this.current;
    this.current = this.next;
    this.next = temp;
  }

  // Toroidal deposition of chemical intensity into grid
  deposit(worldX: number, worldY: number, amount: number) {
    if (isNaN(worldX) || isNaN(worldY) || isNaN(amount) || amount <= 0) return;
    const { cols, rows, worldW, worldH, cellSize } = this;

    // Toroidal coordinate wrap
    const wx = ((worldX % worldW) + worldW) % worldW;
    const wy = ((worldY % worldH) + worldH) % worldH;

    const cx = Math.max(0, Math.min(cols - 1, (wx / cellSize) | 0));
    const cy = Math.max(0, Math.min(rows - 1, (wy / cellSize) | 0));
    const idx = cy * cols + cx;

    const curVal = this.current[idx];
    const newVal = curVal + amount;
    this.current[idx] = newVal > 1.0 ? 1.0 : newVal;
  }

  // Bilinear interpolation sampling of pheromone concentration
  sample(worldX: number, worldY: number): number {
    if (isNaN(worldX) || isNaN(worldY)) return 0.0;
    const { cols, rows, worldW, worldH, cellSize } = this;

    const wx = ((worldX % worldW) + worldW) % worldW;
    const wy = ((worldY % worldH) + worldH) % worldH;

    const gx = wx / cellSize - 0.5;
    const gy = wy / cellSize - 0.5;

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;

    const ix0 = ((x0 % cols) + cols) % cols;
    const ix1 = (ix0 + 1) % cols;
    const iy0 = ((y0 % rows) + rows) % rows;
    const iy1 = (iy0 + 1) % rows;

    const cur = this.current;
    const r0 = iy0 * cols;
    const r1 = iy1 * cols;

    const v00 = cur[r0 + ix0];
    const v10 = cur[r0 + ix1];
    const v01 = cur[r1 + ix0];
    const v11 = cur[r1 + ix1];

    const top = v00 + fx * (v10 - v00);
    const bot = v01 + fx * (v11 - v01);
    const val = top + fy * (bot - top);

    if (isNaN(val) || val <= 0.0) return 0.0;
    return val > 1.0 ? 1.0 : val;
  }

  // Fast export of current grid intensities into a Uint8Array (0-255)
  exportUint8(target: Uint8Array) {
    const cur = this.current;
    const len = Math.min(target.length, this.totalCells);
    for (let i = 0; i < len; i++) {
      const v = cur[i];
      target[i] = v > 0.0 ? (v >= 1.0 ? 255 : (v * 255) | 0) : 0;
    }
  }
}
