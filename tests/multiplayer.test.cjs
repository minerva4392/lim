const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const { simulate, flip } = require('../pvp-engine.js');

const team = [{ id: 1, cell: 49, maxHp: 120, attack: 25, lifesteal: 0 }];
const first = simulate(team, team, 'same-round');
assert.deepEqual(first, simulate(team, team, 'same-round'));
assert.equal(flip(flip(49)), 49);
for (const tick of first.ticks) {
  const living = tick.units.filter(unit => unit.hp > 0);
  assert.equal(new Set(living.map(unit => unit.cell)).size, living.length);
}

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
  const window = { multiplayerClient: makeClient(id), pvpGame: game, multiplayerIdentity: () => ({ name: id }) };
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
  console.log('Deterministic battle and two-player room flow passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
