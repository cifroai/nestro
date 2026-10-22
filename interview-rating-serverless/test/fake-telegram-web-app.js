// Имитация telegram-web-app.js для локального стенда.
(function () {
  const p = new URLSearchParams(location.search);
  const user = { id: Number(p.get('uid') || 1), first_name: p.get('name') || 'Тест' };
  window.__popups = [];
  window.Telegram = { WebApp: {
    initData: 'test', initDataUnsafe: { user, start_param: p.get('c') },
    ready() {}, expand() {}, isVersionAtLeast: () => true,
    HapticFeedback: { selectionChanged() {}, notificationOccurred() {} },
    showAlert(m) { window.__popups.push(m); },
    showPopup(o, cb) { window.__popups.push(o.title + ': ' + o.message); },
    openTelegramLink(u) { window.__opened = u; },
    requestWriteAccess(cb) { cb(true); },
    Serverless: { call(name, input, cb) {
      fetch('/api/' + name, { method: 'POST', headers: { 'X-Test-User': encodeURIComponent(JSON.stringify(user)) }, body: JSON.stringify(input) })
        .then((r) => r.json()).then((j) => j.ok ? cb(null, j.result) : cb({ type: j.error_type, message: j.description, parameters: j.parameters }));
    } },
  } };
})();
