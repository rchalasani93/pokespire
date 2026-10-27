// Items, trainers, Gym Leaders, villain teams, Elite Four and Champions.

// ---------- Items (prices are a tenth of the main-series games; runs start with $100) ----------
export const ITEMS = {
  'Poké Ball': { kind: 'ball', price: 20, slug: 'poke-ball', desc: 'A device for catching wild Pokémon.' },
  'Great Ball': { kind: 'ball', price: 60, slug: 'great-ball', desc: 'A good ball with a higher catch rate (×1.5).' },
  'Ultra Ball': { kind: 'ball', price: 80, slug: 'ultra-ball', desc: 'A high-performance ball (×2).' },
  'Quick Ball': { kind: 'ball', price: 100, slug: 'quick-ball', desc: '×5 catch rate on the first turn of a battle.' },
  'Dusk Ball': { kind: 'ball', price: 100, slug: 'dusk-ball', desc: '×3 catch rate at night (uses your clock).' },
  'Master Ball': { kind: 'ball', price: 0, slug: 'master-ball', desc: 'Catches any wild Pokémon without fail.' },

  'Potion': { kind: 'heal', amount: 20, price: 20, slug: 'potion', desc: 'Restores 20 HP.' },
  'Super Potion': { kind: 'heal', amount: 60, price: 70, slug: 'super-potion', desc: 'Restores 60 HP.' },
  'Hyper Potion': { kind: 'heal', amount: 120, price: 150, slug: 'hyper-potion', desc: 'Restores 120 HP.' },
  'Max Potion': { kind: 'heal', amount: 0, price: 250, slug: 'max-potion', desc: 'Fully restores HP.' },
  'Full Restore': { kind: 'heal', amount: 0, cure: true, price: 300, slug: 'full-restore', desc: 'Fully restores HP and cures status.' },
  'Revive': { kind: 'revive', price: 200, slug: 'revive', desc: 'Revives a fainted Pokémon with half its HP.' },
  'Max Revive': { kind: 'revive', full: true, price: 400, slug: 'max-revive', desc: 'Revives a fainted Pokémon with full HP.' },
  'Antidote': { kind: 'status', cures: ['psn', 'tox'], price: 10, slug: 'antidote', desc: 'Cures poison.' },
  'Paralyze Heal': { kind: 'status', cures: ['par'], price: 30, slug: 'paralyze-heal', desc: 'Cures paralysis.' },
  'Awakening': { kind: 'status', cures: ['slp'], price: 10, slug: 'awakening', desc: 'Wakes a sleeping Pokémon.' },
  'Burn Heal': { kind: 'status', cures: ['brn'], price: 30, slug: 'burn-heal', desc: 'Heals a burn.' },
  'Ice Heal': { kind: 'status', cures: ['frz'], price: 10, slug: 'ice-heal', desc: 'Thaws a frozen Pokémon.' },
  'Full Heal': { kind: 'status', cures: 'all', price: 40, slug: 'full-heal', desc: 'Cures any status condition.' },
  'Elixir': { kind: 'pp', all: true, amount: 10, price: 180, slug: 'elixir', desc: 'Restores 10 PP to each move.' },
  'Max Elixir': { kind: 'pp', all: true, amount: 0, price: 450, slug: 'max-elixir', desc: 'Fully restores the PP of each move.' },

  'Rare Candy': { kind: 'candy', price: 1000, slug: 'rare-candy', desc: 'Raises a Pokémon by one level.' },
  'Exp. Candy S': { kind: 'expcandy', amount: 800, price: 100, slug: 'exp-candy-s', desc: 'Gives 800 Exp. Points.' },
  'Exp. Candy M': { kind: 'expcandy', amount: 3000, price: 350, slug: 'exp-candy-m', desc: 'Gives 3,000 Exp. Points.' },
  'Exp. Candy L': { kind: 'expcandy', amount: 10000, price: 1000, slug: 'exp-candy-l', desc: 'Gives 10,000 Exp. Points.' },
  'Linking Cord': { kind: 'evo', price: 800, slug: 'linking-cord', desc: 'Evolves Pokémon that evolve by trade or special conditions.' },
};

// Evolution items (all used from the bag)
const EVO_ITEMS = {
  'Fire Stone': 'fire-stone', 'Water Stone': 'water-stone', 'Thunder Stone': 'thunder-stone', 'Leaf Stone': 'leaf-stone',
  'Moon Stone': 'moon-stone', 'Sun Stone': 'sun-stone', 'Shiny Stone': 'shiny-stone', 'Dusk Stone': 'dusk-stone',
  'Dawn Stone': 'dawn-stone', 'Ice Stone': 'ice-stone', "King's Rock": 'kings-rock', 'Metal Coat': 'metal-coat',
  'Dragon Scale': 'dragon-scale', 'Up-Grade': 'up-grade', 'Dubious Disc': 'dubious-disc', 'Protector': 'protector',
  'Electirizer': 'electirizer', 'Magmarizer': 'magmarizer', 'Reaper Cloth': 'reaper-cloth', 'Razor Claw': 'razor-claw',
  'Razor Fang': 'razor-fang', 'Oval Stone': 'oval-stone', 'Prism Scale': 'prism-scale', 'Deep Sea Tooth': 'deep-sea-tooth',
  'Deep Sea Scale': 'deep-sea-scale', 'Sachet': 'sachet', 'Whipped Dream': 'whipped-dream', 'Tart Apple': 'tart-apple',
  'Sweet Apple': 'sweet-apple', 'Syrupy Apple': 'syrupy-apple', 'Cracked Pot': 'cracked-pot', 'Black Augurite': 'black-augurite',
  'Metal Alloy': 'metal-alloy', 'Auspicious Armor': 'auspicious-armor', 'Malicious Armor': 'malicious-armor',
  'Unremarkable Teacup': 'unremarkable-teacup',
};
const STONES = ['Fire Stone', 'Water Stone', 'Thunder Stone', 'Leaf Stone', 'Moon Stone', 'Sun Stone', 'Shiny Stone', 'Dusk Stone', 'Dawn Stone', 'Ice Stone'];
for (const [name, slug] of Object.entries(EVO_ITEMS)) {
  ITEMS[name] = { kind: 'evo', price: STONES.includes(name) ? 300 : 500, slug, desc: 'Makes certain Pokémon evolve.' };
}
export const STONE_LIST = STONES;
export const EVO_ITEM_LIST = Object.keys(EVO_ITEMS);

