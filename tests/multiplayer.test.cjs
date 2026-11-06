const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const { simulate, flip, pairings } = require('../pvp-engine.js');

const team = [{ id: 1, cell: 49, maxHp: 120, attack: 25, lifesteal: 0 }];
const first = simulate(team, team, 'same-round');
assert.deepEqual(first, simulate(team, team, 'same-round'));
assert.equal(flip(flip(49)), 49);
for (const tick of first.ticks) {
  const living = tick.units.filter(unit => unit.hp > 0);
  assert.equal(new Set(living.map(unit => unit.cell)).size, living.length);
}
const ids = ['Alice', 'Bob', 'Carol', 'Dave'];
const seenPairs = new Set();
for (let round = 0; round < 3; round++) {
  const pairs = pairings(ids, round);
  assert.equal(pairs.length, 2);
  for (const pair of pairs) seenPairs.add(pair.slice().sort().join(':'));
}
assert.equal(seenPairs.size, 6);
assert.deepEqual(pairings(ids, 3), pairings(ids, 0));

const source = readFileSync(require.resolve('../multiplayer.js'), 'utf8');
const channels = [];
function makeClient(id) {
  return {
    auth: { getUser: async () => ({ data: { user: { id, email: `${id}@example.invalid`, user_metadata: { username: id } } } }) },
    channel(topic) {
      const room = {
        topic, key: '', state: null, presence: null, broadcast: null,
        presenceState() {
          const state = {};
          for (const peer of channels.filter(other => other.topic === topic && other.state)) state[peer.key] = [peer.state];
          return state;
        },
        on(kind, filter, fn) { this[kind] = fn; return this; },
        subscribe(fn) { channels.push(this); queueMicrotask(() => fn('SUBSCRIBED')); return this; },
        async track(state) {
          this.key = state.clientId; this.state = state;
          queueMicrotask(() => channels.filter(peer => peer.topic === topic).forEach(peer => peer.presence?.()));
          return 'ok';
        },
        async send(message) {
          queueMicrotask(() => channels.filter(peer => peer.topic === topic && peer !== this)
            .forEach(peer => peer.broadcast?.({ payload: message.payload })));
          return 'ok';
        }
      };
      return room;
    },
    async removeChannel(room) {
      const index = channels.indexOf(room);
      if (index >= 0) channels.splice(index, 1);
      queueMicrotask(() => channels.filter(peer => peer.topic === room.topic).forEach(peer => peer.presence?.()));
    }
  };
}

function createPlayer(id) {
  const elements = new Map();
  const makeElement = () => ({
    textContent: '', value: '', hidden: false, disabled: false, style: {},
    classList: { add() {}, remove() {} }, handlers: {},
    addEventListener(event, fn) { this.handlers[event] = fn; },
    replaceChildren() {}, append() {}, appendChild() {}
  });
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };
  const started = [];
  let busy = false;
  const game = {
    snapshot: () => [{ id: 1, name: '검계 이상', cell: 49, maxHp: 120, attack: 25, star: 1, lifesteal: 0 }],
    isBusy: () => busy, hasUnits: () => true,
    reset() { busy = false; }, setWaiting(value) { busy = value; },
    start(match, role) { started.push({ match, role }); busy = true; },
    abort() { busy = false; }
  };
  const window = { multiplayerClient: makeClient(id), pvpGame: game, multiplayerIdentity: () => ({ name: id }), PVP_ENGINE: { pairings } };
  vm.runInNewContext(source, {
    window, document: { querySelector: get, createElement: makeElement },
    crypto: webcrypto, navigator: { clipboard: { writeText: async () => {} } },
    location: { search: '' }, URLSearchParams, console, setTimeout, queueMicrotask
  });
  return { get, window, started };
}

(async () => {
  const wait = () => new Promise(resolve => setTimeout(resolve, 30));
  const alice = createPlayer('Alice'), bob = createPlayer('Bob');
  alice.get('#room-create').handlers.click();
  await wait();
  const code = alice.get('#room-code').value;
  assert.equal(code.length, 6);
  bob.get('#room-code').value = code;
  bob.get('#room-join').handlers.click();
  await wait();
  alice.window.multiplayerRoom.handleFightClick();
  bob.window.multiplayerRoom.handleFightClick();
  await wait();
  assert.equal(alice.started.length, 1);
  assert.equal(bob.started.length, 1);
  assert.equal(alice.started[0].role, 'host');
  assert.equal(bob.started[0].role, 'guest');
  assert.equal(alice.started[0].match.id, bob.started[0].match.id);
  await alice.window.multiplayerRoom.leave();
  await bob.window.multiplayerRoom.leave();

  const four = ids.map(createPlayer);
  four[0].get('#room-create-4').handlers.click();
  await wait();
  const fourCode = four[0].get('#room-code').value;
  for (const player of four.slice(1)) {
    player.get('#room-code').value = fourCode;
    player.get('#room-join').handlers.click();
    await wait();
  }
  for (let round = 0; round < 3; round++) {
    for (const player of four) player.window.multiplayerRoom.handleFightClick();
    await wait();
    for (const player of four) assert.equal(player.started.length, round + 1);
    const matchIds = four.map(player => player.started[round].match.id);
    assert.equal(new Set(matchIds).size, 2);
    for (const matchId of new Set(matchIds)) assert.equal(matchIds.filter(id => id === matchId).length, 2);
    for (const player of four) player.window.multiplayerRoom.onBattleFinished(player === four[0]);
    await wait();
  }
  const actualPairs = new Set();
  for (const player of four) for (const started of player.started) {
    const pair = four.filter(peer => peer.started.some(entry => entry.match.id === started.match.id));
    if (pair.length === 2) actualPairs.add(pair.map(peer => ids[four.indexOf(peer)]).sort().join(':'));
  }
  assert.equal(actualPairs.size, 6);
  console.log('Deterministic battles, 2-player room, and 4-player rotating opponents passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
