/**
 * The classic Lotka-Volterra predator-prey equations, fitted to a run:
 *
 *   dx/dt = αx − βxy     (prey: grow on their own, eaten in proportion to meetings)
 *   dy/dt = δxy − γy     (predators: grow from meals, die off on their own)
 *
 * Dividing by x and y makes both lines straight: d(ln x)/dt = α − βy and
 * d(ln y)/dt = δx − γ, so two ordinary least-squares fits give the four numbers.
 */

export interface LvParams {
  alpha: number;
  beta: number;
  delta: number;
  gamma: number;
}

export interface LvFit extends LvParams {
  /** Index in the series the fit (and the curves) start from. */
  from: number;
  /** How well the two straight lines fit, 0-1. */
  r2Prey: number;
  r2Pred: number;
}

function movingAverage(v: number[], window: number): number[] {
  const out = new Array<number>(v.length);
  const half = Math.floor(window / 2);
  for (let i = 0; i < v.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(v.length - 1, i + half); j++) {
      sum += v[j];
      n++;
    }
    out[i] = sum / n;
  }
  return out;
}

/** Least-squares line y = a + b x, with R². */
function regress(xs: number[], ys: number[]): { a: number; b: number; r2: number } {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  return { a: my - b * mx, b, r2: sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0 };
}

/**
 * Fit α, β, δ, γ to prey and predator counts sampled once per iteration. `skip` drops
 * the opening iterations, where the random start dominates. Returns null when the
 * run is too short, a species died out, or the numbers don't look like predator and prey.
 */
export function fitLotkaVolterra(prey: number[], pred: number[], skip = 50): LvFit | null {
  const from = Math.min(skip, Math.floor(prey.length / 4));
  const x = movingAverage(prey.slice(from), 5);
  const y = movingAverage(pred.slice(from), 5);
  const ys: number[] = [];
  const gx: number[] = [];
  const xs: number[] = [];
  const gy: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i - 1] <= 0 || x[i + 1] <= 0 || y[i - 1] <= 0 || y[i + 1] <= 0) continue;
    // Central differences of the logs: per-capita growth rates.
    gx.push((Math.log(x[i + 1]) - Math.log(x[i - 1])) / 2);
    gy.push((Math.log(y[i + 1]) - Math.log(y[i - 1])) / 2);
    ys.push(y[i]);
    xs.push(x[i]);
  }
  if (gx.length < 30) return null;
  const p = regress(ys, gx);
  const q = regress(xs, gy);
  const fit = { alpha: p.a, beta: -p.b, delta: q.b, gamma: -q.a };
  if (!(fit.alpha > 0 && fit.beta > 0 && fit.delta > 0 && fit.gamma > 0)) return null;
  return { ...fit, from, r2Prey: p.r2, r2Pred: q.r2 };
}

/** Integrate the equations with RK4 from (x0, y0) for `n` iterations, one value per iteration. */
export function solveLotkaVolterra(p: LvParams, x0: number, y0: number, n: number, substeps = 10): { prey: number[]; pred: number[] } {
  const prey = [x0];
  const pred = [y0];
  let x = x0;
  let y = y0;
  const h = 1 / substeps;
  const fx = (a: number, b: number) => p.alpha * a - p.beta * a * b;
  const fy = (a: number, b: number) => p.delta * a * b - p.gamma * b;
  for (let i = 1; i < n; i++) {
    for (let s = 0; s < substeps; s++) {
      const k1x = fx(x, y);
      const k1y = fy(x, y);
      const k2x = fx(x + (h / 2) * k1x, y + (h / 2) * k1y);
      const k2y = fy(x + (h / 2) * k1x, y + (h / 2) * k1y);
      const k3x = fx(x + (h / 2) * k2x, y + (h / 2) * k2y);
      const k3y = fy(x + (h / 2) * k2x, y + (h / 2) * k2y);
      const k4x = fx(x + h * k3x, y + h * k3y);
      const k4y = fy(x + h * k3x, y + h * k3y);
      x = Math.max(0, x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x));
      y = Math.max(0, y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y));
    }
    prey.push(x);
    pred.push(y);
  }
  return { prey, pred };
}

/** Where both populations would hold steady, and the length of one cycle near there. */
export function equilibrium(p: LvParams): { prey: number; pred: number; period: number } {
  return { prey: p.gamma / p.delta, pred: p.alpha / p.beta, period: (2 * Math.PI) / Math.sqrt(p.alpha * p.gamma) };
}
