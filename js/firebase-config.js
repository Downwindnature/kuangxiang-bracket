// ─────────────────────────────────────────────────────────────
//  Firebase 設定（照 README 第 2 步，把 Firebase 主控台給的 firebaseConfig 貼進來）
//
//  ・這裡的內容本來就會公開在網頁上，不是密碼；真正保護資料的是 database.rules.json 的規則。
//  ・後台帳號密碼存在 Firebase Authentication，不會出現在任何程式碼裡，按 F12 也看不到。
//  ・還沒填（apiKey 是空的）時，網站會用「單機測試模式」：資料只存在這台電腦的瀏覽器。
// ─────────────────────────────────────────────────────────────

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBUxMc276d0Icndk1GFluqpW3LDmUJ4h4U',
  authDomain: 'kuangxiang-bracket.firebaseapp.com',
  databaseURL: 'https://kuangxiang-bracket-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'kuangxiang-bracket',
  storageBucket: 'kuangxiang-bracket.firebasestorage.app',
  messagingSenderId: '566232207552',
  appId: '1:566232207552:web:88b7c580917774fcb19d25',
};

// 後台登入時，帳號沒有輸入 @ 就自動補上這個網域。
// 例：在 Firebase 建立使用者 admin@kuangxiang.local，登入時帳號只要打 admin。
export const ACCOUNT_DOMAIN = 'kuangxiang.local';

// 資料放在 Realtime Database 的哪個節點底下（要跟 database.rules.json 一致）
export const DB_ROOT = 'kxBracket';
