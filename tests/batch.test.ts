import { describe, expect, it } from "vitest";
import { ULTRA_DEFAULTS } from "../src/engine/ultra";
import { runJob, steps } from "../src/ultra/batch";

describe("batch experiments", () => {
  it("spaces values evenly", () => {
    expect(steps(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(steps(3, 9, 1)).toEqual([3]);
  });

  it("applies the grid values and repeats from a seed", () => {
    const base = structuredClone(ULTRA_DEFAULTS);
    const job = { cell: 0, seed: 5, values: { "species.sharks.start": 0 } };
    // No sharks at all: the run ends at once, and not every species survived.
    expect(runJob(base, 100, job)).toEqual({ cell: 0, survived: false, ticks: 1 });
    const a = runJob(base, 150, { ...job, values: { "species.fish.breedChance": 0.7 } });
    const b = runJob(base, 150, { ...job, values: { "species.fish.breedChance": 0.7 } });
    expect(a).toEqual(b);
  });
});
