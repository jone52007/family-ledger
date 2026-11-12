/* =========================================================
   家庭記帳本 v2（Firebase 同步版）
   - Firestore 即時同步、離線可記帳（恢復網路後自動上傳）
   - Google 登入，只開放 firebase-config.js 中的兩個帳號
   - 刪除先進垃圾桶（30 天），每次修改留下紀錄
   ========================================================= */
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, query, where, onSnapshot, setDoc, updateDoc, deleteDoc, getDocs, addDoc,
  writeBatch, deleteField, FieldPath, serverTimestamp
} from "firebase/firestore";

const CFG = window.FL_CONFIG || {};
const ASSET = "assets/PNG/";
const HID = "main";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2, "0");
const ymOf = d => d.slice(0, 7);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const money = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US"); };
const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, "");
const ymLabel = ym => ym.replace("-", " / ");
const addMonth = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; };

/* ---------- 預設類別 ---------- */
const DEFAULT_CATS = [
  ["food","食","🍱","早餐 午餐 晚餐 早午餐 宵夜 便當 餐廳 小吃 麵 飯 粥 火鍋 燒肉 拉麵 壽司 披薩 漢堡 麥當勞 肯德基 摩斯 subway 咖啡 星巴克 路易莎 85度c 飲料 手搖 珍奶 50嵐 清心 可不可 迷客夏 茶湯會 得正 紅茶 綠茶 烏龍茶 多多綠 甜點 點心 蛋糕 麵包 外送 eats ubereats foodpanda 熊貓 聚餐 全聯 家樂福 好市多 costco 美廉社 超市 菜市場 買菜 蔬菜 水果 食材 採買 米酒 調味 7-11 711 萊爾富 超商"],
  ["cloth","衣","👕","衣服 褲子 外套 鞋 襪子 包包 髮圈 uniqlo gu zara net 剪髮 美髮 髮廊 化妝品 保養品 美甲"],
  ["live","住","🏠","房貸 貸款 房租 管理費 水費 電費 瓦斯 天然氣 網路 第四台 電話費 手機費 電信 中華電信 台灣大哥大 遠傳 衛生紙 廚房紙巾 洗衣 洗碗精 洗髮 沐浴 牙膏 牙刷 垃圾袋 垃圾桶 清潔 擴香 電池 屈臣氏 康是美 寶雅 大創 無印 家具 ikea 宜得利 特力屋 維修 水電 家電 燈泡 收納 窗簾 鍋 碗 筷 刀具 砧板 保鮮盒 枕頭 置物架 標籤機"],
  ["go","行","🚗","加油 中油 台塑 停車 停車費 捷運 公車 高鐵 台鐵 自強 火車 計程車 uber 小黃 悠遊卡 一卡通 etc 過路 通行費 國道 機車 汽車 保養 洗車 輪胎 牌照稅 燃料稅 youbike gogoro"],
  ["edu","育","📚","書 書籍 課程 線上課 hahow 講座 證照 考試 英文 claude chatgpt"],
  ["fun","樂","🎡","電影 威秀 netflix disney spotify youtube 遊戲 steam switch 網咖 拼圖 樂高 ktv 唱歌 旅遊 旅行 住宿 飯店 民宿 訂房 機票 門票 樂園 露營 展覽 演唱會"],
  ["kid","小孩","🧸","尿布 奶粉 副食品 奶瓶 奶嘴 米餅 寶寶粥 濕紙巾 玩具 童裝 童書 繪本 學費 安親 保母 托嬰 幼兒園 幼稚園 才藝 文具 兒童 寶寶 嬰兒 小孩 小兒科"],
  ["medical","醫療","💊","診所 醫院 掛號 看診 回診 藥 藥局 牙醫 眼科 健檢 保健 維他命 口罩 復健"],
  ["other","其他","📦","紅包 禮金 喜酒 白包 禮物 送禮 伴手禮 孝親 保險 保費 稅 所得稅 房屋稅 地價稅 訂金 寵物 飼料 獸醫"]
].map(([id, name, icon, kw]) => ({id, name, icon, keywords:kw.split(/\s+/).filter(Boolean)}));
const CAT_TINT = ["#fff1d6","#e3f8ec","#eef0ff","#e8f6fd","#fff4c7","#f0ebff","#ffe4e8","#e6f9f6","#fde8ff","#e5f1ff","#ffece0","#eaf3e2","#f3efe6","#fbeee6","#e8f6fd","#f1f2f7"];

function defaultSettings(){
  return {
    members:{me:"家華", wife:"太太", kid:"小孩"},
    splitMe:50,
    categories:DEFAULT_CATS,
    learned:{},
    fixed:[
      {id:"fx-house", name:"房貸", icon:"🏦", cat:"live", amount:30000, day:5, payer:"joint", countMonthly:true, inSettle:false},
      {id:"fx-kid", name:"小孩基金", icon:"🐷", cat:"kid", amount:5000, day:10, payer:"me", countMonthly:false, inSettle:false}
    ],
    catVersion:2,
    createdAt:Date.now()
  };
}

/* ---------- Firebase ---------- */
let app, auth, db, settingsRef;
const configured = !!(CFG.firebase && CFG.firebase.apiKey && !String(CFG.firebase.apiKey).startsWith("請"));
if (configured) {
  app = initializeApp(CFG.firebase);
  auth = getAuth(app);
  db = initializeFirestore(app, {localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})});
  settingsRef = doc(db, "households", HID);
}
const col = name => collection(db, "households", HID, name);

/* ---------- 狀態 ---------- */
let user = null, who = "me";
let SET = null;                 // households/main
let recMap = new Map();         // 目前視窗（上月＋本月）的紀錄
let trash = [];
let fixedLog = {}, settled = {};
let pending = {recs:false, set:false};
let curYM = todayStr().slice(0, 7);
let winStart = null;            // 已訂閱的月份視窗起點
let unsubs = [], unsubRecs = null;
let filt = {owner:"all", payer:"all", cat:"all", q:""};
let soundOn = localStorage.getItem("fl-sound") !== "0";
let S = {};                     // 給畫面用的合成狀態

function compose(){
  S = Object.assign({}, SET || defaultSettings(), {
    records:[...recMap.values()].filter(r => !r.deleted),
    fixedLog, settled
  });
}

/* ---------- 登入 ---------- */
function emailKey(email){
  const e = String(email || "").toLowerCase();
  const em = CFG.emails || {};
  if (e && e === String(em.me || "").toLowerCase()) return "me";
  if (e && e === String(em.wife || "").toLowerCase()) return "wife";
  return null;
}
async function login(){
  const p = new GoogleAuthProvider(); p.setCustomParameters({prompt:"select_account"});
  try { await signInWithPopup(auth, p); }
  catch(e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") await signInWithRedirect(auth, p);
    else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") toast("登入失敗：" + e.code);
  }
}
window.login = login;
window.logout = async () => { unsubAll(); await signOut(auth); };

function unsubAll(){ unsubs.forEach(u => u()); unsubs = []; if (unsubRecs) unsubRecs(); unsubRecs = null; winStart = null; recMap.clear(); SET = null; }