// ---------- Difficulty modes ----------
// Easy/Medium follow the regular games; Hard follows common "hard mode" rules (higher levels,
// perfect-IV trainers, smart AI); Hell adds Nuzlocke rules on top (fainted = gone, no items in
// trainer battles) with maxed-out opponents.
export const DIFFICULTIES = {
  easy: {
    name: 'Easy', color: '#4cd07a',
    levelMult: 0.85, ivs: 'low', evs: 0, ai: 'basic', extraFullRestores: 0,
    expMult: 1.5, prizeMult: 1.5, priceMult: 0.75,
    bag: { 'Poké Ball': 10, 'Potion': 5, 'Revive': 1 },
    battleItems: true, permadeath: false,
    rules: ['Opponents are 15% lower level', 'Weaker opponent stats and simpler AI', '+50% Exp. and prize money', 'Shop prices 25% off', 'Starts with 10 Poké Balls, 5 Potions and a Revive'],
  },
  medium: {
    name: 'Medium', color: '#4aa3ff',
    levelMult: 1, ivs: 'random', evs: 0, ai: 'normal', extraFullRestores: 0,
    expMult: 1, prizeMult: 1, priceMult: 1,
    bag: { 'Poké Ball': 5, 'Potion': 3 },
    battleItems: true, permadeath: false,
    rules: ['The standard experience, balanced like the main games', 'Random opponent IVs; smarter Gym Leaders and bosses', 'Normal Exp., prize money and shop prices', 'Starts with 5 Poké Balls and 3 Potions'],
  },
  hard: {
    name: 'Hard', color: '#f2994a',
    levelMult: 1.1, ivs: 'trainersMax', evs: 0, ai: 'smart', extraFullRestores: 1,
    expMult: 1, prizeMult: 0.8, priceMult: 1.25,
    bag: { 'Poké Ball': 3, 'Potion': 1 },
    battleItems: true, permadeath: false,
    rules: ['Opponents are 10% higher level', 'Every trainer has perfect IVs and battles smart', 'Bosses carry an extra Full Restore', 'Prize money −20%, shop prices +25%', 'Starts with 3 Poké Balls and 1 Potion'],
  },
  hell: {
    name: 'Hell', color: '#eb5757',
    levelMult: 1.2, ivs: 'allMax', evs: 252, ai: 'smart', extraFullRestores: 2,
    expMult: 1, prizeMult: 0.5, priceMult: 1.5,
    bag: { 'Poké Ball': 3 },
    battleItems: false, permadeath: true,
    rules: ['Nuzlocke rules: a Pokémon that faints is gone for good', 'No items during trainer battles (Poké Balls still work on wild Pokémon)', 'Opponents are 20% higher level with perfect IVs and trained EVs', 'Bosses carry two extra Full Restores', 'Prize money halved, shop prices +50%, no Revives', 'Starts with 3 Poké Balls'],
  },
};
export const diffOf = run => DIFFICULTIES[run?.difficulty] || DIFFICULTIES.medium;

export const BAG_POCKETS = [
  ['Poké Balls', ['ball']],
  ['Medicine', ['heal', 'revive', 'status', 'pp']],
  ['Other', ['candy', 'expcandy', 'evo']],
];

