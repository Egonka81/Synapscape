// Egy ágens teljes állapota és fizikája
// Differenciálhajtású 2D model (mint a Braitenberg-jármű)

export const AgentSlot = {
  X: 0, Y: 1, Angle: 2,
  Vl: 3, Vr: 4,
  Health: 5, Age: 6,
  _COUNT: 7,
} as const;
export type AgentSlot = (typeof AgentSlot)[keyof typeof AgentSlot];

const WHEEL_BASE   =  8.0;
const MAX_SPEED    = 60.0;
const DRAG         = 0.92;
const SENSOR_RANGE = 80.0;

export class AgentPool {
  readonly capacity: number;
  readonly buf: Float32Array;
  readonly sensorOut: Float32Array; // 9 érték/ágens

  constructor(capacity: number) {
    this.capacity  = capacity;
    this.buf       = new Float32Array(capacity * AgentSlot._COUNT);
    this.sensorOut = new Float32Array(capacity * 9);
  }

  spawn(idx: number, x: number, y: number, angle: number) {
    const b = idx * AgentSlot._COUNT;
    this.buf[b + AgentSlot.X]      = x;
    this.buf[b + AgentSlot.Y]      = y;
    this.buf[b + AgentSlot.Angle]  = angle;
    this.buf[b + AgentSlot.Vl]     = 0.0;
    this.buf[b + AgentSlot.Vr]     = 0.0;
    this.buf[b + AgentSlot.Health] = 1.0;
    this.buf[b + AgentSlot.Age]    = 0.0;
  }

  applyMotor(idx: number, motorL: number, motorR: number) {
    const b = idx * AgentSlot._COUNT;
    this.buf[b + AgentSlot.Vl] = motorL * MAX_SPEED * DRAG;
    this.buf[b + AgentSlot.Vr] = motorR * MAX_SPEED * DRAG;
  }

  tick(idx: number, dt: number, worldW: number, worldH: number) {
    const b     = idx * AgentSlot._COUNT;
    const vl    = this.buf[b + AgentSlot.Vl];
    const vr    = this.buf[b + AgentSlot.Vr];
    const angle = this.buf[b + AgentSlot.Angle];

    const v    = (vl + vr) * 0.5;
    const w    = (vr - vl) / WHEEL_BASE;
    const dtS  = dt * 0.001;
    const newA = angle + w * dtS;

    let newX = this.buf[b + AgentSlot.X] + v * Math.cos(newA) * dtS;
    let newY = this.buf[b + AgentSlot.Y] + v * Math.sin(newA) * dtS;

    // Toroidális határkezelés
    if (newX < 0)       newX += worldW;
    if (newX >= worldW) newX -= worldW;
    if (newY < 0)       newY += worldH;
    if (newY >= worldH) newY -= worldH;

    this.buf[b + AgentSlot.X]     = newX;
    this.buf[b + AgentSlot.Y]     = newY;
    this.buf[b + AgentSlot.Angle] = newA % (2 * Math.PI);
    this.buf[b + AgentSlot.Age]  += dt;
  }

  readOlfactorySensors(idx: number, sources: Float32Array, numSources: number) {
    const b     = idx * AgentSlot._COUNT;
    const ax    = this.buf[b + AgentSlot.X];
    const ay    = this.buf[b + AgentSlot.Y];
    const angle = this.buf[b + AgentSlot.Angle];
    const sb    = idx * 9;

    const lx = ax + Math.cos(angle - 0.5236) * SENSOR_RANGE * 0.5;
    const ly = ay + Math.sin(angle - 0.5236) * SENSOR_RANGE * 0.5;
    const rx = ax + Math.cos(angle + 0.5236) * SENSOR_RANGE * 0.5;
    const ry = ay + Math.sin(angle + 0.5236) * SENSOR_RANGE * 0.5;

    for (let c = 0; c < 4; c++) {
      const sigma2 = SENSOR_RANGE * SENSOR_RANGE * 2.0 * (1.0 + c * 0.5);
      let sumL = 0.0, sumR = 0.0;
      for (let s = 0; s < numSources; s++) {
        const sx = sources[s * 2], sy = sources[s * 2 + 1];
        const dLx = lx - sx, dLy = ly - sy;
        const dRx = rx - sx, dRy = ry - sy;
        sumL += Math.exp(-(dLx * dLx + dLy * dLy) / sigma2);
        sumR += Math.exp(-(dRx * dRx + dRy * dRy) / sigma2);
      }
      this.sensorOut[sb + c]     = sumL > 1.0 ? 1.0 : sumL;
      this.sensorOut[sb + 4 + c] = sumR > 1.0 ? 1.0 : sumR;
    }
  }

  checkCollision(idx: number, obstacles: Float32Array, numObs: number): number {
    const b     = idx * AgentSlot._COUNT;
    const x     = this.buf[b + AgentSlot.X];
    const y     = this.buf[b + AgentSlot.Y];
    const angle = this.buf[b + AgentSlot.Angle];
    const sb    = idx * 9;
    const r     = 10.0;

    let mask = 0;
    const px = [
      x + Math.cos(angle) * r,          y + Math.sin(angle) * r,
      x + Math.cos(angle - 1.5708) * r, y + Math.sin(angle - 1.5708) * r,
      x + Math.cos(angle + 1.5708) * r, y + Math.sin(angle + 1.5708) * r,
    ];

    for (let o = 0; o < numObs; o++) {
      const ox = obstacles[o * 3], oy = obstacles[o * 3 + 1], or_ = obstacles[o * 3 + 2];
      for (let p = 0; p < 3; p++) {
        const dx = px[p * 2] - ox, dy = px[p * 2 + 1] - oy;
        if (dx * dx + dy * dy < or_ * or_) mask |= (1 << p);
      }
    }

    this.sensorOut[sb + 8] = mask & 1 ? 1.0 : 0.0;
    return mask;
  }
}
