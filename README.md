# PokéSpire

A roguelike Pokémon journey for the browser. Pick a starter, climb three acts of branching routes, build a team, beat Gym Leaders and villain teams, catch Legendaries, and take on the Elite Four and the Champion to enter the Hall of Fame.

## Features

**Accounts.** Opening the site asks you to log in or sign up (username, email and password). Runs, caught Pokémon, settings and history are saved to your account, so a run can be continued from any device.

**Main menu.** Continue run, Play, Settings (master, music and sound-effect volume, mute, text speed), and History (previous runs plus the Hall of Fame).

**Game mode.** After clicking Play you choose:
- **Classic:** your starter's home region sets the journey: that region's Gym Leaders in their original order with signature teams, its villain team, its Elite Four and Champion. Wild Pokémon, Legendaries and Trainers' Pokémon come from every region. Alola uses its Trial Captains and Kahuna; Galar's "Elite Four" is the Champion Cup (Marnie, Hop, Bede, Raihan).
- **Randomized:** Gym Leaders, villain teams, Elite Four and Champion are drawn from every region, and every Trainer and boss team is fully randomized.

**Difficulty.** Next you pick a difficulty. Only Easy is open at first: entering the Hall of Fame on a difficulty unlocks the next one (Easy → Medium → Hard → Hell). Runs that used God mode or admin tools don't count; admins can pick any difficulty.

| | Easy | Medium | Hard | Hell |
| --- | --- | --- | --- | --- |
| Opponent levels | −15% | standard | +10% | +20% |
| Opponent stats | weaker IVs | random IVs | perfect IVs for trainers | perfect IVs and trained EVs for all |
| Trainer AI | simple | smart bosses | smart everywhere | smart everywhere |
| Boss Full Restores | standard | standard | +1 | +2 |
| Exp. | ×1.5 | ×1 | ×1 | ×1 |
| Prize money / shop prices | ×1.5 / −25% | ×1 / ×1 | ×0.8 / +25% | ×0.5 / +50% |
| Starting bag | 10 Poké Balls, 5 Potions, Revive | 5 Poké Balls, 3 Potions | 3 Poké Balls, 1 Potion | 3 Poké Balls |
| Special rules | — | — | — | Nuzlocke: fainted Pokémon are gone for good, no items in trainer battles, no Revives |

**Money.** Every run starts with $100, shown on the map, in battle and at the PokéMart. Winning a battle pays out based on the opponent's level: wild Pokémon pay $2 per level (Elite Pokémon $5, Legendaries $8), and Trainers pay more, from $4 per level for a Youngster up to $50 per level for the Champion.

**Admin / God mode.** Accounts with `is_admin` set in the database get an Admin panel (main menu and map): God mode (your team can't be hurt, every hit knocks out, every Poké Ball catches), +$10,000, 99 of every item, team level-ups, adding any Pokémon, skipping to Act II, Act III or the League, and unlocking every Pokémon as a starter. Players can't set the flag themselves. Grant it in the Supabase SQL Editor with `update public.profiles set is_admin = true where username = 'YourName';`. Runs where God mode was used are tagged in history.

**IVs, EVs, natures and abilities.** Each Pokémon's summary shows base stats, IVs (with the games' judge rating), EVs and final stats, its nature's effect, its ability with a description, and how and when it evolves (with progress, e.g. friendship or items in the bag). EVs are earned in battle and from vitamins (HP Up, Protein, Iron, Calcium, Zinc, Carbos: +10 each, up to 252 per stat and 510 total). Bottle Caps (Hyper Training, Lv 50+) raise IVs to 31. Every nature and ability you catch is unlocked for that Pokémon's whole evolution family. You can then switch a Pokémon to any unlocked nature or ability from its summary, or pick one when choosing a starter.

**Filter and sort.** The starter screen, Team and Box can be searched by name, filtered by type (and region), and sorted by Dex No., name, level, HP, base stat total, each stat, IV total or EV total.

