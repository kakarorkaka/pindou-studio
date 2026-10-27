/* ==========================================================================
   本地作品库：IndexedDB 存储，支持保存 / 列表 / 读取 / 删除 / 容量裁剪
   ========================================================================== */
(function () {
  'use strict';

  const DB_NAME = 'pindou-studio';
  const STORE = 'projects';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      try { result = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function put(project) {
    return tx('readwrite', store => store.put(project));
  }

  function all() {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const store = t.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    }));
  }

  function get(id) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  }

  function del(id) {
    return tx('readwrite', store => store.delete(id));
  }

  async function trim(max) {
    const keep = max || 24;
    const list = await all();
    for (const item of list.slice(keep)) {
      await del(item.id);
    }
  }

  function clear() {
    return tx('readwrite', store => store.clear());
  }

  window.PindouProjects = {
    put, all, get, del, trim, clear,
  };
})();
