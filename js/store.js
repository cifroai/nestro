// store.js — слой хранения данных.
// Приоритет: Telegram CloudStorage (синхронизация между устройствами пользователя),
// откат на localStorage для запуска вне Telegram (в браузере при разработке).

const KEY = 'porucheniya_v1';
const CUSTOM_OBJECTS_KEY = 'poruch_custom_objects_v1';

function tgCloud() {
  const tg = window.Telegram?.WebApp;
  // CloudStorage появился в Bot API 6.9.
  if (tg?.CloudStorage && typeof tg.CloudStorage.getItem === 'function') {
    return tg.CloudStorage;
  }
  return null;
}

function localGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function localSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим / переполнение — молча игнорируем */
  }
}

function cloudGet(cloud, key) {
  return new Promise((resolve) => {
    cloud.getItem(key, (err, value) => {
      if (err || !value) return resolve(null);
      try {
        resolve(JSON.parse(value));
      } catch {
        resolve(null);
      }
    });
  });
}

function cloudSet(cloud, key, value) {
  return new Promise((resolve) => {
    cloud.setItem(key, JSON.stringify(value), () => resolve());
  });
}

// Публичный API хранилища.
export const store = {
  async loadTasks() {
    const cloud = tgCloud();
    if (cloud) {
      const data = await cloudGet(cloud, KEY);
      if (data) return data;
    }
    return localGet(KEY) || [];
  },

  async saveTasks(tasks) {
    localSet(KEY, tasks); // всегда дублируем локально
    const cloud = tgCloud();
    if (cloud) await cloudSet(cloud, KEY, tasks);
  },

  async loadCustomObjects() {
    const cloud = tgCloud();
    if (cloud) {
      const data = await cloudGet(cloud, CUSTOM_OBJECTS_KEY);
      if (data) return data;
    }
    return localGet(CUSTOM_OBJECTS_KEY) || [];
  },

  async saveCustomObjects(objects) {
    localSet(CUSTOM_OBJECTS_KEY, objects);
    const cloud = tgCloud();
    if (cloud) await cloudSet(cloud, CUSTOM_OBJECTS_KEY, objects);
  },
};
