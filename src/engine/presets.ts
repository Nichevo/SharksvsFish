import { ENHANCED_DEFAULTS, type EnhancedSettings } from "./enhanced";

type Preset = Omit<EnhancedSettings, "seed">;

function preset(changes: (p: Preset) => void): Preset {
  const p = structuredClone(ENHANCED_DEFAULTS);
  changes(p);
  return p;
}

export const ENHANCED_PRESETS: Record<string, { label: string; description: string; settings: Preset }> = {
  balanced: {
    label: "Balanced ocean",
    description: "Wrap-around ocean, fish breed alone, sharks hunt what they can see and fish sometimes flee.",
    settings: preset(() => {}),
  },
  wator: {
    label: "Wa-Tor",
    description: "Dewdney's 1984 Wa-Tor rules: no sight or fleeing, sharks always hunt, babies go in the cell just left.",
    settings: preset((p) => {
      p.allowStay = false;
      p.neighbourhood = "vonNeumann";
      p.fish = { ...p.fish, breedAge: 3, maxAge: 1000, breedChance: 1, breedCooldown: 3, needsMate: false, sight: 0, fleeChance: 0, start: 800 };
      p.sharks = {
        ...p.sharks,
        breedAge: 10,
        maxAge: 1000,
        breedChance: 1,
        breedCooldown: 10,
        needsMate: false,
        sight: 0,
        startEnergy: 3,
        maxEnergy: 3,
        energyPerMeal: 3,
        hungerThreshold: 1.01,
        moveOnEat: true,
        breedEnergy: 0,
        start: 100,
      };
    }),
  },
  pairs: {
    label: "Pairs only",
    description: "Like the original idea: creatures need a partner next to them to breed. Try it with males and females switched on.",
    settings: preset((p) => {
      p.fish = { ...p.fish, needsMate: true, breedChance: 0.8, breedCooldown: 1, litterSize: 2, start: 900 };
      p.sharks = { ...p.sharks, needsMate: true, breedChance: 0.8, breedCooldown: 12, litterSize: 1, sight: 2, start: 80 };
    }),
  },
  algae: {
    label: "Algae food chain",
    description: "Fish must graze algae to survive, so the ocean has a limit on how many fish it can feed.",
    settings: preset((p) => {
      p.algae.enabled = true;
      p.fish = { ...p.fish, start: 500, breedChance: 0.6 };
    }),
  },
};
