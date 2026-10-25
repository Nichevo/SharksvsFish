# Sharks vs Fish

A predator-prey simulation in the browser. Fish and sharks live in a grid ocean: they age, breed and die, sharks eat fish, and sharks starve without them. Watch the populations over time to see whether the ocean finds a balance.

It started life as an Excel/VBA workbook (`SnF - v4.xls`). This is a rebuild that keeps the original model and adds a lot more to play with.

**Play it:** https://nichevo.github.io/SharksvsFish/ (once GitHub Pages is switched on, see below)

![Classic mode: the original 21×21 pond with the population chart](docs/screenshots/classic.png)

## Modes

### Classic
The original model, ported line by line from the VBA (`original/Module1.bas`): a 21×21 pond with walls, 220 fish and 22 sharks, and the same ages, breeding and starvation settings. It runs in blocks of 200 iterations, like pressing the button in Excel.

There are two rule sets:

- **Classic (exact)** reproduces the spreadsheet, bugs included:
  - The breeding check is inverted (`Family <> Family`), so fish breed when they bump into an adult shark, and fish meeting fish never breed.
  - Sharks breed every time they eat, because the emptied cell counts as "a different family".
  - A moving creature clears its *new* cell in the location map instead of its old one. That leaves a "ghost" behind, and its real cell looks empty to others, so creatures can share cells and sharks can eat ghosts. The map is rebuilt at the start of each 200-iteration run, as Excel did when it read the `Data` sheet back in.
  - A fed shark looking for a mate finds itself, so it doesn't move.
- **Intended** fixes those bugs: like breeds with like, moves update the map properly, and sharks only breed with other sharks. (With the original numbers the sharks usually die out: in the spreadsheet, eating was what kept them breeding.)

Excel's random numbers can't be reproduced, so individual runs differ from the spreadsheet, but the overall behaviour matches.

### Enhanced
A cleaner model with many more settings, and some presets to start from:

- **Ocean:** size, wrap-around edges or walls, 8 or 4 directions of movement, whether creatures can stay still, where babies are born, turn order, and a stop limit.
- **Fish and sharks:** starting numbers, breeding age, age limit, breeding chance, litter size, rest between litters, whether a partner is needed, and how far they can see.
- **Sharks:** energy (starting, maximum, per fish eaten), the hunger level at which they hunt, the energy needed to breed, and whether they move into the fish's cell.
- **Fish:** the chance they swim away from sharks they can see.
- **Algae:** an optional food chain where fish must graze algae, which grows back over time.

Presets: *Balanced ocean*, *Wa-Tor* (Dewdney's 1984 rules), *Pairs only* and *Algae food chain*.

![Enhanced mode: a 60×40 wrap-around ocean with the full set of options](docs/screenshots/enhanced.png)

<img src="docs/screenshots/mobile-dark.png" alt="The Algae food chain preset on a phone in dark mode" width="300">

Enhanced mode can also give creatures a sex (**Separate males and females**). It is off by default. When it is on, partners must be male and female, a species that breeds alone only has young through its females, and the pond and age pyramids show males in a darker shade and females in a lighter one.

## Charts

Under the pond, the tabs show:

- **Population:** fish and sharks over time.
- **Births**, **Eaten** and **Deaths:** what happened in each iteration, with optional 10-iteration smoothing.
- **Age & sex:** an age pyramid for each species, with males on the left and females on the right. Classic mode (and Enhanced with sexes off) shows ages only.
- **Cycle:** fish plotted against sharks. A stable ocean draws loops, and a crash runs into an axis.

A **Totals so far** table shows births, deaths by cause (eaten, old age, starved), the number alive now and the peak for each species. **Download CSV** includes every series.

![Fish eaten per iteration, with the hover tooltip](docs/screenshots/eaten.png)

![Age and sex pyramids for fish and sharks](docs/screenshots/age-sex.png)

![Cycle chart: fish against sharks over a long run](docs/screenshots/cycle.png)

Every run uses a **seed**, so the same seed and settings always give the same run.

## Development

```sh
npm install
npm run dev      # local server with hot reload
npm test         # engine tests (vitest)
npm run build    # type-check and build to dist/
```

The code layout:

- `src/engine/`: the simulations, with no browser code. `classic.ts` is the VBA port, `enhanced.ts` is the new model, and `presets.ts` holds the enhanced presets. Both engines implement the `Simulation` interface in `types.ts`.
- `src/ui/fields.ts`: the settings forms are generated from these lists, so a new engine option needs only one line here.
- `src/ui/chart.ts`: the population chart.
- `src/main.ts`: wires it all together.

## Deploying

`.github/workflows/deploy.yml` runs the tests and builds on every push and pull request, and deploys `main` to GitHub Pages. To switch it on, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
