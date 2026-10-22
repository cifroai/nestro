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

  // Вызов функции на Telegram Serverless (папка tgcloud/endpoints). initData передаётся автоматически.
  function api(name, input) {
    return new Promise((resolve, reject) => {
      if (!tg || !tg.Serverless) {
        reject(new Error('Обновите Telegram до последней версии, чтобы открыть приложение.'));
        return;
      }
      tg.Serverless.call(name, input || {}, (err, result) => {
        if (err) {
          const e = new Error(err.type === 'ENDPOINT_ERROR' ? err.message : 'Ошибка сервера, попробуйте ещё раз');
          e.code = err.parameters && err.parameters.code;
          reject(e);
        } else resolve(result);
      });
    });
  }

  // Резюме передаётся через личный чат с ботом — спрашиваем разрешение, если его ещё нет.
  function ensureWriteAccess() {
    return new Promise((resolve) => {
      if (!tg.requestWriteAccess || !tg.isVersionAtLeast('6.9')) return resolve(true);
      tg.requestWriteAccess((granted) => resolve(granted));
    });
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

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' КБ';
    return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
  }

  function renderResume() {
    const d = state.data;
    const info = $('resume-info');
    info.innerHTML = '';
    if (d.resume) {
      const name = document.createElement('div');
      name.className = 'resume-name';
      name.textContent = '📄 ' + d.resume.fileName;
      const meta = document.createElement('div');
      meta.className = 'muted small';
      const date = new Date(d.resume.uploadedAt).toLocaleDateString('ru-RU');
      meta.textContent = `${formatSize(d.resume.size)} · загрузил(а) ${d.resume.uploadedBy}, ${date}`;
      info.append(name, meta);
    } else {
      info.innerHTML = '<span class="muted">Резюме пока не загружено</span>';
    }
    show('resume-open', !!d.resume);
    show('resume-upload', d.canUploadResume);
    $('resume-upload').textContent = state.uploading
      ? 'Загрузка…'
      : d.resume ? 'Заменить резюме' : 'Загрузить резюме';
    $('resume-upload').disabled = !!state.uploading;
    $('resume-file').accept = d.resumeTypes.join(',');
  }

  async function openResume() {
    if (!(await ensureWriteAccess())) {
      notify('Чтобы получить резюме, разрешите боту писать вам.');
      return;
    }
    $('resume-open').disabled = true;
    try {
      await api('sendResume', { id: candidateId });
      haptic('success');
      const chatUrl = 'https://t.me/' + state.data.bot;
      tg.showPopup(
        {
          title: 'Резюме отправлено',
          message: 'Файл в вашем чате с ботом — откройте его там.',
          buttons: [{ id: 'chat', type: 'default', text: 'Перейти в чат' }, { type: 'close' }],
        },
        (id) => { if (id === 'chat') tg.openTelegramLink(chatUrl); },
      );
    } catch (e) {
      haptic('error');
      notify(e.message);
    } finally {
      $('resume-open').disabled = false;
    }
  }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadResume(file) {
    const d = state.data;
    if (file.size > d.resumeMaxMb * 1024 * 1024) {
      notify(`Файл больше ${d.resumeMaxMb} МБ. Отправьте его боту документом с подписью /resume ${candidateId}`);
      return;
    }
    if (!(await ensureWriteAccess())) {
      notify('Чтобы загрузить резюме, разрешите боту писать вам: файл сохраняется в вашем чате с ботом.');
      return;
    }
    state.uploading = true;
    renderResume();
    try {
      state.data = await api('uploadResume', {
        id: candidateId,
        fileName: file.name,
        data: await readAsBase64(file),
      });
      haptic('success');
    } catch (e) {
      haptic('error');
      notify(e.message);
    } finally {
      state.uploading = false;
      render();
    }
  }

  function notify(message) {
    if (tg && tg.showAlert && initData) tg.showAlert(message);
    else alert(message);
  }

  function render() {
    const d = state.data;
    show('loader', false);
    show('error', false);
    $('c-name').textContent = d.name;
    $('c-position').textContent = d.position || '';
    show('candidate', true);
    renderResume();

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
      state.data = await api('vote', {
        id: candidateId,
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
      notify(e.message);
    } finally {
      state.busy = false;
      updateDecisionButtons();
    }
  }

  async function load() {
    try {
      state.data = await api('getCandidate', { id: candidateId });
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
  $('resume-open').onclick = openResume;
  $('resume-upload').onclick = () => $('resume-file').click();
  $('resume-file').onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) uploadResume(file);
  };

  if (!initData) {
    fail('Это приложение работает внутри Telegram. Откройте ссылку на устройстве, где установлен Telegram.');
  } else if (!candidateId) {
    fail('В ссылке не указан кандидат. Попросите отправить корректную ссылку.');
  } else {
    load();
  }
})();
