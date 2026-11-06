const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const html = readFileSync(require.resolve('../index.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('function combineItems'));
const definitions = script.slice(script.indexOf('const itemPool=['), script.indexOf('\nconst BOARD_COLUMNS='));
const crafting = script.slice(script.indexOf('function renderItems(){'), script.indexOf('\nfunction renderShop(){'));

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.scrollTop = 0;
    this.scrollHeight = 300;
    this.classList = { values: new Set(), toggle() {}, add(name) { this.values.add(name); } };
  }
  replaceChildren() { this.children = []; }
  appendChild(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
}

const selectors = ['#items', '#item-description', '#item-count', '#item-combine-btn', '#item-recipes-btn', '#item-recipes-modal', '#item-tip', '#item-recipe-list'];
const nodes = new Map(selectors.map(selector => [selector, new Element()]));
const context = vm.createContext({
  document: { createElement: () => new Element() },
  $: selector => nodes.get(selector),
  itemInventory: [], selectedItemIndex: null, combineMode: false, combineFirstIndex: null,
  combatActive: false, skipItemClick: false, selected: null,
  beginItemDrag() {}, toast() {}
});
vm.runInContext(`${definitions}\n${crafting}`, context);
context.render = () => context.renderItems();
for (const line of script.split(/\r?\n/).filter(line => line.includes("$('#item-combine-btn').onclick") || line.includes("$('#item-recipes-btn').onclick"))) vm.runInContext(line, context);

assert.equal(vm.runInContext('itemRecipes.length', context), 10);
assert.equal(vm.runInContext('itemRecipes.every(recipe => recipe.parts[0] <= recipe.parts[1])', context), true);
for (let first = 0; first < 4; first++) {
  for (let second = first; second < 4; second++) {
    assert.equal(vm.runInContext(`Boolean(findItemRecipe(itemPool[${first}], itemPool[${second}]))`, context), true);
  }
}
nodes.get('#item-recipes-btn').onclick();
assert.equal(nodes.get('#item-recipe-list').children.length, 10);
assert.equal(nodes.get('#item-recipes-modal').classList.values.has('open'), true);

vm.runInContext('itemInventory=[itemPool[0],itemPool[1]]', context);
nodes.get('#item-combine-btn').onclick();
assert.equal(context.combineMode, true);
nodes.get('#items').children[0].onclick();
assert.equal(context.combineFirstIndex, 0);
nodes.get('#items').children[1].onclick();
assert.equal(context.itemInventory.length, 1);
assert.equal(context.itemInventory[0].name, vm.runInContext('itemRecipes[1].result.name', context));
assert.equal(context.combineMode, false);
assert.equal(context.selectedItemIndex, null);

vm.runInContext('itemInventory.push(itemPool[0])', context);
assert.equal(context.combineItems(0, 1), false);
assert.equal(context.itemInventory.length, 2);
vm.runInContext('itemInventory=[itemPool[0],itemPool[0]]', context);
assert.equal(context.combineItems(0, 1), true);
assert.equal(context.itemInventory.length, 1);
assert.equal(context.itemInventory[0].name, vm.runInContext('itemRecipes[0].result.name', context));
vm.runInContext(script.slice(script.indexOf('function updateUnitStats'), script.indexOf('\nfunction makeUnit')), context);
const equipped = { cost: 1, star: 1, items: [context.itemInventory[0]], maxHp: 0, hp: 0 };
context.updateUnitStats(equipped, true);
assert.equal(equipped.attack, 51);
assert.equal(equipped.maxHp, 118);
console.log('Ten recipes, click crafting, duplicate parts, and crafted-item restriction passed');
