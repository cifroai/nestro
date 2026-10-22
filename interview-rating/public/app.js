'use strict';

(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = (tg && tg.initData) || '';
  const params = new URLSearchParams(location.search);

  // id кандидата приходит из ссылки t.me/<бот>/<app>?startapp=<id>
  const candidateId =
    (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) ||
    params.get('tgWebAppStartParam') ||
    params.get('c');

  const $ = (id) => document.getElementById(id);
  const state = { data: null, score: null, editing: false, busy: false };

  if (tg) {
    tg.ready();
    tg.expand();
  }

  function haptic(type) {
    try {
      if (type === 'select') tg.HapticFeedback.selectionChanged();
      else tg.HapticFeedback.notificationOccurred(type);
    } catch (e) { /* вне Telegram */ }
  }

  function show(id, visible) {
    $(id).classList.toggle('hidden', !visible);
  }

  function fail(message) {
    show('loader', false);
    show('candidate', false);
    show('vote', false);
    show('results', false);
    $('error-text').textContent = message;
    show('error', true);
  }

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (initData) headers['X-Telegram-Init-Data'] = initData;
    else if (params.get('dev')) headers['X-Dev-User'] = encodeURIComponent(params.get('dev'));
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Ошибка сервера');
    return json;
  }

  function renderScores() {
    const { min, max } = state.data.scale;
    $('scale-hint').textContent = `Шкала от ${min} до ${max}, где ${max} — отлично.`;
    const box = $('scores');
    box.innerHTML = '';
    for (let i = min; i <= max; i++) {
      const b = document.createElement('button');
      b.className = 'score' + (state.score === i ? ' selected' : '');
      b.textContent = i;
      b.onclick = () => {
        state.score = i;
        haptic('select');
        renderScores();
        updateDecisionButtons();
      };
      box.appendChild(b);
    }
  }

  function updateDecisionButtons() {
    document.querySelectorAll('.decision').forEach((b) => {
      b.disabled = state.score == null || state.busy;
    });
    $('vote-hint').classList.toggle('hidden', state.score != null);
  }

  function renderResults() {
    const d = state.data;
    const r = d.results;
    const labels = d.decisionsLabels;

    $('r-average').textContent = r.average != null ? String(r.average).replace('.', ',') : '—';
    $('r-count').textContent = r.count;
    $('r-leader').textContent = r.leader
      ? `Большинство: «${labels[r.leader]}»`
      : r.count ? 'Единого мнения пока нет' : '';

    const bars = $('r-bars');
    bars.innerHTML = '';
    for (const key of Object.keys(labels)) {
      const n = r.decisions[key] || 0;
      const pct = r.count ? Math.round((n / r.count) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML =
        `<span></span><div class="bar-track"><div class="bar-fill ${key}" style="width:${pct}%"></div></div>` +
        `<span class="bar-count">${n}</span>`;
      row.firstChild.textContent = labels[key];
      bars.appendChild(row);
    }

    const list = $('r-votes');
    list.innerHTML = '';
    for (const v of r.votes) {
      const li = document.createElement('li');
      li.innerHTML =
        '<div class="vote-head"><span class="vote-name"></span><span class="tag"></span></div>' +
        '<div class="vote-comment"></div>';
      li.querySelector('.vote-name').textContent = v.name;
      const tag = li.querySelector('.tag');
      tag.className = 'tag ' + v.decision;
      tag.textContent = `${v.score} · ${labels[v.decision]}`;
      const c = li.querySelector('.vote-comment');
      if (v.comment) c.textContent = v.comment;
      else c.remove();
      list.appendChild(li);
    }

    const mv = d.myVote;
    $('my-vote').textContent = `Ваша оценка: ${mv.score} · ${labels[mv.decision]}`;
  }

  function render() {
    const d = state.data;
    show('loader', false);
    show('error', false);
    $('c-name').textContent = d.name;
    $('c-position').textContent = d.position || '';
    show('candidate', true);

    const voting = !d.myVote || state.editing;
    show('vote', voting);
    show('results', !voting);

    if (voting) {
      if (state.score == null && d.myVote) state.score = d.myVote.score;
      if (d.myVote && !$('comment').value) $('comment').value = d.myVote.comment || '';
      renderScores();
      updateDecisionButtons();
    } else {
      renderResults();
    }
  }

  async function submit(decision) {
    if (state.score == null || state.busy) return;
    state.busy = true;
    updateDecisionButtons();
    try {
      state.data = await api('POST', `/api/candidates/${encodeURIComponent(candidateId)}/vote`, {
        score: state.score,
        decision,
        comment: $('comment').value,
      });
      state.editing = false;
      haptic('success');
      render();
      window.scrollTo(0, 0);
    } catch (e) {
      haptic('error');
      if (tg && tg.showAlert) tg.showAlert(e.message);
      else alert(e.message);
    } finally {
      state.busy = false;
      updateDecisionButtons();
    }
  }

  async function load() {
    try {
      state.data = await api('GET', `/api/candidates/${encodeURIComponent(candidateId)}`);
      render();
    } catch (e) {
      fail(e.message);
    }
  }

  document.querySelectorAll('.decision').forEach((b) => {
    b.addEventListener('click', () => submit(b.dataset.decision));
  });
  $('change-vote').onclick = () => {
    state.editing = true;
    render();
  };
  $('refresh').onclick = load;

  if (!initData && !params.get('dev')) {
    fail('Это приложение работает внутри Telegram. Откройте ссылку на устройстве, где установлен Telegram.');
  } else if (!candidateId) {
    fail('В ссылке не указан кандидат. Попросите отправить корректную ссылку.');
  } else {
    load();
  }
})();
