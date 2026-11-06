const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const html = readFileSync(require.resolve('../index.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('function combineCopies'));
const functionSource = [
  script.slice(script.indexOf('function updateUnitStats'), script.indexOf('\nfunction randomItem')),
  script.slice(script.indexOf('function sellPrice'), script.indexOf('\nfunction sellUnit')),
  script.slice(script.indexOf('function combineCopies'), script.indexOf('\nfunction buy'))
].join('\n');
const game = vm.createContext({
  bench: Array(9).fill(null), field: Array(42).fill(null), itemInventory: [],
  selected: null, selectedItemIndex: null, uid: 0
});
vm.runInContext(functionSource, game);

const reached = new Set();
for (let copy = 0; copy < 27; copy++) {
  const empty = game.bench.findIndex(unit => !unit);
  assert.notEqual(empty, -1, 'A new copy must fit before combining');
  game.bench[empty] = game.makeUnit({ name: 'Test Unit', cost: 2, traits: [], sigil: 'T' });
  for (const star of game.combineCopies('Test Unit')) reached.add(star);
}

const units = [...game.bench, ...game.field].filter(Boolean);
assert.equal(units.length, 1);
assert.equal(units[0].star, 4);
assert.equal(units[0].maxHp, 331);
assert.equal(units[0].attack, 63);
assert.equal(game.sellPrice(units[0]), 54);
assert.deepEqual([...reached].sort(), [2, 3, 4]);
console.log('27 copies combine into one 4-star unit with updated stats and sale value');
