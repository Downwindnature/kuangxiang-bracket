// store.js — 資料層：有設定 Firebase 就用 Realtime Database，沒有就用單機測試模式（localStorage）
import { FIREBASE_CONFIG, ACCOUNT_DOMAIN, DB_ROOT } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/13.4.0/';

export const PATHS = {
  regs: 'private/regs',
  teams: 'private/teams',
  bracket: 'private/bracket',
  sync: 'private/sync',
  roster: 'private/roster',
  pub: 'public',
  pubSettings: 'public/settings',
  pubBanner: 'public/banner',
  pubBracket: 'public/bracket',
  pubTeams: 'public/teams',
  history: 'history',
  historyData: 'historyData',
};

export function firebaseReady() {
  const c = FIREBASE_CONFIG || {};
  return !!(c.apiKey && c.databaseURL && c.projectId);
}

export function wantLocal() {
  const q = new URLSearchParams(location.search);
  return q.has('local') || !firebaseReady();
}

export async function openStore({ withAuth = false } = {}) {
  return wantLocal() ? openLocal() : openFirebase(withAuth);
}

export function toEmail(account) {
  const a = String(account || '').trim();
  return a.includes('@') ? a : `${a}@${ACCOUNT_DOMAIN}`;
}

async function openFirebase(withAuth) {
  const [appMod, db] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-database.js')]);
  const app = appMod.initializeApp(FIREBASE_CONFIG);
  const database = db.getDatabase(app);
  const R = (path) => db.ref(database, path ? `${DB_ROOT}/${path}` : DB_ROOT);
  let offset = 0;
  db.onValue(db.ref(database, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
  let connected = true;
  const connCbs = [];
  db.onValue(db.ref(database, '.info/connected'), (s) => {
    connected = !!s.val();
    connCbs.forEach((f) => f(connected));
  });

  const store = {
    mode: 'firebase',
    now: () => Date.now() + offset,
    watch(path, cb, onErr) {
      return db.onValue(R(path), (s) => cb(s.val()), (e) => { console.error(e); onErr && onErr(e); });
    },
    async get(path) { return (await db.get(R(path))).val(); },
    set: (path, v) => db.set(R(path), v === undefined ? null : v),
    update: (path, obj) => db.update(R(path), obj),
    remove: (path) => db.remove(R(path)),
    async push(path, v) {
      const r = db.push(R(path));
      await db.set(r, v);
      return r.key;
    },
    async lastN(path, n) {
      const snap = await db.get(db.query(R(path), db.orderByKey(), db.limitToLast(n)));
      const out = [];
      snap.forEach((c) => { out.push(Object.assign({ key: c.key }, c.val())); });
      return out;
    },
    async keys(path) {
      const v = (await db.get(R(path))).val();
      return v ? Object.keys(v).sort() : [];
    },
    onConnection(cb) { connCbs.push(cb); cb(connected); },
    auth: null,
  };

  if (withAuth) {
    const au = await import(FB + 'firebase-auth.js');
    const auth = au.getAuth(app);
    store.auth = {
      onChange: (cb) => au.onAuthStateChanged(auth, cb),
      async signIn(account, password, remember = true) {
        await au.setPersistence(auth, remember ? au.browserLocalPersistence : au.browserSessionPersistence);
        return au.signInWithEmailAndPassword(auth, toEmail(account), password);
      },
      signOut: () => au.signOut(auth),
      resetPassword: (account) => au.sendPasswordResetEmail(auth, toEmail(account)),
      async isAdmin(user) {
        if (!user) return false;
        try {
          const s = await db.get(db.ref(database, `${DB_ROOT}/admins/${user.uid}`));
          return s.val() === true;
        } catch (e) {
          return false;
        }
      },
    };
  }
  return store;
}

// ── 單機測試模式：同一台電腦、同一個瀏覽器的分頁會互相同步 ──
function openLocal() {
  const KEY = `kxb-local:${DB_ROOT}`;
  const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(KEY) : null;
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  };
  let tree = load();
  const watchers = [];
  const parts = (path) => String(path || '').split('/').filter(Boolean);
  const getAt = (path) => {
    let cur = tree;
    for (const p of parts(path)) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[p];
    }
    return cur === undefined ? null : cur;
  };
  const setAt = (path, v) => {
    const ps = parts(path);
    if (!ps.length) { tree = v && typeof v === 'object' ? v : {}; return; }
    let cur = tree;
    const stack = [];
    for (let i = 0; i < ps.length - 1; i++) {
      if (cur[ps[i]] == null || typeof cur[ps[i]] !== 'object') cur[ps[i]] = {};
      stack.push([cur, ps[i]]);
      cur = cur[ps[i]];
    }
    const last = ps[ps.length - 1];
    if (v === null || v === undefined) delete cur[last];
    else cur[last] = v;
    for (let i = stack.length - 1; i >= 0; i--) { // 清掉空物件（跟 Realtime Database 一樣）
      const [o, k] = stack[i];
      if (o[k] && typeof o[k] === 'object' && !Object.keys(o[k]).length) delete o[k];
    }
  };
  const cp = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  const notify = () => {
    for (const w of watchers) {
      const v = getAt(w.path);
      const s = JSON.stringify(v);
      if (s !== w.last) { w.last = s; try { w.cb(cp(v)); } catch (e) { console.error(e); } }
    }
  };
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(tree)); } catch (e) {
      console.error(e);
      alert('瀏覽器儲存空間不足，資料可能沒有存起來。可以到「重置」頁刪除舊的還原紀錄。');
    }
    if (ch) ch.postMessage(1);
    notify();
  };
  if (ch) ch.onmessage = () => { tree = load(); notify(); };
  window.addEventListener('storage', (e) => { if (e.key === KEY) { tree = load(); notify(); } });
  let lastPush = 0;
  const pushKey = () => {
    let t = Date.now();
    if (t <= lastPush) t = lastPush + 1;
    lastPush = t;
    return 'L' + t.toString(36).padStart(10, '0') + Math.random().toString(36).slice(2, 6);
  };
  return {
    mode: 'local',
    now: () => Date.now(),
    watch(path, cb) {
      const w = { path, cb, last: undefined };
      watchers.push(w);
      setTimeout(() => { const v = getAt(path); w.last = JSON.stringify(v); cb(cp(v)); }, 0);
      return () => { const i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); };
    },
    async get(path) { return cp(getAt(path)); },
    async set(path, v) { setAt(path, cp(v)); save(); },
    async update(path, obj) {
      for (const [k, v] of Object.entries(obj)) setAt(path ? `${path}/${k}` : k, cp(v));
      save();
    },
    async remove(path) { setAt(path, null); save(); },
    async push(path, v) { const key = pushKey(); setAt(`${path}/${key}`, cp(v)); save(); return key; },
    async lastN(path, n) {
      const o = getAt(path) || {};
      return Object.keys(o).sort().slice(-n).map((k) => Object.assign({ key: k }, o[k]));
    },
    async keys(path) { const o = getAt(path) || {}; return Object.keys(o).sort(); },
    onConnection(cb) { cb(true); },
    auth: null,
  };
}