// ---------- Trainer classes for random trainer battles ----------
export const TRAINER_CLASSES = [
  { title: 'Youngster', types: ['Normal', 'Bug', 'Flying'], sprite: 'youngster', pay: 16, minAct: 1 },
  { title: 'Lass', types: ['Normal', 'Fairy', 'Grass'], sprite: 'lass', pay: 16, minAct: 1 },
  { title: 'Bug Catcher', types: ['Bug'], sprite: 'bugcatcher', pay: 16, minAct: 1 },
  { title: 'Hiker', types: ['Rock', 'Ground', 'Fighting'], sprite: 'hiker', pay: 40, minAct: 1 },
  { title: 'Swimmer', types: ['Water'], sprite: 'swimmer', pay: 24, minAct: 1 },
  { title: 'Picnicker', types: ['Grass', 'Normal', 'Fairy'], sprite: 'picnicker', pay: 20, minAct: 1 },
  { title: 'Camper', types: ['Fire', 'Ground', 'Bug'], sprite: 'camper', pay: 20, minAct: 1 },
  { title: 'Fisherman', types: ['Water'], sprite: 'fisherman', pay: 40, minAct: 1 },
  { title: 'Black Belt', types: ['Fighting'], sprite: 'blackbelt', pay: 32, minAct: 1 },
  { title: 'Psychic', types: ['Psychic'], sprite: 'psychic', pay: 32, minAct: 2 },
  { title: 'Hex Maniac', types: ['Ghost', 'Psychic'], sprite: 'hexmaniac', pay: 32, minAct: 2 },
  { title: 'Beauty', types: ['Fairy', 'Water', 'Normal'], sprite: 'beauty', pay: 56, minAct: 2 },
  { title: 'Gentleman', types: ['Normal', 'Dark', 'Steel'], sprite: 'gentleman', pay: 80, minAct: 2 },
  { title: 'Ace Trainer', types: null, sprite: 'acetrainer', pay: 60, minAct: 2 },
  { title: 'Dragon Tamer', types: ['Dragon'], sprite: 'dragontamer', pay: 48, minAct: 3 },
  { title: 'Veteran', types: null, sprite: 'veteran', pay: 80, minAct: 3 },
];
export const TRAINER_NAMES = ['Joey', 'Ben', 'Liam', 'Ava', 'Mia', 'Noah', 'Ethan', 'Zoe', 'Kai', 'Iris', 'Leo', 'Nora', 'Owen', 'Ruby',
  'Sam', 'Tess', 'Max', 'Lily', 'Finn', 'Jade', 'Theo', 'Cleo', 'Hugo', 'Ivy', 'Milo', 'Rosa', 'Eli', 'Maya', 'Axel', 'Gwen'];