function startData(){
  // 家庭設定
  unsubs.push(onSnapshot(settingsRef, {includeMetadataChanges:true}, async snap => {
    pending.set = snap.metadata.hasPendingWrites;
    if (!snap.exists()) {
      if (snap.metadata.fromCache) return;        // 等伺服器確認
      await setDoc(settingsRef, defaultSettings());
      return;
    }
    SET = Object.assign(defaultSettings(), snap.data());
    if (!snap.metadata.fromCache && (snap.data().catVersion || 1) < 2) migrateCats();
    render();
  }, err => fatal(err)));
  unsubs.push(onSnapshot(col("fixedLog"), snap => { fixedLog = {}; snap.forEach(d => fixedLog[d.id] = d.data()); render(); }, err => fatal(err)));
  unsubs.push(onSnapshot(col("settled"), snap => { settled = {}; snap.forEach(d => settled[d.id] = d.data()); render(); }, err => fatal(err)));
  ensureWindow();
}
function ensureWindow(){
  const need = addMonth(curYM, -1);
  if (winStart === need) return;
  winStart = need;
  if (unsubRecs) unsubRecs();
  const q = query(col("records"), where("date", ">=", need + "-01"), where("date", "<=", curYM + "-31"));
  unsubRecs = onSnapshot(q, {includeMetadataChanges:true}, snap => {
    recMap = new Map(); snap.forEach(d => recMap.set(d.id, {id:d.id, ...d.data()}));
    pending.recs = snap.metadata.hasPendingWrites;
    render();
  }, err => fatal(err));
}
function fatal(err){
  console.error(err);
  if (err.code === "permission-denied") showGate("denied");
  else toast("資料連線錯誤：" + (err.code || err.message));
}

/* ---------- 寫入 ---------- */
const meta = () => ({updatedAt:Date.now(), updatedBy:user?.email || ""});
function wr(p){ p.catch(e => { console.error(e); toast("儲存失敗：" + (e.code || e.message)); }); }
function logHistory(action, recId, before, after){ wr(addDoc(col("history"), {action, recId, before:before || null, after:after || null, at:Date.now(), by:user?.email || ""})); }
function setField(path, value){ wr(updateDoc(settingsRef, new FieldPath(...path), value)); }

/* ---------- 音效 ---------- */
const SND = {tap:"assets/Sounds/tap-a.ogg", click:"assets/Sounds/click-a.ogg", sw:"assets/Sounds/switch-a.ogg"};
function sfx(k){ if (!soundOn) return; try { const a = new Audio(SND[k]); a.volume = .35; a.play().catch(()=>{}); } catch(e){} }

/* ---------- 計算 ---------- */
const catById = id => S.categories.find(c => c.id === id) || S.categories.find(c => c.id === "other") || {id:"other",name:"其他",icon:"📦"};
const catTint = id => CAT_TINT[Math.max(0, S.categories.findIndex(c => c.id === id)) % CAT_TINT.length];
const payerName = p => p === "joint" ? "共同帳戶" : S.members[p];
const ownerName = o => o === "shared" ? "家庭共同" : S.members[o] + "個人";
const monthRecords = ym => S.records.filter(r => ymOf(r.date) === ym);
function fixedForMonth(ym){
  const startOf = f => f.startYM || (S.createdAt ? ymOf(new Date(S.createdAt).toISOString().slice(0, 10)) : "0000-00");
  return S.fixed.filter(f => f.countMonthly && startOf(f) <= ym).map(f => ({id:"v-"+f.id, fixed:f, date:`${ym}-${pad(Math.min(f.day,28))}`, amount:(S.fixedLog[ym]?.[f.id]?.amount) ?? f.amount, desc:f.name, cat:f.cat, payer:f.payer, owner:"shared", inSettle:f.inSettle}));
}
function stats(ym){
  const recs = monthRecords(ym), fx = fixedForMonth(ym), all = recs.concat(fx);
  const sum = a => a.reduce((s, r) => s + Number(r.amount), 0);
  const o = {recs, fx, all, total:sum(all), shared:sum(all.filter(r => r.owner === "shared")), me:sum(all.filter(r => r.owner === "me")), wife:sum(all.filter(r => r.owner === "wife")), byCat:{}};
  all.forEach(r => o.byCat[r.cat] = (o.byCat[r.cat] || 0) + Number(r.amount));
  const sh = recs.filter(r => r.owner === "shared").concat(fx.filter(f => f.inSettle));
  o.paidMe = sum(sh.filter(r => r.payer === "me"));
  o.paidWife = sum(sh.filter(r => r.payer === "wife"));
  o.paidJoint = sum(recs.filter(r => r.owner === "shared" && r.payer === "joint").concat(fx.filter(f => f.payer === "joint")));
  o.settleBase = o.paidMe + o.paidWife;
  o.shouldMe = o.settleBase * S.splitMe / 100;
  o.diff = o.paidMe - o.shouldMe;
  return o;
}


/* ---------- 類別改版（v2：食衣住行育樂＋小孩＋醫療＋其他），只會執行一次 ---------- */
const CAT_V2_MAP = {food:"food", grocery:"food", daily:"live", home:"live", telecom:"live", house:"live",
  traffic:"go", learn:"edu", fun:"fun", shop:"cloth", kid:"kid", medical:"medical", social:"other", insurance:"other", pet:"other", other:"other"};
const catV2 = r => {
  if (r.cat === "shop" && /標籤機/.test(r.desc || "")) return "live";
  if (r.cat === "other" && /claude/i.test(r.desc || "")) return "edu";
  return CAT_V2_MAP[r.cat] || r.cat;
};
let migrating = false;
async function migrateCats(){
  if (migrating) return; migrating = true;
  try {
    const snap = await getDocs(col("records"));
    const ops = [];
    snap.forEach(d => { const r = d.data(); const nc = catV2(r); if (nc !== r.cat) ops.push(b => b.update(d.ref, {cat:nc, catBefore:r.cat})); });
    const learned = {}; for (const k in (SET.learned || {})) learned[k] = CAT_V2_MAP[SET.learned[k]] || SET.learned[k];
    const fixed = (SET.fixed || []).map(f => ({...f, cat:CAT_V2_MAP[f.cat] || f.cat}));
    for (let i = 0; i < ops.length; i += 400) { const b = writeBatch(db); ops.slice(i, i + 400).forEach(f => f(b)); await b.commit(); }
    await updateDoc(settingsRef, {categories:DEFAULT_CATS, learned, fixed, catVersion:2, catMigratedAt:Date.now(), catMigratedBy:user?.email || ""});
    toast(`類別已改為食衣住行育樂＋小孩、醫療、其他（轉換 ${ops.length} 筆）`);
  } catch(e) { console.error(e); toast("類別轉換失敗：" + (e.code || e.message)); migrating = false; }
}

/* ---------- 自動判斷類別 ---------- */
function keywordGuess(desc){
  const d = norm(desc); let best = null, len = 0;
  for (const c of S.categories) for (const k of c.keywords || []) { const kk = norm(k); if (kk && d.includes(kk) && kk.length > len) { best = c.id; len = kk.length; } }
  return best;
}
function guessCat(desc){
  const d = norm(desc); if (!d) return null;
  if (S.learned[d]) return {id:S.learned[d], why:"依你們之前的選擇"};
  const k = keywordGuess(desc);
  const kidName = norm(S.members?.kid);
  if (kidName && d.includes(kidName) && k !== "food") return {id:"kid", why:`有提到${S.members.kid}`};
  if (k) return {id:k, why:"關鍵字判斷"};
  for (const key in S.learned) if (key.length >= 2 && d.includes(key)) return {id:S.learned[key], why:"類似之前的紀錄"};
  return null;
}

/* ---------- 共用元件 ---------- */
function shiftMonth(n){ curYM = addMonth(curYM, n); sfx("tap"); ensureWindow(); render(); }
window.shiftMonth = shiftMonth;
function monthNav(){
  return `<div class="monthnav">
    <button class="roundbtn" onclick="shiftMonth(-1)" title="上個月"><img src="${ASSET}Blue/Double/arrow_basic_w.png" alt="上個月"></button>
    <span class="m deco">${ymLabel(curYM)}</span>
    <button class="roundbtn" onclick="shiftMonth(1)" title="下個月"><img src="${ASSET}Blue/Double/arrow_basic_e.png" alt="下個月"></button>
  </div>`;
}
function emptyBox(t){ return `<div class="empty"><img src="${ASSET}Grey/Double/check_round_grey.png" alt="">${t}</div>`; }
function firstRunBanner(){
  if (S.records.length || Object.keys(S.fixedLog).length || localStorage.getItem("fl-hide-import")) return "";
  return `<div class="banner"><span>📥</span><span class="sp">歡迎！如果你在第一版（本機版）已經記過帳，可以到「設定」匯入第一版匯出的備份 JSON。</span><button class="kbtn yellow sm" onclick="location.hash='#settings'">前往匯入</button><button class="kbtn grey sm" onclick="localStorage.setItem('fl-hide-import',1);render()">不用了</button></div>`;
}

