(() => {
  const $ = selector => document.querySelector(selector);
  const config = window.SUPABASE_CONFIG || {};
  const configured = typeof window.supabase?.createClient === 'function'
    && typeof config.url === 'string'
    && config.url.startsWith('https://')
    && !config.url.includes('YOUR_')
    && typeof config.publishableKey === 'string'
    && config.publishableKey.length > 10
    && !config.publishableKey.includes('YOUR_');
  const client = configured ? window.supabase.createClient(config.url, config.publishableKey) : null;
  let user = null;
  let profile = null;
  let pendingRecord = null;
  let generatingAvatar = false;
  let avatarSchemaReady = true;

  async function readProfile(id) {
    let result = await client.from('profiles')
      .select('id, username, avatar_path, avatar_generated_at').eq('id', id).maybeSingle();
    if (result.error?.code === '42703') {
      avatarSchemaReady = false;
      result = await client.from('profiles').select('id, username').eq('id', id).maybeSingle();
    }
    return result;
  }

  function avatarUrl(path, version) {
    if (!client || typeof path !== 'string' || !/^[0-9a-f-]{36}\/avatar\.webp$/i.test(path)) return '';
    const publicUrl = client.storage.from('profile-avatars').getPublicUrl(path).data.publicUrl;
    return `${publicUrl}?v=${encodeURIComponent(version || '1')}`;
  }

  function setProfileStatus(message, isError = false) {
    const status = $('#profile-status');
    status.textContent = message;
    status.style.color = isError ? '#e18b7e' : '#d1b96f';
  }

  function setAuthStatus(message, isError = false) {
    const status = $('#auth-status');
    status.textContent = message;
    status.style.color = isError ? '#e18b7e' : '#d1b96f';
  }

  function openModal(id) { document.getElementById(id)?.classList.add('open'); }
  function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

  function updateAuthUI() {
    const name = profile?.username || user?.email?.split('@')[0] || '';
    $('#auth-open').textContent = user ? name : '로그인';
    $('#auth-account').textContent = user
      ? `${name} 계정으로 로그인되어 있습니다.`
      : '이메일과 비밀번호로 계정을 만들거나 로그인하세요.';
    document.querySelectorAll('.auth-field, #auth-username, #auth-email, #auth-password')
      .forEach(element => { element.hidden = Boolean(user); });
    $('#login-btn').hidden = Boolean(user);
    $('#signup-btn').hidden = Boolean(user);
    $('#logout-btn').hidden = !user;
    $('#profile-account-name').textContent = name || '로그인이 필요합니다';
    $('#profile-generate').disabled = !user || generatingAvatar || !avatarSchemaReady;
    const imageUrl = avatarUrl(profile?.avatar_path, profile?.avatar_generated_at);
    $('#profile-avatar-image').hidden = !imageUrl;
    $('#profile-avatar-fallback').hidden = Boolean(imageUrl);
    if (imageUrl) $('#profile-avatar-image').src = imageUrl;
  }

  async function ensureProfile(authUser, requestedName = '') {
    const { data: existing, error: readError } = await readProfile(authUser.id);
    if (readError) throw new Error('프로필 테이블을 읽을 수 없습니다. supabase/schema.sql을 실행했는지 확인하세요.');
    if (existing) return existing;

    const baseName = requestedName || authUser.user_metadata?.username || authUser.email?.split('@')[0] || '';
    let username = Array.from(baseName.trim()).slice(0, 20).join('');
    if (Array.from(username).length < 2) username = `단테${authUser.id.slice(0, 5)}`;
    const columns = avatarSchemaReady ? 'id, username, avatar_path, avatar_generated_at' : 'id, username';
    let result = await client.from('profiles').insert({ id: authUser.id, username }).select(columns).single();
    if (result.error?.code === '23505') {
      const { data: racedProfile } = await readProfile(authUser.id);
      if (racedProfile) return racedProfile;
      username = `${Array.from(username).slice(0, 15).join('')}_${authUser.id.slice(0, 4)}`;
      result = await client.from('profiles').insert({ id: authUser.id, username }).select(columns).single();
    }
    if (result.error) throw new Error(`관리자 이름을 저장하지 못했습니다: ${result.error.message}`);
    return result.data;
  }

  async function flushPendingRecord() {
    if (!pendingRecord || !user || !client) return;
    const record = pendingRecord;
    pendingRecord = null;
    const { error } = await client.from('game_records').insert({
      user_id: user.id,
      score: record.score,
      reached_stage: record.reachedStage
    });
    if (error) {
      pendingRecord = record;
      setAuthStatus(`기록 저장 실패: ${error.message}`, true);
      openModal('auth-modal');
      return;
    }
    setAuthStatus('이번 작전 기록을 저장했습니다.');
    void loadLeaderboard();
  }

  async function syncSession(session) {
    user = session?.user || null;
    profile = null;
    updateAuthUI();
    if (!user) return;
    try {
      profile = await ensureProfile(user);
      updateAuthUI();
      await flushPendingRecord();
    } catch (error) {
      setAuthStatus(error.message || '계정 정보를 불러오지 못했습니다.', true);
    }
  }

  async function signUp() {
    if (!client) return setAuthStatus('supabase-config.js에 Supabase URL과 publishable key를 먼저 입력하세요.', true);
    const username = $('#auth-username').value.trim();
    const email = $('#auth-email').value.trim().toLowerCase();
    const password = $('#auth-password').value;
    if (Array.from(username).length < 2 || Array.from(username).length > 20) {
      return setAuthStatus('관리자 이름은 2~20자로 입력하세요.', true);
    }
    if (!$('#auth-email').checkValidity()) return setAuthStatus('이메일 주소를 확인하세요.', true);
    if (password.length < 8) return setAuthStatus('비밀번호는 8자 이상이어야 합니다.', true);
    $('#signup-btn').disabled = true;
    setAuthStatus('계정을 만들고 있습니다…');
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });
    $('#signup-btn').disabled = false;
    if (error) return setAuthStatus(error.message, true);
    if (!data.session) {
      setAuthStatus('가입은 됐지만 이메일 확인이 필요하다고 응답했습니다. Supabase에서 Confirm email을 꺼주세요.', true);
      return;
    }
    await syncSession(data.session);
    setAuthStatus('가입과 로그인이 완료됐습니다.');
  }

  async function signIn() {
    if (!client) return setAuthStatus('supabase-config.js에 Supabase URL과 publishable key를 먼저 입력하세요.', true);
    const email = $('#auth-email').value.trim().toLowerCase();
    const password = $('#auth-password').value;
    if (!$('#auth-email').checkValidity()) return setAuthStatus('이메일 주소를 확인하세요.', true);
    if (!password) return setAuthStatus('비밀번호를 입력하세요.', true);
    $('#login-btn').disabled = true;
    setAuthStatus('로그인 중입니다…');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    $('#login-btn').disabled = false;
    if (error) return setAuthStatus(error.message, true);
    await syncSession(data.session);
    setAuthStatus('로그인했습니다.');
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) return setAuthStatus(error.message, true);
    user = null;
    profile = null;
    updateAuthUI();
    setAuthStatus('로그아웃했습니다.');
  }

  async function generateAvatar() {
    if (!client || !user || generatingAvatar) return setProfileStatus('먼저 로그인하세요.', true);
    if (!avatarSchemaReady) return setProfileStatus('Supabase SQL 설정 후 이용할 수 있습니다.', true);
    const prompt = $('#profile-prompt').value.trim();
    if (prompt.length < 10 || prompt.length > 500) return setProfileStatus('이미지 설명을 10~500자로 입력하세요.', true);
    generatingAvatar = true;
    updateAuthUI();
    setProfileStatus('이미지를 생성하고 저장하는 중입니다. 잠시 기다려 주세요…');
    const accountId = user.id;
    try {
      const { data, error } = await client.auth.getSession();
      if (error || !data.session?.access_token) throw new Error('로그인이 만료됐습니다. 다시 로그인하세요.');
      const response = await fetch('/api/generate-profile-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ prompt })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '이미지를 생성하지 못했습니다.');
      if (user?.id !== accountId) return;
      profile = { ...profile, avatar_path: result.path, avatar_generated_at: new Date(result.version).toISOString() };
      updateAuthUI();
      setProfileStatus('프로필 이미지가 저장됐습니다.');
    } catch (error) {
      setProfileStatus(error.message || '이미지를 생성하지 못했습니다.', true);
    } finally {
      generatingAvatar = false;
      updateAuthUI();
    }
  }

  function setLeaderboardMessage(message, isError = false) {
    const state = $('#leaderboard-state');
    state.textContent = message;
    state.style.color = isError ? '#e18b7e' : '#8b8d86';
  }

  async function loadLeaderboard() {
    const body = $('#leaderboard-body');
    if (!client) {
      setLeaderboardMessage('순위표를 연결하려면 supabase-config.js를 설정하세요.', true);
      body.innerHTML = '<tr><td class="rank-empty" colspan="5">Supabase 연결 설정이 필요합니다.</td></tr>';
      return;
    }
    setLeaderboardMessage('최고 기록을 불러오는 중…');
    let { data, error } = await client.from('leaderboard')
      .select('user_id, username, best_score, reached_stage, achieved_at, avatar_path, avatar_generated_at')
      .order('best_score', { ascending: false })
      .order('achieved_at', { ascending: true })
      .limit(50);
    if (error?.code === '42703') {
      ({ data, error } = await client.from('leaderboard')
        .select('user_id, username, best_score, reached_stage, achieved_at')
        .order('best_score', { ascending: false })
        .order('achieved_at', { ascending: true })
        .limit(50));
    }
    if (error) {
      setLeaderboardMessage(`순위표를 불러오지 못했습니다: ${error.message}`, true);
      body.innerHTML = '<tr><td class="rank-empty" colspan="5">SQL 설정과 Supabase 연결을 확인하세요.</td></tr>';
      return;
    }
    body.replaceChildren();
    if (!data?.length) {
      body.innerHTML = '<tr><td class="rank-empty" colspan="5">저장된 기록이 없습니다. 한 판을 마치면 기록이 등록됩니다.</td></tr>';
      setLeaderboardMessage('최고 기록 상위 50명을 표시합니다.');
      return;
    }
    data.forEach((record, index) => {
      const row = document.createElement('tr');
      const values = [
        String(index + 1),
        record.username,
        record.reached_stage,
        Number(record.best_score).toLocaleString('ko-KR'),
        record.achieved_at ? new Date(record.achieved_at).toLocaleDateString('ko-KR') : '—'
      ];
      values.forEach((value, columnIndex) => {
        const cell = document.createElement('td');
        cell.textContent = value ?? '';
        if (columnIndex === 1) {
          cell.className = 'rank-name';
          const imageUrl = avatarUrl(record.avatar_path, record.avatar_generated_at);
          if (imageUrl) {
            const image = document.createElement('img');
            image.className = 'rank-avatar';
            image.alt = '';
            image.src = imageUrl;
            cell.prepend(image);
          }
        }
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    setLeaderboardMessage(`최고 기록 상위 ${data.length}명을 표시합니다.`);
  }

  window.submitGameRecord = async record => {
    if (!record || !Number.isInteger(record.score) || record.score < 1) return;
    pendingRecord = record;
    openModal('auth-modal');
    if (!client) {
      setAuthStatus('기록을 저장하려면 supabase-config.js에 프로젝트 URL과 publishable key를 입력해야 합니다.', true);
      return;
    }
    if (!user) {
      setAuthStatus('기록을 순위표에 올리려면 로그인하세요. 로그인 후 이번 기록이 저장됩니다.');
      return;
    }
    await flushPendingRecord();
  };

  $('#auth-open').addEventListener('click', () => {
    openModal('auth-modal');
    if (!client) setAuthStatus('supabase-config.js에 Supabase URL과 publishable key를 입력하세요.', true);
  });
  $('#profile-open').addEventListener('click', () => {
    if (!user) {
      openModal('auth-modal');
      setAuthStatus('프로필 이미지를 만들려면 로그인하세요.');
      return;
    }
    openModal('profile-modal');
    if (!avatarSchemaReady) setProfileStatus('이미지 기능은 Supabase SQL 설정 후 사용할 수 있습니다.', true);
  });
  $('#profile-generate').addEventListener('click', () => void generateAvatar());
  $('#leaderboard-open').addEventListener('click', () => {
    openModal('leaderboard-modal');
    void loadLeaderboard();
  });
  $('#leaderboard-refresh').addEventListener('click', () => void loadLeaderboard());
  $('#login-btn').addEventListener('click', () => void signIn());
  $('#signup-btn').addEventListener('click', () => void signUp());
  $('#logout-btn').addEventListener('click', () => void signOut());
  document.querySelectorAll('[data-close]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.close));
  });
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach(modal => closeModal(modal.id));
  });

  updateAuthUI();
  if (!client) {
    setAuthStatus('Supabase URL과 publishable key를 설정하면 계정을 사용할 수 있습니다.');
    setLeaderboardMessage('Supabase 연결 설정을 기다리고 있습니다.');
  } else {
    client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => { void syncSession(session); }, 0);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (error) setAuthStatus(error.message, true);
      else void syncSession(data.session);
    });
  }
})();