// ---------- Gym Leaders ----------
// Teams list signature Pokémon; levels and evolution stages are adjusted to the run.
export const GYM_LEADERS = [
  { name: 'Brock', region: 'Kanto', type: 'Rock', sprite: 'brock', badge: 'Boulder', team: ['Geodude', 'Onix', 'Rhyhorn', 'Omastar', 'Kabutops', 'Aerodactyl'] },
  { name: 'Misty', region: 'Kanto', type: 'Water', sprite: 'misty', badge: 'Cascade', team: ['Staryu', 'Psyduck', 'Seaking', 'Lapras', 'Gyarados', 'Starmie'] },
  { name: 'Lt. Surge', region: 'Kanto', type: 'Electric', sprite: 'ltsurge', badge: 'Thunder', team: ['Voltorb', 'Magnemite', 'Electabuzz', 'Jolteon', 'Electrode', 'Raichu'] },
  { name: 'Erika', region: 'Kanto', type: 'Grass', sprite: 'erika', badge: 'Rainbow', team: ['Tangela', 'Weepinbell', 'Jumpluff', 'Bellossom', 'Victreebel', 'Vileplume'] },
  { name: 'Koga', region: 'Kanto', type: 'Poison', sprite: 'koga', badge: 'Soul', team: ['Koffing', 'Venomoth', 'Arbok', 'Muk', 'Crobat', 'Weezing'] },
  { name: 'Sabrina', region: 'Kanto', type: 'Psychic', sprite: 'sabrina', badge: 'Marsh', team: ['Abra', 'Hypno', 'Jynx', 'Slowbro', 'Espeon', 'Alakazam'] },
  { name: 'Blaine', region: 'Kanto', type: 'Fire', sprite: 'blaine', badge: 'Volcano', team: ['Ponyta', 'Ninetales', 'Flareon', 'Magmar', 'Rapidash', 'Arcanine'] },
  { name: 'Giovanni', region: 'Kanto', type: 'Ground', sprite: 'giovanni', badge: 'Earth', team: ['Dugtrio', 'Marowak', 'Nidoqueen', 'Golem', 'Nidoking', 'Rhyperior'] },
  { name: 'Falkner', region: 'Johto', type: 'Flying', sprite: 'falkner', badge: 'Zephyr', team: ['Pidgey', 'Hoothoot', 'Dodrio', 'Xatu', 'Skarmory', 'Pidgeot'] },
  { name: 'Bugsy', region: 'Johto', type: 'Bug', sprite: 'bugsy', badge: 'Hive', team: ['Ledyba', 'Ariados', 'Yanmega', 'Pinsir', 'Heracross', 'Scizor'] },
  { name: 'Whitney', region: 'Johto', type: 'Normal', sprite: 'whitney', badge: 'Plain', team: ['Clefairy', 'Girafarig', 'Wigglytuff', 'Ursaring', 'Ambipom', 'Miltank'] },
  { name: 'Morty', region: 'Johto', type: 'Ghost', sprite: 'morty', badge: 'Fog', team: ['Gastly', 'Misdreavus', 'Haunter', 'Mismagius', 'Dusknoir', 'Gengar'] },
  { name: 'Chuck', region: 'Johto', type: 'Fighting', sprite: 'chuck', badge: 'Storm', team: ['Mankey', 'Hitmonlee', 'Hitmonchan', 'Primeape', 'Machamp', 'Poliwrath'] },
  { name: 'Jasmine', region: 'Johto', type: 'Steel', sprite: 'jasmine', badge: 'Mineral', team: ['Magnemite', 'Forretress', 'Skarmory', 'Scizor', 'Magnezone', 'Steelix'] },
  { name: 'Pryce', region: 'Johto', type: 'Ice', sprite: 'pryce', badge: 'Glacier', team: ['Seel', 'Swinub', 'Cloyster', 'Dewgong', 'Lapras', 'Mamoswine'] },
  { name: 'Clair', region: 'Johto', type: 'Dragon', sprite: 'clair', badge: 'Rising', team: ['Dratini', 'Horsea', 'Gyarados', 'Dragonair', 'Dragonite', 'Kingdra'] },
  { name: 'Roxanne', region: 'Hoenn', type: 'Rock', sprite: 'roxanne', badge: 'Stone', team: ['Geodude', 'Nosepass', 'Lileep', 'Anorith', 'Relicanth', 'Probopass'] },
  { name: 'Brawly', region: 'Hoenn', type: 'Fighting', sprite: 'brawly', badge: 'Knuckle', team: ['Machop', 'Makuhita', 'Meditite', 'Breloom', 'Hitmontop', 'Hariyama'] },
  { name: 'Wattson', region: 'Hoenn', type: 'Electric', sprite: 'wattson', badge: 'Dynamo', team: ['Magnemite', 'Voltorb', 'Electrike', 'Ampharos', 'Electrode', 'Manectric'] },
  { name: 'Flannery', region: 'Hoenn', type: 'Fire', sprite: 'flannery', badge: 'Heat', team: ['Slugma', 'Numel', 'Magcargo', 'Houndoom', 'Camerupt', 'Torkoal'] },
  { name: 'Norman', region: 'Hoenn', type: 'Normal', sprite: 'norman', badge: 'Balance', team: ['Slakoth', 'Zigzagoon', 'Spinda', 'Linoone', 'Kangaskhan', 'Slaking'] },
  { name: 'Winona', region: 'Hoenn', type: 'Flying', sprite: 'winona', badge: 'Feather', team: ['Swablu', 'Tropius', 'Pelipper', 'Skarmory', 'Swellow', 'Altaria'] },
  { name: 'Tate & Liza', region: 'Hoenn', type: 'Psychic', sprite: 'tateandliza-gen3', badge: 'Mind', team: ['Baltoy', 'Xatu', 'Claydol', 'Gardevoir', 'Lunatone', 'Solrock'] },
  { name: 'Wallace', region: 'Hoenn', type: 'Water', sprite: 'wallace', badge: 'Rain', team: ['Luvdisc', 'Whiscash', 'Sealeo', 'Ludicolo', 'Starmie', 'Milotic'] },
  { name: 'Roark', region: 'Sinnoh', type: 'Rock', sprite: 'roark', badge: 'Coal', team: ['Geodude', 'Onix', 'Cranidos', 'Bastiodon', 'Golem', 'Rampardos'] },
  { name: 'Gardenia', region: 'Sinnoh', type: 'Grass', sprite: 'gardenia', badge: 'Forest', team: ['Turtwig', 'Cherrim', 'Tangrowth', 'Leafeon', 'Torterra', 'Roserade'] },
  { name: 'Maylene', region: 'Sinnoh', type: 'Fighting', sprite: 'maylene', badge: 'Cobble', team: ['Meditite', 'Machoke', 'Toxicroak', 'Medicham', 'Machamp', 'Lucario'] },
  { name: 'Crasher Wake', region: 'Sinnoh', type: 'Water', sprite: 'crasherwake', badge: 'Fen', team: ['Buizel', 'Quagsire', 'Gastrodon', 'Gyarados', 'Empoleon', 'Floatzel'] },
  { name: 'Fantina', region: 'Sinnoh', type: 'Ghost', sprite: 'fantina', badge: 'Relic', team: ['Duskull', 'Drifloon', 'Haunter', 'Gengar', 'Drifblim', 'Mismagius'] },
  { name: 'Byron', region: 'Sinnoh', type: 'Steel', sprite: 'byron', badge: 'Mine', team: ['Bronzor', 'Magneton', 'Steelix', 'Bronzong', 'Empoleon', 'Bastiodon'] },
  { name: 'Candice', region: 'Sinnoh', type: 'Ice', sprite: 'candice', badge: 'Icicle', team: ['Snover', 'Sneasel', 'Glaceon', 'Mamoswine', 'Weavile', 'Froslass'] },
  { name: 'Volkner', region: 'Sinnoh', type: 'Electric', sprite: 'volkner', badge: 'Beacon', team: ['Shinx', 'Raichu', 'Jolteon', 'Ambipom', 'Electivire', 'Luxray'] },
  { name: 'Lenora', region: 'Unova', type: 'Normal', sprite: 'lenora', badge: 'Basic', team: ['Lillipup', 'Watchog', 'Herdier', 'Cinccino', 'Bouffalant', 'Stoutland'] },
  { name: 'Burgh', region: 'Unova', type: 'Bug', sprite: 'burgh', badge: 'Insect', team: ['Sewaddle', 'Whirlipede', 'Crustle', 'Escavalier', 'Scolipede', 'Leavanny'] },
  { name: 'Elesa', region: 'Unova', type: 'Electric', sprite: 'elesa', badge: 'Bolt', team: ['Emolga', 'Blitzle', 'Joltik', 'Galvantula', 'Eelektross', 'Zebstrika'] },
  { name: 'Clay', region: 'Unova', type: 'Ground', sprite: 'clay', badge: 'Quake', team: ['Drilbur', 'Sandile', 'Palpitoad', 'Golurk', 'Krookodile', 'Excadrill'] },
  { name: 'Skyla', region: 'Unova', type: 'Flying', sprite: 'skyla', badge: 'Jet', team: ['Woobat', 'Ducklett', 'Unfezant', 'Sigilyph', 'Braviary', 'Swanna'] },
  { name: 'Brycen', region: 'Unova', type: 'Ice', sprite: 'brycen', badge: 'Freeze', team: ['Vanillite', 'Cubchoo', 'Cryogonal', 'Vanilluxe', 'Weavile', 'Beartic'] },
  { name: 'Drayden', region: 'Unova', type: 'Dragon', sprite: 'drayden', badge: 'Legend', team: ['Axew', 'Druddigon', 'Fraxure', 'Flygon', 'Hydreigon', 'Haxorus'] },
  { name: 'Roxie', region: 'Unova', type: 'Poison', sprite: 'roxie', badge: 'Toxic', team: ['Koffing', 'Grimer', 'Whirlipede', 'Amoonguss', 'Garbodor', 'Scolipede'] },
  { name: 'Viola', region: 'Kalos', type: 'Bug', sprite: 'viola', badge: 'Bug', team: ['Surskit', 'Scatterbug', 'Masquerain', 'Pinsir', 'Volcarona', 'Vivillon'] },
  { name: 'Grant', region: 'Kalos', type: 'Rock', sprite: 'grant', badge: 'Cliff', team: ['Amaura', 'Tyrunt', 'Binacle', 'Barbaracle', 'Aurorus', 'Tyrantrum'] },
  { name: 'Korrina', region: 'Kalos', type: 'Fighting', sprite: 'korrina', badge: 'Rumble', team: ['Mienfoo', 'Machoke', 'Pangoro', 'Hawlucha', 'Mienshao', 'Lucario'] },
  { name: 'Ramos', region: 'Kalos', type: 'Grass', sprite: 'ramos', badge: 'Plant', team: ['Skiddo', 'Jumpluff', 'Weepinbell', 'Trevenant', 'Victreebel', 'Gogoat'] },
  { name: 'Clemont', region: 'Kalos', type: 'Electric', sprite: 'clemont', badge: 'Voltage', team: ['Helioptile', 'Emolga', 'Magneton', 'Luxray', 'Magnezone', 'Heliolisk'] },
  { name: 'Valerie', region: 'Kalos', type: 'Fairy', sprite: 'valerie', badge: 'Fairy', team: ['Spritzee', 'Mawile', 'Swirlix', 'Aromatisse', 'Slurpuff', 'Sylveon'] },
  { name: 'Olympia', region: 'Kalos', type: 'Psychic', sprite: 'olympia', badge: 'Psychic', team: ['Espurr', 'Sigilyph', 'Slowking', 'Delphox', 'Gothitelle', 'Meowstic'] },
  { name: 'Wulfric', region: 'Kalos', type: 'Ice', sprite: 'wulfric', badge: 'Iceberg', team: ['Bergmite', 'Snover', 'Cryogonal', 'Abomasnow', 'Mamoswine', 'Avalugg'] },
  { name: 'Milo', region: 'Galar', type: 'Grass', sprite: 'milo', badge: 'Grass', team: ['Gossifleur', 'Applin', 'Ludicolo', 'Flapple', 'Appletun', 'Eldegoss'] },
  { name: 'Nessa', region: 'Galar', type: 'Water', sprite: 'nessa', badge: 'Water', team: ['Chewtle', 'Arrokuda', 'Pelipper', 'Golisopod', 'Barraskewda', 'Drednaw'] },
  { name: 'Kabu', region: 'Galar', type: 'Fire', sprite: 'kabu', badge: 'Fire', team: ['Sizzlipede', 'Ninetales', 'Arcanine', 'Torkoal', 'Coalossal', 'Centiskorch'] },
  { name: 'Bea', region: 'Galar', type: 'Fighting', sprite: 'bea', badge: 'Fighting', team: ['Clobbopus', 'Hitmontop', 'Pangoro', 'Falinks', 'Machamp', 'Grapploct'] },
  { name: 'Allister', region: 'Galar', type: 'Ghost', sprite: 'allister', badge: 'Ghost', team: ['Yamask', 'Sinistea', 'Mimikyu', 'Cursola', 'Polteageist', 'Gengar'] },
  { name: 'Opal', region: 'Galar', type: 'Fairy', sprite: 'opal', badge: 'Fairy', team: ['Milcery', 'Weezing', 'Mawile', 'Togekiss', 'Hatterene', 'Alcremie'] },
  { name: 'Gordie', region: 'Galar', type: 'Rock', sprite: 'gordie', badge: 'Rock', team: ['Rolycoly', 'Sudowoodo', 'Barbaracle', 'Shuckle', 'Stonjourner', 'Coalossal'] },
  { name: 'Melony', region: 'Galar', type: 'Ice', sprite: 'melony', badge: 'Ice', team: ['Snom', 'Eiscue', 'Mr. Rime', 'Frosmoth', 'Lapras', 'Lapras'] },
  { name: 'Piers', region: 'Galar', type: 'Dark', sprite: 'piers', badge: 'Dark', team: ['Nickit', 'Scrafty', 'Malamar', 'Skuntank', 'Thievul', 'Obstagoon'] },
  { name: 'Raihan', region: 'Galar', type: 'Dragon', sprite: 'raihan', badge: 'Dragon', team: ['Duraludon', 'Flygon', 'Sandaconda', 'Turtonator', 'Goodra', 'Duraludon'] },
  { name: 'Katy', region: 'Paldea', type: 'Bug', sprite: 'katy', badge: 'Bug', team: ['Nymble', 'Tarountula', 'Spidops', 'Forretress', 'Lokix', 'Ursaring'] },
  { name: 'Brassius', region: 'Paldea', type: 'Grass', sprite: 'brassius', badge: 'Grass', team: ['Smoliv', 'Petilil', 'Sudowoodo', 'Breloom', 'Lilligant', 'Arboliva'] },
  { name: 'Iono', region: 'Paldea', type: 'Electric', sprite: 'iono', badge: 'Electric', team: ['Wattrel', 'Tadbulb', 'Mismagius', 'Luxray', 'Kilowattrel', 'Bellibolt'] },
  { name: 'Kofu', region: 'Paldea', type: 'Water', sprite: 'kofu', badge: 'Water', team: ['Wiglett', 'Veluza', 'Wugtrio', 'Clauncher', 'Clawitzer', 'Crabominable'] },
  { name: 'Larry', region: 'Paldea', type: 'Normal', sprite: 'larry', badge: 'Normal', team: ['Tandemaus', 'Komala', 'Dudunsparce', 'Maushold', 'Staraptor', 'Dudunsparce'] },
  { name: 'Ryme', region: 'Paldea', type: 'Ghost', sprite: 'ryme', badge: 'Ghost', team: ['Greavard', 'Banette', 'Mimikyu', 'Houndstone', 'Toxtricity', 'Houndstone'] },
  { name: 'Tulip', region: 'Paldea', type: 'Psychic', sprite: 'tulip', badge: 'Psychic', team: ['Flittle', 'Farigiraf', 'Gardevoir', 'Florges', 'Espathra', 'Espathra'] },
  { name: 'Grusha', region: 'Paldea', type: 'Ice', sprite: 'grusha', badge: 'Ice', team: ['Cetoddle', 'Frosmoth', 'Beartic', 'Cetitan', 'Altaria', 'Altaria'] },
];

