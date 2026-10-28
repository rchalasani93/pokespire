// Puts moves learned at the same level (mostly the level 1 moves) in the order the main games list them,
// so a Pokémon's starting moves match the mainline: it knows the last four moves it could have learned.
// Usage: node scripts/learnset-order.mjs   (rewrites public/data/learnsets.json; needs network)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
// Newest mainline version groups first: SV (+ DLC), SwSh, BDSP, USUM, SM, ORAS, XY, B2W2, BW, HGSS, Pt, DP
const VERSION_GROUPS = ['25', '26', '27', '20', '23', '18', '17', '16', '15', '14', '11', '10', '9', '8'];
const LEVEL_UP = '1';

async function rows(name) {
  const text = await (await fetch(CSV + name + '.csv')).text();
  const [head, ...rest] = text.trim().split('\n');
  const cols = head.split(',');
  return rest.map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])));
}

export async function orderLearnsets(learnsets) {
  const moveId = Object.fromEntries((await rows('moves')).map(r => [r.id, r.identifier.replace(/-/g, '')]));
  // order[species][versionGroup][move] = in-game position among moves learned at that level
  const order = {};
  for (const r of await rows('pokemon_moves')) {
    if (r.pokemon_move_method_id !== LEVEL_UP || !VERSION_GROUPS.includes(r.version_group_id)) continue;
    ((order[r.pokemon_id] ||= {})[r.version_group_id] ||= {})[moveId[r.move_id]] = +r.order || 0;
  }
  for (const [num, list] of Object.entries(learnsets)) {
    const byVg = order[num] || {};
    const moves = list.map(([, m]) => m);
    // The newest game whose list covers the most of this learnset
    let best = null, bestHits = 0;
    for (const vg of VERSION_GROUPS) {
      const hits = moves.filter(m => byVg[vg]?.[m] != null).length;
      if (hits > bestHits) { best = byVg[vg]; bestHits = hits; }
    }
    if (!best) continue;
    list.sort((a, b) => a[0] - b[0] || (best[a[1]] ?? 99) - (best[b[1]] ?? 99) || a[1].localeCompare(b[1]));
  }
  return learnsets;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = 'public/data/learnsets.json';
  const learnsets = await orderLearnsets(JSON.parse(readFileSync(path, 'utf8')));
  writeFileSync(path, JSON.stringify(learnsets));
  console.log('Ordered learnsets for', Object.keys(learnsets).length, 'species');
}
