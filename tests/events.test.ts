import { describe, expect, it } from "vitest";
import { CLASSIC_DEFAULTS, ClassicSimulation } from "../src/engine/classic";
import { ENHANCED_DEFAULTS, EnhancedSimulation, type EnhancedSettings } from "../src/engine/enhanced";
import { ENHANCED_PRESETS } from "../src/engine/presets";
import { FEMALE, FISH_FEMALE, MALE, NO_SEX, SHARK_FEMALE, type Simulation } from "../src/engine/types";

/** Population change each iteration must equal births minus deaths. */
function checkBookkeeping(sim: Simulation, ticks: number): void {
  let prev = sim.counts();
  for (let i = 0; i < ticks && !sim.finished(); i++) {
    sim.step();
    const now = sim.counts();
    const e = sim.lastEvents();
    expect(now.fish - prev.fish).toBe(e.fishBorn - e.fishEaten - e.fishOldAge - e.fishStarved);
    expect(now.sharks - prev.sharks).toBe(e.sharksBorn - e.sharksOldAge - e.sharksStarved);
    prev = now;
  }
}

function enhanced(change: (s: EnhancedSettings) => void = () => {}, seed = 1): EnhancedSimulation {
  const s: EnhancedSettings = { ...structuredClone(ENHANCED_DEFAULTS), seed };
  change(s);
  return new EnhancedSimulation(s);
}

describe("events", () => {
  for (const rules of ["exact", "intended"] as const) {
    it(`classic ${rules}: births and deaths add up`, () => {
      checkBookkeeping(new ClassicSimulation({ ...CLASSIC_DEFAULTS, rules, seed: 4 }), 300);
    });
  }

  for (const [key, p] of Object.entries(ENHANCED_PRESETS)) {
    it(`enhanced ${key}: births and deaths add up`, () => {
      checkBookkeeping(new EnhancedSimulation({ ...structuredClone(p.settings), seed: 4 }), 200);
    });
  }

  it("sharks eat fish in classic mode", () => {
    const sim = new ClassicSimulation({ ...CLASSIC_DEFAULTS, seed: 2 });
    let eaten = 0;
    for (let i = 0; i < 50; i++) {
      sim.step();
      eaten += sim.lastEvents().fishEaten;
    }
    expect(eaten).toBeGreaterThan(0);
  });

  it("individuals match the counts", () => {
    const sim = enhanced((s) => (s.sexes = true));
    for (let i = 0; i < 20; i++) sim.step();
    const people = sim.individuals();
    const { fish, sharks } = sim.counts();
    expect(people.length).toBe(fish + sharks);
    expect(people.every((p) => p.sex === MALE || p.sex === FEMALE)).toBe(true);
  });

  it("classic creatures have no sex", () => {
    const sim = new ClassicSimulation({ ...CLASSIC_DEFAULTS, seed: 1 });
    expect(sim.hasSexes()).toBe(false);
    expect(sim.individuals().every((p) => p.sex === NO_SEX)).toBe(true);
  });
});

describe("sexes", () => {
  it("is off by default and in every preset", () => {
    expect(ENHANCED_DEFAULTS.sexes).toBe(false);
    for (const p of Object.values(ENHANCED_PRESETS)) expect(p.settings.sexes).toBe(false);
  });

  it("paints females with their own cell value", () => {
    const sim = enhanced((s) => (s.sexes = true));
    const cells = new Uint8Array(sim.width * sim.height);
    sim.paint(cells);
    const females = sim.individuals().filter((p) => p.sex === FEMALE).length;
    expect(cells.filter((v) => v === FISH_FEMALE || v === SHARK_FEMALE).length).toBe(females);
  });

  it("an all-male population can't breed alone", () => {
    const sim = enhanced((s) => {
      s.sexes = true;
      s.femaleShare = 0;
      s.fish = { ...s.fish, start: 200, breedAge: 0, breedChance: 1, breedCooldown: 0, maxAge: 1000 };
      s.sharks = { ...s.sharks, start: 1, maxAge: 1000, startEnergy: 1000, maxEnergy: 1000, hungerThreshold: 0 };
    });
    let born = 0;
    for (let i = 0; i < 10; i++) {
      sim.step();
      born += sim.lastEvents().fishBorn;
    }
    expect(born).toBe(0);
  });

  it("an all-female population can't breed when partners are needed", () => {
    const sim = enhanced((s) => {
      s.sexes = true;
      s.femaleShare = 1;
      s.fish = { ...s.fish, start: 400, breedAge: 0, breedChance: 1, breedCooldown: 0, maxAge: 1000, needsMate: true };
      s.sharks = { ...s.sharks, start: 1, maxAge: 1000, startEnergy: 1000, maxEnergy: 1000, hungerThreshold: 0 };
    });
    let born = 0;
    for (let i = 0; i < 10; i++) {
      sim.step();
      born += sim.lastEvents().fishBorn;
    }
    expect(born).toBe(0);
  });

  it("mixed sexes with partners needed do breed", () => {
    const sim = enhanced((s) => {
      s.sexes = true;
      s.fish = { ...s.fish, start: 400, breedAge: 0, breedChance: 1, breedCooldown: 0, maxAge: 1000, needsMate: true };
      s.sharks = { ...s.sharks, start: 1, maxAge: 1000, startEnergy: 1000, maxEnergy: 1000, hungerThreshold: 0 };
    });
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.counts().fish).toBeGreaterThan(400);
  });
});

describe("algae stats", () => {
  it("are absent when algae is off and in classic mode", () => {
    expect(enhanced().algaeCells()).toBeNull();
    expect(new ClassicSimulation({ ...CLASSIC_DEFAULTS, seed: 1 }).algaeCells()).toBeNull();
  });

  it("count algae grazed and the cells left", () => {
    const sim = enhanced((s) => (s.algae.enabled = true));
    const start = sim.algaeCells()!;
    expect(start).toBeGreaterThan(0);
    let grazed = 0;
    for (let i = 0; i < 5; i++) {
      sim.step();
      grazed += sim.lastEvents().algaeEaten;
    }
    expect(grazed).toBeGreaterThan(0);
    expect(sim.algaeCells()!).toBeLessThanOrEqual(sim.width * sim.height);
  });
});