// ---------- Villain teams ----------
export const VILLAINS = [
  { team: 'Team Rocket', grunt: 'rocketgrunt', boss: { name: 'Giovanni', title: 'Rocket Boss', sprite: 'giovanni', team: ['Persian', 'Honchkrow', 'Kangaskhan', 'Nidoqueen', 'Nidoking', 'Rhyperior'] }, admins: ['Archer', 'Ariana', 'Proton', 'Petrel'], pool: ['Rattata', 'Ekans', 'Zubat', 'Koffing', 'Grimer', 'Meowth', 'Drowzee', 'Houndour', 'Murkrow'], color: '#b8282e', quote: 'Prepare for trouble!' },
  { team: 'Team Magma', grunt: 'magmagrunt', boss: { name: 'Maxie', title: 'Magma Leader', sprite: 'maxie', team: ['Mightyena', 'Crobat', 'Weezing', 'Torkoal', 'Houndoom', 'Camerupt'] }, admins: ['Tabitha', 'Courtney'], pool: ['Poochyena', 'Numel', 'Zubat', 'Baltoy', 'Slugma', 'Koffing'], color: '#c0392b', quote: 'More land for everyone!' },
  { team: 'Team Aqua', grunt: 'aquagrunt', boss: { name: 'Archie', title: 'Aqua Leader', sprite: 'archie', team: ['Mightyena', 'Crobat', 'Muk', 'Wailord', 'Kingdra', 'Sharpedo'] }, admins: ['Matt', 'Shelly'], pool: ['Poochyena', 'Carvanha', 'Zubat', 'Wailmer', 'Tentacool', 'Corphish'], color: '#2471a3', quote: 'The sea gave birth to all life!' },
  { team: 'Team Galactic', grunt: 'galacticgrunt', boss: { name: 'Cyrus', title: 'Galactic Boss', sprite: 'cyrus', team: ['Houndoom', 'Honchkrow', 'Crobat', 'Gyarados', 'Bronzong', 'Weavile'] }, admins: ['Mars', 'Jupiter', 'Saturn'], pool: ['Glameow', 'Stunky', 'Zubat', 'Croagunk', 'Bronzor', 'Murkrow'], color: '#5d6d7e', quote: 'A new world is coming.' },
  { team: 'Team Plasma', grunt: 'plasmagrunt', boss: { name: 'Ghetsis', title: 'Plasma Leader', sprite: 'ghetsis', team: ['Cofagrigus', 'Bouffalant', 'Seismitoad', 'Bisharp', 'Eelektross', 'Hydreigon'] }, admins: ['Zinzolin', 'Colress'], pool: ['Patrat', 'Purrloin', 'Trubbish', 'Sandile', 'Scraggy', 'Watchog'], color: '#4a6fa5', quote: 'Liberate the Pokémon!' },
  { team: 'Team Flare', grunt: 'flaregrunt', boss: { name: 'Lysandre', title: 'Flare Boss', sprite: 'lysandre', team: ['Mienshao', 'Honchkrow', 'Pyroar', 'Gyarados', 'Houndoom', 'Pyroar'] }, admins: ['Celosia', 'Mable', 'Xerosic'], pool: ['Houndour', 'Croagunk', 'Scraggy', 'Litleo', 'Golbat', 'Swirlix'], color: '#e67e22', quote: 'Only the chosen will survive.' },
  { team: 'Team Skull', grunt: 'skullgrunt', boss: { name: 'Guzma', title: 'Skull Boss', sprite: 'guzma', team: ['Ariados', 'Masquerain', 'Pinsir', 'Vikavolt', 'Scizor', 'Golisopod'] }, admins: ['Plumeria'], pool: ['Zubat', 'Yungoos', 'Salandit', 'Mareanie', 'Drowzee', 'Wimpod'], color: '#7f8c8d', quote: 'Big bad Team Skull!' },
  { team: 'Team Yell', grunt: 'teamyellgrunt', boss: { name: 'Marnie', title: 'Team Yell Idol', sprite: 'marnie', team: ['Liepard', 'Toxicroak', 'Scrafty', 'Morpeko', 'Obstagoon', 'Grimmsnarl'] }, admins: ['Piers'], pool: ['Impidimp', 'Nickit', 'Purrloin', 'Scraggy', 'Croagunk', 'Morpeko'], color: '#2c2c2c', quote: 'Go, go, Marnie!' },
  { team: 'Team Star', grunt: 'teamstargrunt', boss: { name: 'Penny', title: 'Team Star Boss', sprite: 'penny', team: ['Umbreon', 'Vaporeon', 'Jolteon', 'Flareon', 'Leafeon', 'Sylveon'] }, admins: ['Giacomo', 'Mela', 'Atticus', 'Ortega', 'Eri'], pool: ['Murkrow', 'Shroodle', 'Varoom', 'Flittle', 'Tinkatink', 'Toedscool'], color: '#8e44ad', quote: 'Star Barrage!' },
];

