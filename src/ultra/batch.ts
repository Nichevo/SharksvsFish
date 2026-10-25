/** Batch experiments: many seeds over a grid of two settings, to see how often the ocean survives. */
import { UltraSimulation, type UltraSettings } from "../engine/ultra";
import { setPath } from "../ui/fields";

export interface BatchJob {
  /** Grid cell this run belongs to. */
  cell: number;
  seed: number;
  /** Setting path -> value for this cell. */
  values: Record<string, number>;
}

export interface BatchResult {
  cell: number;
  /** Every species that started is still alive at the iteration limit. */
  survived: boolean;
  /** Iterations the run lasted. */
  ticks: number;
}

/** One run, without drawing anything. */
export function runJob(base: Omit<UltraSettings, "seed">, maxTicks: number, job: BatchJob): BatchResult {
  const settings = { ...structuredClone(base), seed: job.seed, maxTicks } as UltraSettings;
  for (const [path, v] of Object.entries(job.values)) setPath(settings as unknown as Record<string, unknown>, path, v);
  const sim = new UltraSimulation(settings);
  while (!sim.finished()) sim.step();
  return { cell: job.cell, survived: sim.tick >= maxTicks && sim.allSurvive(), ticks: sim.tick };
}

/** Evenly spaced values from `from` to `to`. */
export function steps(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}
