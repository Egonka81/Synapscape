// Deterministic Mulberry32 Pseudo-Random Number Generator (PRNG)

export class PRNG {
  private s: number;
  constructor(seed = 42) {
    this.s = (seed >>> 0) || 1;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
