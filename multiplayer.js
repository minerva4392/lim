(() => {
  const $ = selector => document.querySelector(selector);
  const client = window.multiplayerClient;
  const game = window.pvpGame;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let channel = null, roomCode = '', clientId = '', userId = '', playerName = '';
  let joinedAt = 0, players = [], ready = false, starting = false, battleActive = false;
  let roomSize = 2, round = 0, wins = 0, creator = false;
  let generation = 0;

  function setStatus(message, error = false) {
    const element = $('#room-status');
    element.textContent = message;
    element.style.color = error ? '#e18b7e' : '#d8cda9';
  }

  function randomCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
  }

  function localState() {
    return { clientId, userId, name: playerName, joinedAt, creator, size: roomSize, round, wins, ready, team: ready ? game.snapshot() : [] };
  }

  async function track() {
    if (channel) await channel.track(localState());
  }

  function refreshFightButton() {
    const button = $('#fight-btn');
    if (!roomCode) return;
    if (battleActive) { button.textContent = '대전 진행 중…'; button.disabled = true; }
    else { button.textContent = ready ? '준비 취소' : '대전 준비 ↗'; button.disabled = false; }
  }

  function renderPlayers() {
    const container = $('#room-players');
    container.replaceChildren();
    players.forEach((player, index) => {
      const row = document.createElement('div');
      row.className = `room-player${player.ready ? ' ready' : ''}`;
      const name = document.createElement('strong');
      name.textContent = `${index + 1}. ${player.name}${player.clientId === clientId ? ' (나)' : ''}`;
      const state = document.createElement('span');
      state.textContent = `${player.wins || 0}승 · ${player.ready ? '준비 완료' : '편성 중'}`;
      row.append(name, state);
      container.appendChild(row);
    });
    if (roomCode && players.length < roomSize) {
      const row = document.createElement('div');
      row.className = 'room-player';
      row.textContent = `${roomSize - players.length}명을 기다리는 중…`;
      container.appendChild(row);
    }
    renderPairings();
  }

  function renderPairings() {
    const container = $('#room-pairings');
    container.replaceChildren();
    container.hidden = !roomCode || players.length !== roomSize;
    if (container.hidden) return;
    const heading = document.createElement('strong');
    heading.textContent = `${round + 1}라운드 예정 대진`;
    container.appendChild(heading);
    const names = new Map(players.map(player => [player.clientId, player.name]));
    for (const [first, second] of window.PVP_ENGINE.pairings(players.map(player => player.clientId), round)) {
      const row = document.createElement('div');
      row.textContent = `${names.get(first)}  vs  ${names.get(second)}`;
      container.appendChild(row);
    }
  }

  function readPlayers() {
    if (!channel) return;
    const entries = Object.values(channel.presenceState()).flat().filter(person => person?.clientId && person?.userId);
    const unique = new Map();
    entries.sort((a, b) => Number(Boolean(b.creator)) - Number(Boolean(a.creator)) || a.joinedAt - b.joinedAt || a.clientId.localeCompare(b.clientId));
    entries.forEach(person => { if (!unique.has(person.userId)) unique.set(person.userId, person); });
    players = [...unique.values()];
    const nextSize = players[0]?.size === 4 ? 4 : 2;
    const nextRound = ready || battleActive ? round : Math.max(round, ...players.map(player => Number.isSafeInteger(player.round) ? player.round : 0));
    if (nextSize !== roomSize || nextRound !== round) {
      roomSize = nextSize;
      round = nextRound;
      void track();
    }
    $('#multiplayer-open').textContent = `${roomSize}인 ${roomCode}`;
    $('#multiplayer-title').textContent = `거울 대전 · ${roomSize}인 방`;
    renderPlayers();
    const mine = players.findIndex(person => person.clientId === clientId);
    if (mine < 0 && entries.some(person => person.clientId === clientId)) {
      void leave('같은 계정으로 다른 창에서 이미 대전 중입니다.');
      return;
    }
    if (mine >= roomSize) {
      void leave(`이 방에는 이미 ${roomSize}명이 참가했습니다.`);
      return;
    }
    if (roomCode && !battleActive) {
      if (players.length < roomSize && ready) {
        ready = false;
        game.setWaiting(false);
        $('#combat-status').textContent = '상대가 나갔습니다. 새 상대를 기다립니다.';
        void track();
        refreshFightButton();
      }
      setStatus(players.length === roomSize ? `${roomSize}명이 입장했습니다. 각자 편성한 뒤 대전 준비를 누르세요.` : `방 코드 ${roomCode} · ${players.length}/${roomSize}명 입장했습니다.`);
    }
    void maybeStart();
  }

  function beginMatch(event) {
    if (!roomCode || battleActive) return;
    const pairIndex = event.pairs.findIndex(pair => pair.hostId === clientId || pair.guestId === clientId);
    if (pairIndex < 0) return;
    const pair = event.pairs[pairIndex];
    const role = pair.hostId === clientId ? 'host' : 'guest';
    const match = { id: `${event.id}:${pairIndex}`, host: pair.host, guest: pair.guest };
    try {
      game.start(match, role);
      round = event.round + 1;
      battleActive = true;
      ready = false;
      starting = false;
      void track();
      refreshFightButton();
      const opponent = players.find(player => player.clientId === (role === 'host' ? pair.guestId : pair.hostId));
      setStatus(`${event.round + 1}라운드 · ${opponent?.name || '상대'}와 대전 중입니다.`);
      $('#multiplayer-modal').classList.remove('open');
    } catch (error) {
      ready = false;
      starting = false;
      game.setWaiting(false);
      refreshFightButton();
      setStatus(error.message || '대전을 시작하지 못했습니다.', true);
      void track();
    }
  }

  async function maybeStart() {
    if (!channel || players.length !== roomSize || players[0].clientId !== clientId || !players.every(player => player.ready && player.team?.length && player.round === round) || starting || battleActive) return;
    starting = true;
    const pairs = window.PVP_ENGINE.pairings(players.map(player => player.clientId), round).map(([hostId, guestId]) => ({
      hostId, guestId,
      host: players.find(player => player.clientId === hostId).team,
      guest: players.find(player => player.clientId === guestId).team
    }));
    const match = { id: crypto.randomUUID(), round, size: roomSize, senderId: clientId, pairs };
    try {
      const result = await channel.send({ type: 'broadcast', event: 'start', payload: match });
      if (result === 'error' || result === 'timed out') throw new Error('상대에게 대전 시작을 전달하지 못했습니다.');
      beginMatch(match);
    } catch (error) {
      starting = false;
      setStatus(error.message || '대전을 시작하지 못했습니다.', true);
    }
  }

  function receiveMatch({ payload }) {
    if (!payload || payload.senderId !== players[0]?.clientId || payload.round !== round || payload.size !== roomSize || !Array.isArray(payload.pairs) || payload.pairs.length !== roomSize / 2 || !ready || battleActive) return;
    if (!payload.pairs.some(pair => pair.hostId === clientId || pair.guestId === clientId)) return;
    beginMatch(payload);
  }

  async function enter(code, creating, size = 2) {
    if (!client) return setStatus('Supabase 연결 설정이 필요합니다.', true);
    if (game.isBusy()) return setStatus('진행 중인 전투가 끝나면 방에 참가할 수 있습니다.', true);
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return setStatus('방 코드는 영문·숫자 6자리입니다.', true);
    if (channel) await leave('다른 방으로 이동합니다.');
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) {
      setStatus('대전에 참가하려면 로그인하세요.', true);
      $('#auth-modal').classList.add('open');
      return;
    }
    userId = data.user.id;
    playerName = (window.multiplayerIdentity?.()?.name || data.user.user_metadata?.username || data.user.email?.split('@')[0] || '관리자').slice(0, 20);
    clientId = crypto.randomUUID();
    joinedAt = Date.now();
    roomCode = code;
    roomSize = creating && size === 4 ? 4 : 2;
    round = 0;wins = 0;creator = creating;
    ready = false;starting = false;battleActive = false;players = [];
    const current = ++generation;
    $('#room-code').value = code;
    $('#multiplayer-open').textContent = `${roomSize}인 ${code}`;
    $('#multiplayer-title').textContent = `거울 대전 · ${roomSize}인 방`;
    $('#room-create').hidden = true;$('#room-create-4').hidden = true;$('#room-join').hidden = true;$('#room-leave').hidden = false;$('#room-copy').hidden = false;
    setStatus(`방 ${code}에 연결하는 중…`);
    channel = client.channel(`mirror-duel:${code}`, { config: { private: false, broadcast: { ack: true }, presence: { key: clientId } } });
    channel.on('presence', { event: 'sync' }, readPlayers);
    channel.on('broadcast', { event: 'start' }, receiveMatch);
    let initialized = false;
    channel.subscribe(async status => {
      if (current !== generation || !channel) return;
      if (status === 'SUBSCRIBED') {
        if (!initialized) { game.reset(); initialized = true; }
        await track();
        refreshFightButton();
        setStatus(creating ? `방 ${code}을 만들었습니다. 코드를 상대에게 보내세요.` : `방 ${code}에 참가했습니다. 상대를 기다립니다.`);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        void leave('실시간 연결에 실패했습니다. 다시 시도하세요.');
      }
    });
  }

  async function leave(message = '방에서 나왔습니다.') {
    if (battleActive) game.abort();
    generation++;
    const old = channel;
    channel = null;roomCode = '';players = [];ready = false;starting = false;battleActive = false;roomSize = 2;round = 0;wins = 0;creator = false;
    if (old) await client.removeChannel(old);
    game.setWaiting(false);
    $('#combat-status').textContent = '인격을 배치하고 전투를 준비하십시오.';
    $('#room-create').hidden = false;$('#room-create-4').hidden = false;$('#room-join').hidden = false;$('#room-leave').hidden = true;$('#room-copy').hidden = true;
    $('#multiplayer-open').textContent = '온라인 대전';
    $('#multiplayer-title').textContent = '거울 대전 · 2인 / 4인 방';
    $('#fight-btn').textContent = '작전 개시 ↗';$('#fight-btn').disabled = false;
    renderPlayers();setStatus(message);
  }

  function handleFightClick() {
    if (!roomCode || battleActive || starting) return;
    if (ready) {
      ready = false;
      game.setWaiting(false);
      refreshFightButton();
      setStatus('대전 준비를 취소했습니다.');
      $('#combat-status').textContent = '인격을 배치하고 대전을 준비하십시오.';
      void track();
      return;
    }
    if (players.length !== roomSize) return setStatus(`${roomSize}명이 입장하면 대전을 준비할 수 있습니다.`, true);
    if (!game.hasUnits()) return setStatus('아군 진영에 인격을 한 명 이상 배치하세요.', true);
    ready = true;
    game.setWaiting(true);
    refreshFightButton();
    setStatus('준비 완료. 상대의 준비를 기다립니다.');
    $('#combat-status').textContent = '대전 준비 완료 — 상대를 기다리는 중…';
    void track();
  }

  $('#multiplayer-open').addEventListener('click', () => $('#multiplayer-modal').classList.add('open'));
  $('#room-create').addEventListener('click', () => void enter(randomCode(), true, 2));
  $('#room-create-4').addEventListener('click', () => void enter(randomCode(), true, 4));
  $('#room-join').addEventListener('click', () => void enter($('#room-code').value.trim().toUpperCase(), false));
  $('#room-leave').addEventListener('click', () => void leave());
  $('#room-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(roomCode);setStatus(`방 코드 ${roomCode}를 복사했습니다.`); }
    catch { setStatus(`방 코드: ${roomCode}`); }
  });
  $('#room-code').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6); });
  const sharedCode = new URLSearchParams(location.search).get('room');
  if (sharedCode && /^[A-HJ-NP-Z2-9]{6}$/.test(sharedCode.toUpperCase())) $('#room-code').value = sharedCode.toUpperCase();

  window.multiplayerRoom = {
    inRoom: () => Boolean(roomCode),
    handleFightClick,
    onBattleFinished(won) {
      battleActive = false;ready = false;starting = false;
      if (won) wins++;
      void track();refreshFightButton();
      renderPairings();
      setStatus(won ? `${round}라운드 승리! ${round + 1}라운드를 준비하세요.` : `${round}라운드 패배. ${round + 1}라운드를 준비하세요.`);
      $('#combat-status').textContent = won ? '거울 대전 승리 — 다음 전투를 준비하십시오.' : '거울 대전 패배 — 다시 편성하십시오.';
    },
    leave
  };
})();