// ---------- Elite Four ----------
export const ELITE_FOUR = [
  { name: 'Lorelei', region: 'Kanto', type: 'Ice', sprite: 'lorelei', team: ['Dewgong', 'Cloyster', 'Slowbro', 'Jynx', 'Lapras'] },
  { name: 'Bruno', region: 'Kanto', type: 'Fighting', sprite: 'bruno', team: ['Onix', 'Hitmonchan', 'Hitmonlee', 'Steelix', 'Machamp'] },
  { name: 'Agatha', region: 'Kanto', type: 'Ghost', sprite: 'agatha', team: ['Gengar', 'Golbat', 'Haunter', 'Arbok', 'Mismagius'] },
  { name: 'Lance', region: 'Kanto', type: 'Dragon', sprite: 'lance', team: ['Gyarados', 'Dragonair', 'Aerodactyl', 'Kingdra', 'Dragonite'] },
  { name: 'Will', region: 'Johto', type: 'Psychic', sprite: 'will', team: ['Xatu', 'Jynx', 'Exeggutor', 'Slowbro', 'Espeon'] },
  { name: 'Koga', region: 'Johto', type: 'Poison', sprite: 'koga', team: ['Ariados', 'Venomoth', 'Forretress', 'Muk', 'Crobat'] },
  { name: 'Karen', region: 'Johto', type: 'Dark', sprite: 'karen', team: ['Umbreon', 'Vileplume', 'Gengar', 'Murkrow', 'Houndoom'] },
  { name: 'Sidney', region: 'Hoenn', type: 'Dark', sprite: 'sidney', team: ['Mightyena', 'Shiftry', 'Cacturne', 'Crawdaunt', 'Absol'] },
  { name: 'Phoebe', region: 'Hoenn', type: 'Ghost', sprite: 'phoebe', team: ['Dusclops', 'Banette', 'Sableye', 'Banette', 'Dusknoir'] },
  { name: 'Glacia', region: 'Hoenn', type: 'Ice', sprite: 'glacia', team: ['Glalie', 'Froslass', 'Sealeo', 'Glalie', 'Walrein'] },
  { name: 'Drake', region: 'Hoenn', type: 'Dragon', sprite: 'drake', team: ['Shelgon', 'Altaria', 'Kingdra', 'Flygon', 'Salamence'] },
  { name: 'Aaron', region: 'Sinnoh', type: 'Bug', sprite: 'aaron', team: ['Dustox', 'Beautifly', 'Vespiquen', 'Heracross', 'Drapion'] },
  { name: 'Bertha', region: 'Sinnoh', type: 'Ground', sprite: 'bertha', team: ['Quagsire', 'Sudowoodo', 'Golem', 'Whiscash', 'Hippowdon'] },
  { name: 'Flint', region: 'Sinnoh', type: 'Fire', sprite: 'flint', team: ['Rapidash', 'Infernape', 'Magmortar', 'Flareon', 'Houndoom'] },
  { name: 'Lucian', region: 'Sinnoh', type: 'Psychic', sprite: 'lucian', team: ['Mr. Mime', 'Girafarig', 'Medicham', 'Alakazam', 'Bronzong'] },
  { name: 'Shauntal', region: 'Unova', type: 'Ghost', sprite: 'shauntal', team: ['Cofagrigus', 'Jellicent', 'Golurk', 'Drifblim', 'Chandelure'] },
  { name: 'Grimsley', region: 'Unova', type: 'Dark', sprite: 'grimsley', team: ['Scrafty', 'Liepard', 'Krookodile', 'Honchkrow', 'Bisharp'] },
  { name: 'Caitlin', region: 'Unova', type: 'Psychic', sprite: 'caitlin', team: ['Musharna', 'Sigilyph', 'Reuniclus', 'Metagross', 'Gothitelle'] },
  { name: 'Marshal', region: 'Unova', type: 'Fighting', sprite: 'marshal', team: ['Throh', 'Sawk', 'Mienshao', 'Lucario', 'Conkeldurr'] },
  { name: 'Malva', region: 'Kalos', type: 'Fire', sprite: 'malva', team: ['Pyroar', 'Torkoal', 'Houndoom', 'Chandelure', 'Talonflame'] },
  { name: 'Siebold', region: 'Kalos', type: 'Water', sprite: 'siebold', team: ['Clawitzer', 'Starmie', 'Gyarados', 'Milotic', 'Barbaracle'] },
  { name: 'Wikstrom', region: 'Kalos', type: 'Steel', sprite: 'wikstrom', team: ['Klefki', 'Probopass', 'Scizor', 'Metagross', 'Aegislash'] },
  { name: 'Drasna', region: 'Kalos', type: 'Dragon', sprite: 'drasna', team: ['Dragalge', 'Druddigon', 'Altaria', 'Goodra', 'Noivern'] },
  { name: 'Hala', region: 'Alola', type: 'Fighting', sprite: 'hala', team: ['Hariyama', 'Primeape', 'Bewear', 'Poliwrath', 'Crabominable'] },
  { name: 'Olivia', region: 'Alola', type: 'Rock', sprite: 'olivia', team: ['Relicanth', 'Carbink', 'Golem', 'Probopass', 'Lycanroc'] },
  { name: 'Acerola', region: 'Alola', type: 'Ghost', sprite: 'acerola', team: ['Sableye', 'Drifblim', 'Dhelmise', 'Froslass', 'Palossand'] },
  { name: 'Kahili', region: 'Alola', type: 'Flying', sprite: 'kahili', team: ['Skarmory', 'Crobat', 'Oricorio', 'Mandibuzz', 'Toucannon'] },
  { name: 'Rika', region: 'Paldea', type: 'Ground', sprite: 'rika', team: ['Whiscash', 'Camerupt', 'Donphan', 'Dugtrio', 'Clodsire'] },
  { name: 'Poppy', region: 'Paldea', type: 'Steel', sprite: 'poppy', team: ['Copperajah', 'Magnezone', 'Bronzong', 'Corviknight', 'Tinkaton'] },
  { name: 'Larry', region: 'Paldea', type: 'Flying', sprite: 'larry-elite', team: ['Tropius', 'Oricorio', 'Altaria', 'Staraptor', 'Flamigo'] },
  { name: 'Hassel', region: 'Paldea', type: 'Dragon', sprite: 'hassel', team: ['Noivern', 'Haxorus', 'Dragalge', 'Flapple', 'Baxcalibur'] },
];

