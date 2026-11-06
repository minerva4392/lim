/* Shared, deterministic duel rules. Both players calculate the same battle. */
(function (root) {
  const columns = 7;
  const cells = 56;
  const flip = cell => (7 - Math.floor(cell / columns)) * columns + cell % columns;
  const distance = (a, b) => Math.abs(Math.floor(a / columns) - Math.floor(b / columns)) + Math.abs(a % columns - b % columns);

  function randomFrom(seed) {
    let value = 2166136261;
    for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
    return () => {
      value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
      return (value >>> 0) / 4294967296;
    };
  }

  function neighbors(cell) {
    const row = Math.floor(cell / columns), col = cell % columns, result = [];
    if (row > 0) result.push(cell - columns);
    if (row < 7) result.push(cell + columns);
    if (col > 0) result.push(cell - 1);
    if (col < 6) result.push(cell + 1);
    return result;
  }

  function stepToward(start, targets, occupied) {
    const queue = [start], visited = new Set(queue), first = new Map();
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head];
      if (cell !== start && targets.some(target => distance(cell, target) === 1)) return first.get(cell);
      for (const next of neighbors(cell)) {
        if (visited.has(next) || occupied.has(next)) continue;
        visited.add(next);
        first.set(next, cell === start ? next : first.get(cell));
        queue.push(next);
      }
    }
    return null;
  }

  function normalize(team, owner) {
    if (!Array.isArray(team) || team.length < 1 || team.length > 7) throw new Error('편성 인원은 1~7명이어야 합니다.');
    const used = new Set();
    return team.map(unit => {
      const localCell = Number(unit.cell);
      if (!Number.isInteger(localCell) || localCell < 28 || localCell >= cells || used.has(localCell)) throw new Error('편성 위치가 올바르지 않습니다.');
      used.add(localCell);
      const id = Number(unit.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('인격 번호가 올바르지 않습니다.');
      const maxHp = Math.max(1, Math.min(2000, Math.round(Number(unit.maxHp) || 1)));
      const attack = Math.max(1, Math.min(300, Math.round(Number(unit.attack) || 1)));
      const lifesteal = Math.max(0, Math.min(1, Number(unit.lifesteal) || 0));
      return { owner, id, cell: owner === 'guest' ? flip(localCell) : localCell, hp: maxHp, maxHp, attack, lifesteal };
    });
  }

  function simulate(hostTeam, guestTeam, seed) {
    const units = [...normalize(hostTeam, 'host'), ...normalize(guestTeam, 'guest')];
    const random = randomFrom(seed);
    const initial = units.map(unit => ({ ...unit }));
    const ticks = [];
    for (let turn = 0; turn < 90; turn++) {
      const events = [];
      const order = turn % 2 ? [...units].reverse() : [...units];
      for (const unit of order) {
        if (unit.hp <= 0) continue;
        const opponents = units.filter(other => other.owner !== unit.owner && other.hp > 0);
        if (!opponents.length) break;
        const adjacent = opponents.filter(other => distance(unit.cell, other.cell) === 1);
        if (adjacent.length) {
          const target = adjacent[Math.floor(random() * adjacent.length)];
          const damage = Math.max(5, Math.round(unit.attack * (.86 + random() * .28)));
          const dealt = Math.min(target.hp, damage);
          target.hp = Math.max(0, target.hp - damage);
          unit.hp = Math.min(unit.maxHp, unit.hp + Math.round(dealt * unit.lifesteal));
          events.push({ type: 'attack', owner: unit.owner, id: unit.id, targetOwner: target.owner, targetId: target.id, from: unit.cell, to: target.cell });
        } else {
          const occupied = new Set(units.filter(other => other.hp > 0).map(other => other.cell));
          const next = stepToward(unit.cell, opponents.map(other => other.cell), occupied);
          if (next !== null) {
            events.push({ type: 'move', owner: unit.owner, id: unit.id, from: unit.cell, to: next });
            unit.cell = next;
          }
        }
      }
      ticks.push({ units: units.map(unit => ({ ...unit })), events });
      if (!units.some(unit => unit.owner === 'host' && unit.hp > 0) || !units.some(unit => unit.owner === 'guest' && unit.hp > 0)) break;
    }
    const health = owner => units.filter(unit => unit.owner === owner).reduce((sum, unit) => sum + unit.hp / unit.maxHp, 0);
    const hostHealth = health('host'), guestHealth = health('guest');
    const winner = hostHealth >= guestHealth ? 'host' : 'guest';
    return { initial, ticks, winner };
  }

  root.PVP_ENGINE = { simulate, flip };
  if (typeof module !== 'undefined') module.exports = root.PVP_ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
