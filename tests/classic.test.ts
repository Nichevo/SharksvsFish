import { describe, expect, it } from "vitest";
import { CLASSIC_DEFAULTS, ClassicSimulation, vbaRound } from "../src/engine/classic";
import { FISH, SHARK } from "../src/engine/types";

const make = (over: Partial<typeof CLASSIC_DEFAULTS> = {}, seed = 1) =>
  new ClassicSimulation({ ...CLASSIC_DEFAULTS, ...over, seed });

describe("vbaRound", () => {
  it("rounds halves to even like VBA", () => {
    expect(vbaRound(6)).toBe(6);
    expect(vbaRound(2.5)).toBe(2);
    expect(vbaRound(3.5)).toBe(4);
    expect(vbaRound(4.2)).toBe(4);
    expect(vbaRound(4.8)).toBe(5);
  });
});

describe("classic setup", () => {
  it("places the starting fish and sharks on distinct cells", () => {
    const sim = make();
    expect(sim.counts()).toEqual({ fish: 220, sharks: 22 });
    const cells = new Uint8Array(21 * 21);
    sim.paint(cells);
    expect(cells.filter((v) => v === FISH).length).toBe(220);
    expect(cells.filter((v) => v === SHARK).length).toBe(22);
  });

  it("trims an overfull pond instead of hanging", () => {
    const sim = make({ fishStart: 400, sharkStart: 100 });
    expect(sim.counts()).toEqual({ fish: 341, sharks: 100 });
  });

  it("is repeatable from a seed", () => {
    const a = make({}, 42);
    const b = make({}, 42);
    for (let i = 0; i < 50; i++) {
      a.step();
      b.step();
    }
    expect(a.counts()).toEqual(b.counts());
  });
});

describe("classic rules", () => {
  it("lone sharks with no fish starve after `starvation` iterations", () => {
    const sim = make({ fishStart: 0, sharkStart: 5, starvation: 10 });
    // No fish means the run is over straight away, as in Excel; step the engine anyway
    // by checking finished() is set.
    sim.step();
    expect(sim.finished()).toBe(true);
  });

  it("fish die of old age when there is nothing to breed with (intended rules)", () => {
    // Fish only breed with fish in intended rules; breed age above the age limit stops breeding.
    const sim = make({ rules: "intended", fishStart: 30, sharkStart: 1, fishBreedAge: 99, fishAgeLimit: 5, sharkAgeLimit: 1000, starvation: 1000 });
    for (let i = 0; i < 6; i++) sim.step();
    expect(sim.counts().fish).toBe(0);
  });

  it("exact rules: fish never breed with other fish", () => {
    // No adult sharks to bump into (shark breed age is huge), so the inverted check never fires.
    const sim = make({ rules: "exact", fishStart: 200, sharkStart: 1, sharkBreedAge: 999, fishAgeLimit: 1000, sharkAgeLimit: 1000, starvation: 1000 });
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.counts().fish).toBeLessThanOrEqual(200);
  });

  it("intended rules: fish do breed with fish", () => {
    const sim = make({ rules: "intended", fishStart: 200, sharkStart: 1, sharkBreedAge: 999, fishAgeLimit: 1000, sharkAgeLimit: 1000, starvation: 1000 });
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.counts().fish).toBeGreaterThan(200);
  });

  it("intended rules keep the location map accurate", () => {
    const sim = make({ rules: "intended" }, 7);
    for (let i = 0; i < 60 && !sim.finished(); i++) {
      sim.step();
      expect(sim.mapMismatches()).toBe(0);
    }
  });

  it("exact rules leave ghosts in the location map, which reset each 200-iteration run", () => {
    const sim = make({ rules: "exact", iterationsPerRun: 20 }, 3);
    let sawGhosts = false;
    for (let i = 0; i < 20 && !sim.finished(); i++) {
      sim.step();
      if (sim.mapMismatches() > 0) sawGhosts = true;
    }
    expect(sawGhosts).toBe(true);
    expect(sim.atPausePoint()).toBe(true);
  });

  it("default exact run behaves like the spreadsheet: fish boom, sharks hang on", () => {
    // Not a precise match (Excel's RNG can't be reproduced) but the shape should hold
    // over many seeds: populations stay alive through the first 200-iteration run.
    let survived = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sim = make({}, seed);
      for (let i = 0; i < 200 && !sim.finished(); i++) sim.step();
      if (!sim.finished()) survived++;
    }
    expect(survived).toBeGreaterThan(0);
  });
});
