// people.js — участники (команда) и «действующее лицо» для тестирования ролей.
//
// В прототипе нет сервера, поэтому многопользовательские сценарии
// (исполнитель ↔ контролёр) проверяются на одном устройстве через
// переключатель «действую как…». На VPS роль будет определяться реальным
// пользователем Telegram, а этот переключатель уберётся.

import { store } from './store.js';

export function uid() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Команда по умолчанию: двое исполнителей (для сценария «поровну») + контролёр.
export function defaultTeam(tgUser) {
  const me = tgUser
    ? { id: 'tg' + tgUser.id, name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Я' }
    : { id: uid(), name: 'Исполнитель 1' };
  return [
    me,
    { id: uid(), name: 'Исполнитель 2' },
    { id: uid(), name: 'Контролёр' },
  ];
}

export const people = {
  team: [],
  currentId: null, // кем сейчас «действуем»

  async load(tgUser) {
    this.team = await store.loadTeam();
    if (!this.team.length) {
      this.team = defaultTeam(tgUser);
      await store.saveTeam(this.team);
    }
    this.currentId = await store.loadCurrentUser();
    if (!this.currentId || !this.team.some((m) => m.id === this.currentId)) {
      this.currentId = this.team[0].id;
      await store.saveCurrentUser(this.currentId);
    }
  },

  current() {
    return this.team.find((m) => m.id === this.currentId) || this.team[0];
  },

  name(id) {
    return this.team.find((m) => m.id === id)?.name || null;
  },

  async setCurrent(id) {
    this.currentId = id;
    await store.saveCurrentUser(id);
  },

  async add(name) {
    const m = { id: uid(), name: name.trim() };
    this.team.push(m);
    await store.saveTeam(this.team);
    return m;
  },

  async rename(id, name) {
    const m = this.team.find((x) => x.id === id);
    if (m) { m.name = name.trim(); await store.saveTeam(this.team); }
  },

  async remove(id) {
    this.team = this.team.filter((m) => m.id !== id);
    if (this.currentId === id && this.team.length) {
      await this.setCurrent(this.team[0].id);
    }
    await store.saveTeam(this.team);
  },
};