// ---------- Champions ----------
export const CHAMPIONS = [
  { name: 'Blue', region: 'Kanto', sprite: 'blue', team: ['Pidgeot', 'Alakazam', 'Rhydon', 'Arcanine', 'Exeggutor', 'Blastoise'] },
  { name: 'Lance', region: 'Johto', sprite: 'lance', team: ['Gyarados', 'Dragonite', 'Aerodactyl', 'Charizard', 'Kingdra', 'Dragonite'] },
  { name: 'Steven', region: 'Hoenn', sprite: 'steven', team: ['Skarmory', 'Claydol', 'Aggron', 'Cradily', 'Armaldo', 'Metagross'] },
  { name: 'Wallace', region: 'Hoenn', sprite: 'wallace', team: ['Wailord', 'Tentacruel', 'Ludicolo', 'Whiscash', 'Gyarados', 'Milotic'] },
  { name: 'Cynthia', region: 'Sinnoh', sprite: 'cynthia', team: ['Spiritomb', 'Roserade', 'Gastrodon', 'Lucario', 'Milotic', 'Garchomp'] },
  { name: 'Alder', region: 'Unova', sprite: 'alder', team: ['Accelgor', 'Bouffalant', 'Druddigon', 'Vanilluxe', 'Escavalier', 'Volcarona'] },
  { name: 'Iris', region: 'Unova', sprite: 'iris', team: ['Hydreigon', 'Druddigon', 'Lapras', 'Aggron', 'Archeops', 'Haxorus'] },
  { name: 'Diantha', region: 'Kalos', sprite: 'diantha', team: ['Hawlucha', 'Tyrantrum', 'Aurorus', 'Gourgeist', 'Goodra', 'Gardevoir'] },
  { name: 'Kukui', region: 'Alola', sprite: 'kukui', team: ['Lycanroc', 'Ninetales', 'Braviary', 'Magnezone', 'Snorlax', 'Incineroar'] },
  { name: 'Leon', region: 'Galar', sprite: 'leon', team: ['Aegislash', 'Dragapult', 'Haxorus', 'Seismitoad', 'Mr. Rime', 'Charizard'] },
  { name: 'Geeta', region: 'Paldea', sprite: 'geeta', team: ['Espathra', 'Gogoat', 'Veluza', 'Avalugg', 'Kingambit', 'Glimmora'] },
  { name: 'Red', region: 'Kanto', sprite: 'red', team: ['Pikachu', 'Espeon', 'Snorlax', 'Venusaur', 'Blastoise', 'Charizard'] },
];

export const trainerSpriteUrl = name => `https://play.pokemonshowdown.com/sprites/trainers/${name}.png`;