/* =================== 總覽 =================== */
function pageOverview(){
  const st = stats(curYM), pv = stats(addMonth(curYM, -1));
  const chg = pv.total ? (st.total - pv.total) / pv.total * 100 : null;
  const m = S.members;
  const parts = [["shared","家庭共同",st.shared,"var(--c-shared)"],["me",m.me+"個人",st.me,"var(--c-me)"],["wife",m.wife+"個人",st.wife,"var(--c-wife)"]];
  const cats = Object.entries(st.byCat).sort((a, b) => b[1] - a[1]); const maxC = cats[0]?.[1] || 1;
  const [y, mo] = curYM.split("-").map(Number); const days = new Date(y, mo, 0).getDate();
  const daily = Array(days).fill(0); st.recs.forEach(r => daily[Number(r.date.slice(8)) - 1] += Number(r.amount));
  const maxD = Math.max(...daily, 1); const isCur = curYM === todayStr().slice(0, 7); const td = new Date().getDate();
  return `
  <div class="topbar"><h1>本月總覽</h1>${monthNav()}</div>
  ${firstRunBanner()}
  <div class="grid g-kpi">
    <div class="card kpi hero"><div class="t">本月總花費</div><div class="v num">${money(st.total)}</div>
      <div class="s">${chg === null ? "上月無資料" : `比上月 ${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(0)}%`}・含計入的固定支出</div></div>
    ${parts.map(p => `<div class="card kpi"><div class="t"><i class="swatch" style="background:${p[3]}"></i>${esc(p[1])}</div><div class="v num">${money(p[2])}</div><div class="s">${st.total ? (p[2] / st.total * 100).toFixed(0) : 0}% 的花費</div></div>`).join("")}
  </div>
  <div class="card" style="margin-top:18px">
    <h3>花費組成 <small>共同 vs 個人</small></h3>
    <div class="stack">${st.total ? parts.filter(p => p[2] > 0).map(p => `<div style="flex:${p[2]};background:${p[3]}" data-tip="${esc(p[1])}：${money(p[2])}"></div>`).join("") : `<div style="flex:1;background:#f1f2f7"></div>`}</div>
    <div class="legend">${parts.map(p => `<span><i class="swatch" style="background:${p[3]}"></i>${esc(p[1])} <b class="num">${money(p[2])}</b></span>`).join("")}</div>
  </div>
  <div class="grid g-2" style="margin-top:18px">
    <div class="grid" style="align-content:start">
      <div class="card"><h3>類別排行<span class="sp"></span><small>點類別看明細</small></h3>
        ${cats.length ? cats.map(([id, v]) => { const c = catById(id); return `<div class="cbar" style="cursor:pointer" onclick="gotoCat('${id}')"><span class="nm"><span>${c.icon}</span>${esc(c.name)}</span><div class="tr"><div style="width:${v / maxC * 100}%"></div></div><span class="am num">${money(v)}<span class="pc">${(v / st.total * 100).toFixed(0)}%</span></span></div>`; }).join("") : emptyBox("這個月還沒有花費")}
      </div>
      <div class="card"><h3>每日花費<span class="sp"></span><small>不含固定支出</small></h3>
        <div class="daily">${daily.map((v, i) => `<div class="b ${isCur && i + 1 === td ? "today" : ""}" data-tip="${mo}/${i + 1}：${money(v)}"><i style="height:${v / maxD * 100}%"></i></div>`).join("")}</div>
        <div class="daily-x num"><span>1</span><span>${Math.ceil(days / 2)}</span><span>${days}</span></div>
      </div>
    </div>
    <div class="grid" style="align-content:start">
      ${settleCard(st)}
      <div class="card"><h3>📌 固定支出狀態<span class="sp"></span><a href="#fixed" style="font-size:12px">管理 →</a></h3>${S.fixed.map(f => fixedRow(f)).join("") || emptyBox("沒有固定支出")}</div>
      <div class="card"><h3>最近紀錄<span class="sp"></span><a href="#records" style="font-size:12px">全部 →</a></h3>
        ${st.recs.length ? sortRecs(st.recs).slice(0, 5).map(recRow).join("") : emptyBox("還沒有紀錄，按右下角「記一筆」")}</div>
    </div>
  </div>`;
}
function settleCard(st){
  const m = S.members; const done = S.settled[curYM];
  let body;
  if (st.settleBase === 0) body = `<div class="empty" style="padding:14px">本月沒有需要結算的共同支出</div>`;
  else if (Math.abs(st.diff) < 1) body = `<div class="who">兩人剛好打平 🎉</div>`;
  else {
    const from = st.diff > 0 ? "wife" : "me", to = st.diff > 0 ? "me" : "wife";
    body = `<div class="who"><span class="avatar av-${from}">${esc(m[from][0])}</span><b>${esc(m[from])}</b> 要給 <b>${esc(m[to])}</b><span class="avatar av-${to}">${esc(m[to][0])}</span></div><div class="amt num">${money(Math.abs(st.diff))}</div>`;
  }
  return `<div class="card settle"><h3>🤝 月底結算<span class="sp"></span>${done ? `<span class="tag shared"><img src="${ASSET}Green/Double/icon_checkmark.png" style="width:14px;height:13px" alt="">已結清</span>` : `<a href="#settle" style="font-size:12px">詳細 →</a>`}</h3>
    ${body}
    <div class="rows">
      <div><span>${esc(m.me)} 先付的共同支出</span><b class="num">${money(st.paidMe)}</b></div>
      <div><span>${esc(m.wife)} 先付的共同支出</span><b class="num">${money(st.paidWife)}</b></div>
      <div><span>共同帳戶支付（不需結算）</span><span class="num">${money(st.paidJoint)}</span></div>
      <div><span>分攤比例</span><span>${esc(m.me)} ${S.splitMe}% ・ ${esc(m.wife)} ${100 - S.splitMe}%</span></div>
    </div></div>`;
}
// 共同帳戶自動扣款顯示「已繳」，由個人轉帳的顯示「已轉帳」
const verbOf = f => (f.countMonthly && f.payer === "joint") ? "已繳" : "已轉帳";
function fixedRow(f){
  const log = S.fixedLog[curYM]?.[f.id]; const verb = verbOf(f);
  return `<div class="fx"><div class="ico">${f.icon}</div>
    <div class="info"><b>${esc(f.name)}</b> <span class="num" style="font-size:13px;color:var(--ink2)">${money(log?.amount ?? f.amount)}</span>
      <small>每月 ${f.day} 號・${esc(payerName(f.payer))}支付・${f.countMonthly ? '<span class="tag">計入每月花費</span>' : '<span class="tag off">不計入花費・獨立記錄</span>'}</small></div>
    <label class="kcheck"><input type="checkbox" ${log?.done ? "checked" : ""} onchange="toggleFixed('${f.id}',this.checked)"><i></i>${log?.done ? `<span style="color:var(--green-dd);font-weight:700">${verb}</span>` : `<span style="color:var(--ink3)">未${verb.slice(1)}</span>`}</label>
  </div>`;
}
window.toggleFixed = (id, on, ym = curYM) => {
  const f = S.fixed.find(x => x.id === id); const ref = doc(db, "households", HID, "fixedLog", ym);
  if (on) wr(setDoc(ref, {[id]:{done:true, date:todayStr(), by:who, byEmail:user.email, amount:S.fixedLog[ym]?.[id]?.amount ?? f.amount}}, {merge:true}));
  else wr(setDoc(ref, {[id]:deleteField()}, {merge:true}));
  sfx(on ? "click" : "sw"); if (on) toast(`${f.name} ${ymLabel(ym)} 已標記完成`);
};