**Movesets and evolution requirements.** Like PokéRogue, every Pokémon's full level-up moveset is shown as a table (level, move, type, category, power, accuracy, PP, description) in the Pokédex, when picking a starter, and in the summary. In the summary, moves at or below the current level can be relearned anytime (a built-in Move Reminder). Evolution requirements are shown as a family tree with each step's condition (level, item, friendship, time of day, known move) in the Pokédex and starter pick, and with live progress in the summary. Admins can also teach moves early and evolve a Pokémon instantly; both mark the run as admin tools used.

**Points, leaderboard and friends.** Every win and catch adds points to the run (more for tougher opponents, multiplied by difficulty: Easy ×0.5, Medium ×1, Hard ×1.5, Hell ×2.5). The leaderboard ranks players by best run and by total points, and both come only from runs. Search players by username to add them as friends; the corner badge shows how many players are online (Supabase Realtime presence), and friends show an online dot.

**Missions and achievements.** Three daily and three weekly missions (the same for everyone each day and week) and the achievements (catching, shinies, Legendaries, badges, battle gimmicks, the Hall of Fame on each difficulty, a Classic win in every region and more) track your progress. They don't give points: leaderboard points come only from runs. Runs using God mode or other admin tools score 0 and don't count. Admins can mark every achievement complete from the admin panel.

**Shinies.** Wild, Elite and Legendary Pokémon are shiny 1 time in 512, with a sparkle when they appear. Catching a shiny unlocks a shiny starter option for its evolution family. A shiny catch also counts as catching the species. Wild Pokémon in battle show a Poké Ball mark if you've caught that species and a gold ✦ if you've caught its shiny; the Pokédex shows the same marks and can filter to shinies only. Ten shiny achievements and a weekly shiny mission track shiny hunting. Admins can toggle a view-only "every shiny unlocked" option that doesn't add real catches or achievements.

**Pokédex.** The main menu's Pokédex lists every species you've caught (with shinies marked), by region, with search, type filter and sorting; tick "show uncaught" to browse silhouettes of the rest. Each entry shows base stats, abilities, what you've unlocked for the family, and its evolution line.

**Starters by region.** Your first run offers the three Kanto starters. Every Pokémon you catch, on any run, joins the starter pool for future runs, grouped by its home region (Kanto through Paldea).

**Main-series mechanics:**
- Stats come from base stats, IVs, EVs, nature and level, using the official formulas. EVs are earned from battles.
- Experience uses the six growth-rate curves and the Gen 7+ experience formula. Trainer battles give ×1.5, and Exp. Share is always on.
- Pokémon learn moves from their level-up learnsets (latest generation available). With four moves already known, you pick a move to forget or skip the new one.
- Evolution works by level, by item (stones and held items), by friendship (including day/night conditions), and by knowing a move. Trade evolutions and other special conditions use a Linking Cord. Evolution happens after battle and can be cancelled. Evolution moves are learned on evolving.
- Damage uses the Gen 5+ formula: STAB, type effectiveness, critical-hit stages, the random roll, burn, and the physical/special split. Battles also track stat stages, accuracy and evasion, priority, speed order, all major status conditions, confusion, flinching, recoil, drain, multi-hit, OHKO moves, charge and recharge turns, Protect, and a set of common abilities.
- Status conditions follow the main games and show under the HP bar: burn (1/16 HP per turn, halves physical damage), paralysis (Speed halved, 25% chance to be unable to move), poison (1/8), bad poison (1/16, 2/16, … and back to regular poison after battle), sleep (1–3 turns) and freeze (20% thaw chance per turn; Fire moves, Scald and self-thawing moves like Flame Wheel thaw it). Type immunities apply, including Grass types against powder moves.
- Catching uses the Gen 5+ catch formula with ball and status modifiers and shake checks.

**The map.** Each act is a branching map with these nodes:

| Node | What happens |
| --- | --- |
| 🌿 Wild Pokémon | Random wild Pokémon from all regions, scaled to the act |
| 🧢 Trainer | Random trainer classes with themed teams and prize money |
| 💀 Villain Team | Rocket, Magma, Aqua, Galactic, Plasma, Flare, Skull, Yell and Star grunts and admins |
| ⭐ Elite Pokémon | Powerful wild Pokémon with perfect IVs and rare drops |
| 🏅 Gym Battle | A random Gym Leader from any region, with badges |
| ✨ Legendary | One Legendary or Mythical encounter per act |
| 📖 Move Tutor | Teach TM/tutor moves for money, or relearn old moves for free |
| 🏪 PokéMart | Buy balls, medicine, Exp. Candy and evolution items |
| 🏥 Pokémon Center | Full heal, plus the PC Box |
| 👑 Boss | Act I: a Gym Leader. Act II: a villain team boss. Act III: four random Elite Four members from across the regions, then a random Champion, then the **Hall of Fame** |

If your whole team faints, the run ends. It's recorded in your history either way.

## Tech

- **Frontend:** plain HTML, CSS and JavaScript modules in `public/`. No build step. It's hosted on GitHub Pages.
- **Accounts and saves:** [Supabase](https://supabase.com) (Auth + Postgres), called from the browser with `supabase-js`. Row-level security in `supabase/schema.sql` limits every player to their own rows.
- **Data:** `public/data/*.json` is generated by `scripts/build-data.mjs` from [`@pkmn/dex`](https://www.npmjs.com/package/@pkmn/dex) (species, learnsets, evolutions, moves, type chart) and the [PokéAPI](https://pokeapi.co/) CSVs (catch rates, growth rates, base experience, EV yields). Sprites and cries load from the PokéAPI sprite and cry repositories.

```
public/            static site (index.html, css/, js/, data/)
  config.js        Supabase URL + anon key (not committed; written by the deploy workflow)
  js/api.js        accounts and saving (Supabase)
  js/data.js       data loading and lookups
  js/mechanics.js  stats, natures, experience, learnsets, evolution, catching
  js/battle.js     battle engine
  js/game.js       acts, map generation, encounters, rewards
  js/content.js    items, trainers, Gym Leaders, villain teams, Elite Four, Champions
  js/ui.js         screens and flows
  js/battle-ui.js  battle screen
  js/audio.js      chiptune music, sound effects, cries
supabase/schema.sql  database tables, security policies and sign-up trigger
scripts/           data generator and local server
tests/             mechanics and battle-engine tests
.github/workflows/deploy.yml  tests and deploys to GitHub Pages on every push to develop
```

## Setup

### 1. Supabase (one time)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of `supabase/schema.sql`, and click **Run**.
3. Under **Authentication → Sign In / Providers → Email**, choose whether players must confirm their email. If confirmation is on, set **Authentication → URL Configuration → Site URL** to your Pages URL (for example `https://rchalasani93.github.io/pokespire/`) so the confirmation link opens the game.
4. From **Project Settings → API**, copy the **Project URL** and the **anon public** key.

### 2. GitHub (one time)

1. **Settings → Secrets and variables → Actions → New repository secret:** add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
2. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
3. **Settings → Environments → github-pages → Deployment branches:** add `develop`. By default only the default branch is allowed to deploy.

Every push to `develop` then runs the tests and publishes the site. You can also run the workflow by hand from the **Actions** tab.

### Run locally

Requires Node.js 20+.

```bash
npm install
cp public/config.example.js public/config.js   # then fill in your Supabase URL and anon key
npm run dev                                    # http://localhost:8787
```

Run the tests with `npm test`. Regenerate the game data with `npm run build:data`.

## Disclaimer

PokéSpire is a non-commercial fan project. Pokémon and all related names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. This project is not affiliated with or endorsed by them.