/* =================== 明細 =================== */
const sortRecs = a => a.slice().sort((x, y) => y.date.localeCompare(x.date) || (y.createdAt || 0) - (x.createdAt || 0));
function recRow(r){
  const c = catById(r.cat);
  return `<div class="rec" onclick="openEdit('${r.id}')">
    <div class="ico" style="background:${catTint(r.cat)}">${c.icon}</div>
    <div class="info"><b>${esc(r.desc || c.name)}</b>
      <div class="meta"><span class="tag">${esc(c.name)}</span><span class="tag ${r.owner}">${esc(ownerName(r.owner))}</span>${r.note ? `<span style="font-size:12px;color:var(--ink3)">${esc(r.note)}</span>` : ""}</div></div>
    <div><div class="amt num">${money(r.amount)}</div><span class="payer">${esc(payerName(r.payer))}付${r._pending ? " ・⏳" : ""}</span></div>
  </div>`;
}
function pageRecords(){
  let recs = monthRecords(curYM);
  if (filt.owner !== "all") recs = recs.filter(r => r.owner === filt.owner);
  if (filt.payer !== "all") recs = recs.filter(r => r.payer === filt.payer);
  if (filt.cat !== "all") recs = recs.filter(r => r.cat === filt.cat);
  if (filt.q) recs = recs.filter(r => norm((r.desc || "") + (r.note || "")).includes(norm(filt.q)));
  const total = recs.reduce((s, r) => s + Number(r.amount), 0);
  const groups = {}; sortRecs(recs).forEach(r => (groups[r.date] = groups[r.date] || []).push(r));
  const m = S.members; const wk = "日一二三四五六";
  const segBtn = (key, val, label, color) => `<button class="${filt[key] === val ? "on " + color : ""}" onclick="setFilt('${key}','${val}')">${label}</button>`;
  return `
  <div class="topbar"><h1>明細</h1>${monthNav()}</div>
  <div class="card">
    <div class="filters">
      <div class="seg small" style="flex:2;min-width:280px">${segBtn("owner","all","全部","c-blue")}${segBtn("owner","shared","家庭共同","c-green")}${segBtn("owner","me",esc(m.me)+"個人","c-blue")}${segBtn("owner","wife",esc(m.wife)+"個人","c-red")}</div>
      <select class="inp" onchange="setFilt('payer',this.value)"><option value="all">所有付款人</option>${["me","wife","joint"].map(p => `<option value="${p}" ${filt.payer === p ? "selected" : ""}>${esc(payerName(p))}付</option>`).join("")}</select>
      <select class="inp" onchange="setFilt('cat',this.value)"><option value="all">所有類別</option>${S.categories.map(c => `<option value="${c.id}" ${filt.cat === c.id ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}</select>
      <input class="inp" id="qInput" style="flex:1;min-width:140px" placeholder="🔍 搜尋描述" value="${esc(filt.q)}">
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:14px;color:var(--ink2)">
      <span>共 <b>${recs.length}</b> 筆（不含固定支出）</span><span>合計 <b class="num" style="font-size:18px;color:var(--ink)">${money(total)}</b></span>
    </div>
  </div>
  <div style="margin-top:8px">
  ${Object.keys(groups).length ? Object.entries(groups).map(([d, rs]) => `<div class="rec-day"><span>${Number(d.slice(5,7))}月${Number(d.slice(8))}日（${wk[new Date(d + "T00:00").getDay()]}）</span><span class="num">${money(rs.reduce((s, r) => s + Number(r.amount), 0))}</span></div>${rs.map(recRow).join("")}`).join("") : `<div class="card" style="margin-top:12px">${emptyBox("沒有符合的紀錄")}</div>`}
  </div>`;
}
window.setFilt = (k, v) => { filt[k] = v; sfx("tap"); render(); };
window.gotoCat = id => { filt = {owner:"all", payer:"all", cat:id, q:""}; location.hash = "#records"; };

/* =================== 月底結算 =================== */
function pageSettle(){
  const st = stats(curYM), m = S.members; const done = S.settled[curYM];
  const sh = st.recs.filter(r => r.owner === "shared" && r.payer !== "joint").concat(st.fx.filter(f => f.inSettle && f.payer !== "joint"));
  const table = p => { const rs = sortRecs(sh.filter(r => r.payer === p)); return rs.length ? `<table class="tb"><tr><th>日期</th><th>項目</th><th class="r">金額</th></tr>${rs.map(r => `<tr><td class="num" style="font-size:12px">${r.date.slice(5)}</td><td>${catById(r.cat).icon} ${esc(r.desc)}${r.fixed ? ' <span class="tag">固定</span>' : ""}</td><td class="r num">${money(r.amount)}</td></tr>`).join("")}</table>` : emptyBox("沒有先付的共同支出"); };
  const history = Object.entries(S.settled).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  return `
  <div class="topbar"><h1>月底結算</h1>${monthNav()}</div>
  <div class="grid g-2">
    <div class="grid" style="align-content:start">
      <div class="card"><h3>計算方式</h3>
        <table class="tb">
          <tr><td>${esc(m.me)} 先付的共同支出</td><td class="r num">${money(st.paidMe)}</td></tr>
          <tr><td>${esc(m.wife)} 先付的共同支出</td><td class="r num">${money(st.paidWife)}</td></tr>
          <tr><td><b>需要平分的總額</b></td><td class="r num"><b>${money(st.settleBase)}</b></td></tr>
          <tr><td>${esc(m.me)} 應負擔 ${S.splitMe}%</td><td class="r num">${money(st.shouldMe)}</td></tr>
          <tr><td>${esc(m.wife)} 應負擔 ${100 - S.splitMe}%</td><td class="r num">${money(st.settleBase - st.shouldMe)}</td></tr>
        </table>
        <p style="font-size:12px;color:var(--ink3);margin:10px 0 0;line-height:1.6">・只有「家庭共同」且由個人先付的支出會列入結算；共同帳戶付的、個人支出都不列入。<br>・固定支出可在「固定支出」頁決定要不要列入結算。分攤比例可在「設定」調整。</p>
      </div>
      <div class="grid g-half">
        <div class="card"><h3><span class="avatar av-me sm">${esc(m.me[0])}</span>${esc(m.me)} 付的</h3>${table("me")}</div>
        <div class="card"><h3><span class="avatar av-wife sm">${esc(m.wife[0])}</span>${esc(m.wife)} 付的</h3>${table("wife")}</div>
      </div>
    </div>
    <div class="grid settle-side" style="align-content:start">
      ${settleCard(st)}
      ${st.settleBase && Math.abs(st.diff) >= 1 ? (done
        ? `<div class="card" style="text-align:center"><img src="${ASSET}Green/Double/check_round_color.png" width="44" alt=""><div style="margin:8px 0 12px;font-weight:700">${ymLabel(curYM)} 已於 ${done.date} 結清</div><button class="kbtn grey sm" onclick="unsettle()">取消結清標記</button></div>`
        : `<button class="kbtn yellow lg" onclick="markSettled()">✔ 標記本月已結清</button>`) : ""}
      <div class="card"><h3>結算紀錄</h3>
        ${history.length ? `<table class="tb">${history.map(([ym, h]) => `<tr><td class="num">${ymLabel(ym)}</td><td>${esc(m[h.from])} → ${esc(m[h.to])}</td><td class="r num">${money(h.amount)}</td></tr>`).join("")}</table>` : emptyBox("還沒有結算紀錄")}
      </div>
    </div>
  </div>`;
}
window.markSettled = () => {
  const st = stats(curYM);
  wr(setDoc(doc(db, "households", HID, "settled", curYM), {date:todayStr(), from:st.diff > 0 ? "wife" : "me", to:st.diff > 0 ? "me" : "wife", amount:Math.round(Math.abs(st.diff)), by:user.email}));
  sfx("click"); toast("已標記結清 🎉");
};
window.unsettle = () => { wr(deleteDoc(doc(db, "households", HID, "settled", curYM))); sfx("sw"); };

/* =================== 固定支出 =================== */
function pageFixed(){
  const y = curYM.slice(0, 4); const nowYM = todayStr().slice(0, 7);
  const kidBlocks = S.fixed.map(f => {
    let yearSum = 0, allSum = 0;
    for (const ym in S.fixedLog) { const l = S.fixedLog[ym][f.id]; if (l?.done) { allSum += Number(l.amount); if (ym.startsWith(y)) yearSum += Number(l.amount); } }
    const months = Array.from({length:12}, (_, i) => { const ym = `${y}-${pad(i + 1)}`; const l = S.fixedLog[ym]?.[f.id]; const fut = ym > nowYM;
      return `<div class="mon ${l?.done ? "done" : ""} ${fut && !l?.done ? "future" : ""}" onclick="toggleFixed('${f.id}',${!l?.done},'${ym}')">
        <div class="mn">${i + 1} 月</div><img src="${ASSET}${l?.done ? "Green/Double/check_round_color.png" : "Grey/Double/check_round_grey.png"}" alt=""><div class="ma num">${l?.done ? money(l.amount) : "—"}</div></div>`; }).join("");
    return `<div class="card"><h3>${f.icon} ${esc(f.name)} ${verbOf(f).slice(1)}紀錄<span class="sp"></span><small>點月份可切換「${verbOf(f)}」</small></h3>
      <div class="piggy" style="margin-bottom:16px">
        <div><div style="font-size:13px;color:var(--ink2)">${y} 年${f.countMonthly ? "已付" : "已存"}</div><div class="big num">${money(yearSum)}</div></div>
        <div><div style="font-size:13px;color:var(--ink2)">累計總額</div><div class="big num" style="color:var(--green-d)">${money(allSum)}</div></div>
        <div style="font-size:13px;color:var(--ink3)">每月 ${f.day} 號・${money(f.amount)}・由 ${esc(payerName(f.payer))} 轉入</div>
      </div>
      <div class="months">${months}</div></div>`;
  }).join("");
  return `
  <div class="topbar"><h1>固定支出</h1>${monthNav()}</div>
  <div class="grid g-2">
    <div class="card"><h3>${ymLabel(curYM)} 繳款狀態</h3>${S.fixed.map(f => fixedRow(f)).join("") || emptyBox("沒有固定支出")}</div>
    <div class="card"><h3>項目設定<span class="sp"></span><button class="kbtn green sm" onclick="openFixed()">＋ 新增</button></h3>
      ${S.fixed.map(f => `<div class="fx"><div class="ico">${f.icon}</div><div class="info"><b>${esc(f.name)}</b> <span class="num" style="font-size:13px">${money(f.amount)}</span>
        <small>${f.countMonthly ? "計入每月花費" : "不計入每月花費"}・${f.inSettle ? "列入月底結算" : "不列入結算"}</small></div>
        <button class="kbtn grey sm" onclick="openFixed('${f.id}')">編輯</button></div>`).join("")}
    </div>
  </div>
  <div style="margin-top:18px" class="grid">${kidBlocks}</div>`;
}
window.openFixed = id => {
  const f = id ? S.fixed.find(x => x.id === id) : {id:"", name:"", icon:"📌", cat:"home", amount:0, day:1, payer:"joint", countMonthly:true, inSettle:false};
  showModal(`<h2>${id ? "編輯" : "新增"}固定支出<button class="x" onclick="closeModal()"><img src="${ASSET}Red/Double/icon_cross.png" alt="關閉"></button></h2>
    <div class="row2"><div class="field"><label>名稱</label><input class="inp w100" id="fName" value="${esc(f.name)}" placeholder="例如：房貸"></div>
    <div class="field"><label>圖示（emoji）</label><input class="inp w100" id="fIcon" value="${esc(f.icon)}"></div></div>
    <div class="row2"><div class="field"><label>每月金額</label><input class="inp num w100" id="fAmt" type="number" inputmode="numeric" value="${f.amount}"></div>
    <div class="field"><label>每月幾號</label><input class="inp num w100" id="fDay" type="number" min="1" max="31" value="${f.day}"></div></div>
    <div class="field"><label>類別</label><select class="inp w100" id="fCat">${S.categories.map(c => `<option value="${c.id}" ${c.id === f.cat ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}</select></div>
    <div class="field"><label>誰支付</label><div class="seg" id="fPayer">${["me","wife","joint"].map(p => `<button data-v="${p}">${esc(payerName(p))}</button>`).join("")}</div></div>
    <div class="field" style="display:flex;flex-direction:column;gap:10px">
      <label class="kcheck"><input type="checkbox" id="fCount" ${f.countMonthly ? "checked" : ""}><i></i>計入每月花費（例如房貸）</label>
      <label class="kcheck"><input type="checkbox" id="fSettle" ${f.inSettle ? "checked" : ""}><i></i>列入月底共同支出結算（由個人先付、要平分時勾選）</label>
      <span style="font-size:12px;color:var(--ink3)">不計入每月花費的項目（例如小孩基金）會有獨立的每月轉帳打勾紀錄。</span>
    </div>
    <div class="actions">${id ? `<button class="kbtn red" style="flex:.5" onclick="delFixed('${id}')">刪除</button>` : ""}<button class="kbtn grey" onclick="closeModal()">取消</button><button class="kbtn green" onclick="saveFixed('${id}')">儲存</button></div>`);
  let payer = f.payer;
  segBind("#fPayer", {me:"c-blue", wife:"c-red", joint:"c-yellow"}, v => payer = v, payer);
  window._fixedPayer = () => payer;
};
window.saveFixed = id => {
  const name = $("#fName").value.trim(); if (!name) return toast("請輸入名稱");
  const d = {name, icon:$("#fIcon").value.trim() || "📌", amount:Number($("#fAmt").value) || 0, day:Math.min(31, Math.max(1, Number($("#fDay").value) || 1)), cat:$("#fCat").value,
    payer:window._fixedPayer(), countMonthly:$("#fCount").checked, inSettle:$("#fSettle").checked};
  const list = S.fixed.map(x => ({...x}));
  if (id) Object.assign(list.find(x => x.id === id), d); else list.push({id:"fx-" + uid(), startYM:curYM, ...d});
  setField(["fixed"], list); sfx("click"); closeModal();
};
window.delFixed = id => { if (!confirm("確定刪除這個固定支出項目？（過去的打勾紀錄會保留在備份中）")) return; setField(["fixed"], S.fixed.filter(f => f.id !== id)); closeModal(); };

/* =================== 垃圾桶 =================== */
async function loadTrash(){
  const snap = await getDocs(query(col("records"), where("deleted", "==", true)));
  const cutoff = Date.now() - 30 * 864e5; trash = [];
  snap.forEach(d => { const r = {id:d.id, ...d.data()}; if ((r.deletedAt || 0) < cutoff) wr(deleteDoc(d.ref)); else trash.push(r); });
  trash.sort((a, b) => b.deletedAt - a.deletedAt);
  if (location.hash === "#trash") render();
}
function pageTrash(){
  return `<div class="topbar"><h1>垃圾桶</h1></div>
  <div class="card"><h3>最近刪除的紀錄<span class="sp"></span><small>保留 30 天，之後自動永久刪除</small></h3>
  ${trash.length ? trash.map(r => { const c = catById(r.cat); const left = Math.max(0, 30 - Math.floor((Date.now() - r.deletedAt) / 864e5));
    return `<div class="fx"><div class="ico" style="background:${catTint(r.cat)}">${c.icon}</div><div class="info"><b>${esc(r.desc)}</b> <span class="num" style="font-size:13px">${money(r.amount)}</span>
      <small>${r.date}・${esc(ownerName(r.owner))}・由 ${esc(r.deletedBy || "")} 刪除・剩 ${left} 天</small></div>
      <button class="kbtn green sm" onclick="restoreRec('${r.id}')">復原</button></div>`; }).join("") : emptyBox("垃圾桶是空的")}
  </div>`;
}
window.restoreRec = id => {
  const r = trash.find(x => x.id === id);
  wr(updateDoc(doc(col("records"), id), {deleted:false, deletedAt:deleteField(), deletedBy:deleteField(), ...meta()}));
  logHistory("restore", id, null, r); trash = trash.filter(x => x.id !== id); sfx("click"); render(); toast("已復原");
};

/* =================== 設定 =================== */
function pageSettings(){
  const m = S.members; const learned = Object.entries(S.learned || {});
  const em = CFG.emails || {};
  return `
  <div class="topbar"><h1>設定</h1></div>
  <div class="grid g-2">
    <div class="grid" style="align-content:start">
      <div class="card"><h3>👨‍👩‍👧 家庭成員</h3>
        <div class="set-row"><span class="k"><span class="avatar av-me sm">${esc(m.me[0])}</span> 我</span><input class="inp" value="${esc(m.me)}" onchange="setMember('me',this.value)"><small class="muted">${esc(em.me || "")}</small></div>
        <div class="set-row"><span class="k"><span class="avatar av-wife sm">${esc(m.wife[0])}</span> 太太</span><input class="inp" value="${esc(m.wife)}" onchange="setMember('wife',this.value)"><small class="muted">${esc(em.wife || "")}</small></div>
        <div class="set-row"><span class="k"><span class="avatar av-kid sm">${esc(m.kid[0])}</span> 小孩</span><input class="inp" value="${esc(m.kid)}" onchange="setMember('kid',this.value)"></div>
        <div class="set-row"><span class="k">共同支出分攤</span><span>${esc(m.me)}</span><input type="number" class="inp num" style="width:90px" min="0" max="100" value="${S.splitMe}" onchange="setSplit(this.value)"><span>% ・ ${esc(m.wife)} ${100 - S.splitMe}%</span></div>
        <div class="set-row"><span class="k">按鈕音效</span><label class="kcheck"><input type="checkbox" ${soundOn ? "checked" : ""} onchange="setSound(this.checked)"><i></i>開啟（只影響這台裝置）</label></div>
      </div>
      <div class="card"><h3>💾 資料與備份</h3>
        <p class="note">資料存在 Firebase 雲端，你們兩人的手機與電腦會即時同步；沒網路時也能記，連上網路後會自動上傳。每天凌晨另有自動備份到 GitHub 私人儲存庫。</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="kbtn grey sm" onclick="exportJSON()">⬇ 下載完整備份 JSON</button>
          <button class="kbtn grey sm" onclick="exportCSV()">⬇ 匯出本月 CSV</button>
          <button class="kbtn grey sm" onclick="$('#impFile').click()">⬆ 匯入（第一版或備份檔）</button>
          <input type="file" id="impFile" accept=".json" style="display:none" onchange="importJSON(this.files[0])">
        </div>
        <div style="margin-top:12px"><a href="#trash">🗑️ 垃圾桶（最近 30 天刪除的紀錄）→</a></div>
      </div>
      <div class="card"><h3>🤖 已學會的分類<span class="sp"></span><small>手動改類別後會記住</small></h3>
        ${learned.length ? learned.map(([k, v]) => `<div class="fx" style="padding:6px 0"><div class="info">「${esc(k)}」→ ${catById(v).icon} ${esc(catById(v).name)}</div><button class="iconbtn" data-k="${esc(k)}" onclick="forget(this.dataset.k)"><img src="${ASSET}Red/Double/icon_cross.png" alt="刪除"></button></div>`).join("") : emptyBox("還沒有。記帳時手動換類別，系統就會記住")}
      </div>
      <div class="card"><h3>👤 帳號</h3><div class="set-row"><span>目前登入：<b>${esc(user?.email)}</b>（${esc(m[who])}）</span><span class="sp" style="flex:1"></span><button class="kbtn grey sm" onclick="logout()">登出</button></div></div>
    </div>
    <div class="card" style="align-self:start"><h3>🏷️ 類別與自動判斷關鍵字<span class="sp"></span><button class="kbtn green sm" onclick="addCat()">＋ 類別</button></h3>
      <p class="note" style="margin-top:-6px">描述中含有關鍵字就會自動選這個類別（以空白分隔）。</p>
      ${S.categories.map((c, i) => `<div class="catedit">
        <input class="inp" style="text-align:center;font-size:18px;padding:4px" value="${esc(c.icon)}" onchange="setCat(${i},'icon',this.value)">
        <input class="inp" value="${esc(c.name)}" onchange="setCat(${i},'name',this.value)">
        <input class="inp" style="font-size:13px" value="${esc((c.keywords || []).join(" "))}" placeholder="關鍵字" onchange="setCat(${i},'keywords',this.value)">
        ${["other","kid","medical"].includes(c.id) ? "<span></span>" : `<button class="iconbtn" title="刪除類別" onclick="delCat('${c.id}')"><img src="${ASSET}Red/Double/icon_cross.png" alt="刪除"></button>`}
      </div>`).join("")}
    </div>
  </div>`;
}
window.setMember = (k, v) => setField(["members", k], v.trim() || {me:"家華", wife:"太太", kid:"小孩"}[k]);
window.setSplit = v => setField(["splitMe"], Math.min(100, Math.max(0, Number(v) || 50)));
window.setSound = on => { soundOn = on; localStorage.setItem("fl-sound", on ? "1" : "0"); };
window.forget = k => wr(updateDoc(settingsRef, new FieldPath("learned", k), deleteField()));
window.setCat = (i, k, v) => { const list = S.categories.map(c => ({...c})); list[i][k] = k === "keywords" ? v.split(/\s+/).filter(Boolean) : v; setField(["categories"], list); };
window.addCat = () => { const list = S.categories.map(c => ({...c})); list.splice(list.length - 1, 0, {id:"c-" + uid(), name:"新類別", icon:"🔖", keywords:[]}); setField(["categories"], list); };
window.delCat = id => { if (!confirm("刪除類別？這個類別的紀錄會顯示為「其他」。")) return; setField(["categories"], S.categories.filter(c => c.id !== id)); };

/* ---------- 匯出 / 匯入 ---------- */
function download(name, text, type){ const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
window.exportJSON = async () => {
  toast("正在打包完整資料…");
  const out = {format:"family-ledger-v2", exportedAt:new Date().toISOString(), settings:SET, records:[], fixedLog:{}, settled:{}};
  (await getDocs(col("records"))).forEach(d => out.records.push({id:d.id, ...d.data()}));
  (await getDocs(col("fixedLog"))).forEach(d => out.fixedLog[d.id] = d.data());
  (await getDocs(col("settled"))).forEach(d => out.settled[d.id] = d.data());
  download(`家庭記帳備份_${todayStr()}.json`, JSON.stringify(out, null, 1), "application/json");
};
window.exportCSV = () => {
  const st = stats(curYM);
  const rows = [["日期","項目","類別","金額","歸屬","付款人","備註"]].concat(sortRecs(st.all).map(r => [r.date, r.desc, catById(r.cat).name, r.amount, ownerName(r.owner), payerName(r.payer), r.note || (r.fixed ? "固定支出" : "")]));
  download(`家庭記帳_${curYM}.csv`, "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n"), "text/csv");
};
window.importJSON = file => {
  if (!file) return; const rd = new FileReader();
  rd.onload = async () => {
    let d; try { d = JSON.parse(rd.result); } catch(e) { return toast("檔案格式不正確"); }
    const isV2 = d.format === "family-ledger-v2";
    const records = (d.records || []).filter(r => !r.demo);
    const settings = isV2 ? d.settings : (d.categories ? {members:d.members, splitMe:d.splitMe, categories:d.categories, learned:d.learned || {}, fixed:d.fixed} : null);
    if (!records.length && !settings) return toast("檔案裡沒有可匯入的資料");
    if (!confirm(`要匯入 ${records.length} 筆紀錄${settings ? "，並套用檔案中的類別、固定支出與成員設定" : ""}嗎？\n（相同 ID 的紀錄會被覆蓋，其他現有紀錄保留）`)) return;
    toast("匯入中…");
    const ops = [];
    if (settings) ops.push(b => b.set(settingsRef, Object.assign(defaultSettings(), settings), {merge:true}));
    records.forEach(r => { const {id, ...rest} = r; ops.push(b => b.set(doc(col("records"), id || uid()), {deleted:false, ...rest, importedAt:Date.now()})); });
    for (const ym in (d.fixedLog || {})) { const v = {...d.fixedLog[ym]}; for (const k in v) delete v[k]?.demo; ops.push(b => b.set(doc(col("fixedLog"), ym), v, {merge:true})); }
    for (const ym in (d.settled || {})) ops.push(b => b.set(doc(col("settled"), ym), d.settled[ym]));
    try {
      for (let i = 0; i < ops.length; i += 400) { const b = writeBatch(db); ops.slice(i, i + 400).forEach(f => f(b)); await b.commit(); }
      localStorage.setItem("fl-hide-import", 1); toast(`匯入完成：${records.length} 筆`);
    } catch(e) { toast("匯入失敗：" + (e.code || e.message)); }
  };
  rd.readAsText(file);
};

/* =================== 記一筆 =================== */
let draft = null;
window.openAdd = () => openEdit(null);
window.openEdit = id => {
  const r = id ? recMap.get(id) : null;
  if (id && !r) return;
  const today = todayStr();
  draft = r ? {...r, manual:true, ai:null} : {id:null, date:curYM === today.slice(0, 7) ? today : `${curYM}-01`, amount:"", desc:"", cat:"other", payer:who, owner:"shared", note:"", manual:false, ai:null};
  const m = S.members;
  showModal(`<h2>${r ? "✏️ 編輯紀錄" : "📝 記一筆"}<button class="x" onclick="closeModal()"><img src="${ASSET}Red/Double/icon_cross.png" alt="關閉"></button></h2>
    <div class="field"><div class="amtbox"><span class="num">$</span><input id="dAmt" type="number" inputmode="decimal" placeholder="0" value="${draft.amount}"></div></div>
    <div class="field"><label>花在什麼？</label><input class="inp w100" id="dDesc" placeholder="例如：全聯買菜、加油、尿布" value="${esc(draft.desc)}" autocomplete="off" list="descList">
      <datalist id="descList">${[...new Set(S.records.map(x => x.desc))].slice(-80).map(d => `<option value="${esc(d)}">`).join("")}</datalist>
      <div class="aihint" id="aiHint"></div></div>
    <div class="field"><label>類別</label><div class="cats" id="dCats"></div></div>
    <div class="field"><label>這筆是誰的花費？</label><div class="seg" id="dOwner"><button data-v="shared">🏠 家庭共同</button><button data-v="me">${esc(m.me)}個人</button><button data-v="wife">${esc(m.wife)}個人</button></div></div>
    <div class="field"><label>誰付的錢？</label><div class="seg" id="dPayer"><button data-v="me">${esc(m.me)}</button><button data-v="wife">${esc(m.wife)}</button><button data-v="joint">共同帳戶</button></div></div>
    <div class="row2"><div class="field"><label>日期</label><input class="inp num w100" type="date" id="dDate" value="${draft.date}"></div>
      <div class="field"><label>備註（選填）</label><input class="inp w100" id="dNote" value="${esc(draft.note || "")}"></div></div>
    ${r ? `<div class="note">最後修改：${esc(r.updatedBy || r.createdBy || "")} ${r.updatedAt ? new Date(r.updatedAt).toLocaleString("zh-TW") : ""}</div>` : ""}
    <div class="actions">
      ${r ? `<button class="kbtn red" style="flex:.6" onclick="delRec('${r.id}')">刪除</button>` : `<button class="kbtn grey" onclick="saveRec(true)">儲存並再記一筆</button>`}
      <button class="kbtn green" onclick="saveRec(false)">儲存</button></div>`);
  segBind("#dOwner", {shared:"c-green", me:"c-blue", wife:"c-red"}, v => draft.owner = v, draft.owner);
  segBind("#dPayer", {me:"c-blue", wife:"c-red", joint:"c-yellow"}, v => draft.payer = v, draft.payer);
  $("#dDesc").addEventListener("input", e => { draft.desc = e.target.value; autoCat(); });
  $("#dAmt").addEventListener("keydown", e => { if (e.key === "Enter") $("#dDesc").focus(); });
  $("#dDesc").addEventListener("keydown", e => { if (e.key === "Enter") window.saveRec(false); });
  renderCats(); if (!r) autoCat(); else updateHint();
  if (!r) setTimeout(() => { if (!$("#modal").contains(document.activeElement)) $("#dAmt").focus(); }, 60);
};
function autoCat(){ const g = guessCat(draft.desc); draft.ai = g; if (!draft.manual) draft.cat = g ? g.id : "other"; renderCats(); updateHint(); }
function updateHint(){
  const g = draft.ai || guessCat(draft.desc); const el = $("#aiHint"); if (!el) return;
  if (!draft.desc) el.innerHTML = "輸入描述後，系統會自動判斷類別";
  else if (g && draft.cat === g.id) el.innerHTML = `🤖 自動判斷為 <b>${catById(g.id).icon} ${esc(catById(g.id).name)}</b>（${g.why}），不對可以直接點下方類別修改`;
  else if (g) el.innerHTML = `🤖 系統猜是 ${esc(catById(g.id).name)}，你選了 <b>${esc(catById(draft.cat).name)}</b>，之後會記住這個選擇`;
  else el.innerHTML = draft.manual ? `已選 <b>${esc(catById(draft.cat).name)}</b>，之後同樣的描述會自動套用` : "🤔 判斷不出來，請點選類別（系統會記住）";
}
function renderCats(){
  const g = draft.ai;
  $("#dCats").innerHTML = S.categories.map(c => `<button class="cat ${draft.cat === c.id ? "on" : ""}" onclick="pickCat('${c.id}')">${g && g.id === c.id ? '<span class="ai">AI</span>' : ""}<span class="e">${c.icon}</span>${esc(c.name)}</button>`).join("");
}
window.pickCat = id => { draft.cat = id; draft.manual = true; sfx("tap"); renderCats(); updateHint(); };
function segBind(sel, colors, cb, initial){
  const box = $(sel);
  const set = v => box.querySelectorAll("button").forEach(b => { b.className = b.dataset.v === v ? "on " + colors[b.dataset.v] : ""; });
  if (initial) set(initial);
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { set(b.dataset.v); sfx("tap"); cb && cb(b.dataset.v); }));
}
window.saveRec = again => {
  const amount = Number($("#dAmt").value);
  if (!amount || amount <= 0) { toast("請輸入金額"); $("#dAmt").focus(); return; }
  const desc = $("#dDesc").value.trim();
  const id = draft.id || uid();
  const rec = {date:$("#dDate").value || todayStr(), amount, desc:desc || catById(draft.cat).name, cat:draft.cat, payer:draft.payer, owner:draft.owner, note:$("#dNote").value.trim(), deleted:false, ...meta()};
  if (draft.id) { const before = recMap.get(id); wr(updateDoc(doc(col("records"), id), rec)); logHistory("edit", id, strip(before), rec); }
  else { rec.createdAt = Date.now(); rec.createdBy = user.email; rec.by = who; rec.serverTime = serverTimestamp(); wr(setDoc(doc(col("records"), id), rec)); }
  // 學習：手動選的類別和關鍵字判斷不同時記住
  if (desc && draft.manual) {
    const key = norm(desc);
    if (keywordGuess(desc) !== draft.cat) { if (S.learned[key] !== draft.cat) setField(["learned", key], draft.cat); }
    else if (S.learned[key]) wr(updateDoc(settingsRef, new FieldPath("learned", key), deleteField()));
  }
  sfx("click");
  const ym = ymOf(rec.date); if (ym !== curYM) { curYM = ym; ensureWindow(); }
  if (again) { window.openAdd(); toast(`已記下 ${money(amount)}`); }
  else { closeModal(); toast(`已記下 ${rec.desc} ${money(amount)}${navigator.onLine ? "" : "（離線，連線後自動上傳）"}`); }
};
const strip = r => { if (!r) return null; const {id, serverTime, ...rest} = r; return rest; };
window.delRec = id => {
  if (!confirm("刪除這筆紀錄？（會先放到垃圾桶，30 天內可以復原）")) return;
  const before = recMap.get(id);
  wr(updateDoc(doc(col("records"), id), {deleted:true, deletedAt:Date.now(), deletedBy:user.email, ...meta()}));
  logHistory("delete", id, strip(before), null); sfx("sw"); closeModal(); toast("已移到垃圾桶");
};

/* ---------- modal / toast / tooltip ---------- */
function showModal(html){ $("#modal").innerHTML = html; $("#mask").classList.add("show"); document.body.classList.add("modal-open"); }
function closeModal(){ $("#mask").classList.remove("show"); document.body.classList.remove("modal-open"); }
window.closeModal = closeModal;
$("#mask")?.addEventListener("mousedown", e => { if (e.target.id === "mask") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
let toastT; function toast(t){ const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2400); }
window.toast = toast;
document.addEventListener("mousemove", e => {
  const t = e.target.closest("[data-tip]"); const tip = $("#tip");
  if (!t) { tip.style.display = "none"; return; }
  tip.textContent = t.dataset.tip; tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + "px"; tip.style.top = (e.clientY - 36) + "px";
});
document.addEventListener("input", e => {
  if (e.target.id === "qInput") { filt.q = e.target.value; clearTimeout(window._qt); window._qt = setTimeout(() => { render(); const i = $("#qInput"); if (i) { i.focus(); i.setSelectionRange(99, 99); } }, 300); }
});

/* ---------- 登入畫面 ---------- */
function showGate(kind){
  document.body.classList.add("gated");
  const g = $("#gate");
  const box = (inner) => `<div class="gatebox"><img src="${ASSET}Yellow/Double/star.png" alt="" class="gatestar"><h1>家庭記帳本</h1><div class="deco gatesub">FAMILY LEDGER</div>${inner}</div>`;
  if (kind === "config") g.innerHTML = box(`<p>還沒設定 Firebase。請在 <code>firebase-config.js</code> 填入專案設定。</p>`);
  else if (kind === "login") g.innerHTML = box(`<p>我們家的記帳本，兩人即時同步</p><button class="kbtn lg" onclick="login()">用 Google 帳號登入</button>`);
  else if (kind === "loading") g.innerHTML = box(`<p>載入中…</p>`);
  else if (kind === "denied") g.innerHTML = box(`<p>這個帳號（${esc(user?.email)}）沒有權限使用這本帳本。</p><button class="kbtn grey" onclick="logout()">換一個帳號</button>`);
  g.style.display = "flex";
}
function hideGate(){ document.body.classList.remove("gated"); $("#gate").style.display = "none"; }

/* ---------- render ---------- */
function renderStatus(){
  const el = $("#syncInfo"); if (!el) return;
  const off = !navigator.onLine;
  const pend = pending.recs || pending.set;
  el.innerHTML = off ? `<span class="dot warn"></span>離線中・記帳會先存在這台裝置<br>連上網路後自動上傳`
    : pend ? `<span class="dot warn"></span>同步中…` : `<span class="dot ok"></span>已同步到雲端`;
  const me = $("#meBox");
  if (me && user) me.innerHTML = `<span class="avatar av-${who}" style="width:30px;height:30px;font-size:13px">${esc(S.members[who][0])}</span><div style="min-width:0"><b>${esc(S.members[who])}</b><small>${esc(user.email)}</small></div>`;
  $("#offlinePill").style.display = off ? "flex" : "none";
}
function render(){
  if (!user || !SET) return;
  compose();
  let page = (location.hash || "#overview").slice(1);
  const pages = {overview:pageOverview, records:pageRecords, settle:pageSettle, fixed:pageFixed, settings:pageSettings, trash:pageTrash};
  if (!pages[page]) page = "overview";
  // 保留輸入焦點（避免同步更新時打斷輸入）
  const ae = document.activeElement;
  if (ae && $("#main").contains(ae) && ae.tagName === "INPUT" && ae.id !== "qInput") { ae.addEventListener("blur", () => setTimeout(render, 0), {once:true}); return; }
  $("#main").innerHTML = pages[page]();
  const tb = $("#main .topbar");
  if (tb && page !== "settings") tb.insertAdjacentHTML("beforeend", `<a class="m-gear" href="#settings" aria-label="設定">⚙️</a>`);
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.p === page || (page === "trash" && a.dataset.p === "settings")));
  renderStatus();
}
window.render = render;
window.$ = $;
window.addEventListener("hashchange", () => { sfx("tap"); if (location.hash === "#trash") loadTrash(); render(); scrollTo(0, 0); });
window.addEventListener("online", renderStatus); window.addEventListener("offline", renderStatus);
$("#fabBtn")?.addEventListener("click", () => { sfx("tap"); window.openAdd(); });
// 手機底部中間的「＋」：如果頁面是舊版快取沒有這顆按鈕，就自動補上
(function ensureNavAdd(){
  let btn = $("#navAdd");
  if (!btn) {
    const rec = document.querySelector('#nav a[data-p="records"]');
    if (!rec) return;
    rec.insertAdjacentHTML("afterend", `<a href="#" class="nav-add" id="navAdd" aria-label="記一筆" title="記一筆"><span class="plus"></span></a>`);
    btn = $("#navAdd");
    document.querySelector('#nav a[data-p="settings"]')?.classList.add("nav-settings");
  }
  btn.addEventListener("click", e => { e.preventDefault(); sfx("tap"); window.openAdd(); });
})();
// 觸控裝置：點長條圖等顯示數字
document.addEventListener("click", e => {
  if (!matchMedia("(hover:none)").matches) return;
  const t = e.target.closest("[data-tip]"); const tip = $("#tip");
  if (!t) { tip.style.display = "none"; return; }
  const r = t.getBoundingClientRect();
  tip.textContent = t.dataset.tip; tip.style.display = "block";
  tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 8)) + "px";
  tip.style.top = Math.max(8, r.top - 40) + "px";
  clearTimeout(window._tipT); window._tipT = setTimeout(() => tip.style.display = "none", 1800);
});

/* ---------- 啟動 ---------- */
if (!configured) showGate("config");
else {
  showGate("loading");
  onAuthStateChanged(auth, u => {
    user = u;
    if (!u) { unsubAll(); showGate("login"); return; }
    const k = emailKey(u.email);
    if (!k) { showGate("denied"); return; }
    who = k; hideGate(); showGate("loading"); startData();
    const wait = setInterval(() => { if (SET) { clearInterval(wait); hideGate(); render(); if (location.hash === "#trash") loadTrash(); } }, 100);
  });
}
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
