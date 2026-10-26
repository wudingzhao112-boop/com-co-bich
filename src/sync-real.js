// Bản thật: đơn và món lưu trên máy chủ quán (Cloudflare). Khách đặt không cần đăng nhập, chủ quán và shipper vào bằng mã PIN.
const KEY = "cobich-pin", DAY = "";
let db = null, role = null, pin = "", soldSrv = {}, menuReady = false, menuSig = "", menuQ = Promise.resolve();
const removed = new Set();
try { pin = localStorage.getItem(KEY) || ""; } catch (_) {}
const menuState = () => ({ stock: { ...stock }, lastQty: { ...lastQty }, tiers: TIERS.map(t => ({ ...t })), today: [...todaySet],
  prices: Object.fromEntries(MENU.filter(m => m.price).map(m => [m.id, m.price])),
  added: MENU.filter(m => m.added).map(({ id, cat, name, price }) => ({ id, cat, name, price })), removed: [...removed], names: Object.fromEntries(MENU.filter(m => m.renamed).map(m => [m.id, m.name])) });
function syncNote(text, bad) { const n = $("sync-note"); n.textContent = text; n.style.color = bad ? "var(--chili)" : ""; $("demo-note").hidden = !text; }
function syncErr(e) { syncNote("Mất kết nối máy chủ, đang thử lại… (" + (e?.message || e) + ")", true); }
async function api(path, opts = {}) {
  const r = await fetch("/api/" + path, { ...opts, headers: { "content-type": "application/json", ...(pin ? { "x-pin": pin } : {}), ...(opts.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || "Lỗi " + r.status), { status: r.status, data });
  syncNote("");
  return data;
}
function pushMenu() {
  if (role !== "owner" || !menuReady) return;
  const st = menuState(), sig = JSON.stringify(st);
  if (sig === menuSig) return;
  menuSig = sig;
  menuQ = menuQ.then(() => api("menu", { method: "PUT", body: sig })).catch(syncErr);
}
// Gửi đổi trạng thái kèm trạng thái cũ; máy khác đổi trước thì máy chủ từ chối và trang tải lại
let orderVer = 0;
function pushOrder(o, from) {
  orderVer++;
  let clash = "";
  api("orders/" + o.id, { method: "POST", body: JSON.stringify({ st: o.st, from }) })
    .catch(e => { if (e.status === 409) clash = e.message; else syncErr(e); })
    .finally(async () => {
      orderVer++; await pollOrders();
      if (clash) { syncNote(clash, true); setTimeout(() => syncNote(""), 6000); }
    });
}
function uploadImg(id, url) {
  if (role !== "owner") return;
  api("img/" + id, { method: "PUT", body: JSON.stringify({ data: url }) }).catch(e => alert("Chưa lưu được ảnh: " + e.message));
}
function applyMenu(d, imgs) {
  for (const m of d.added || []) if (!byId[m.id]) {
    const x = { ...m, added: true }; const at = MENU.map(y => y.cat).lastIndexOf(x.cat);
    MENU.splice(at < 0 ? MENU.length : at + 1, 0, x); byId[x.id] = x;
  }
  for (const id of d.removed || []) if (byId[id]) { removed.add(id); MENU.splice(MENU.indexOf(byId[id]), 1); delete byId[id]; }
  for (const key in stock) delete stock[key];
  Object.assign(stock, d.stock || {}); Object.assign(lastQty, d.lastQty || {}); if (Array.isArray(d.tiers) && d.tiers.length) TIERS.splice(0, TIERS.length, ...d.tiers); if (tierIx >= 0) Object.assign(SET, TIERS[tierIx] || {});
  todaySet.clear(); (d.today || []).forEach(id => byId[id] && todaySet.add(id));
  for (const [id, pr] of Object.entries(d.prices || {})) if (byId[id]) byId[id].price = pr;
  for (const [id, nm] of Object.entries(d.names || {})) if (byId[id]) Object.assign(byId[id], { name: nm, renamed: true });
  for (const [id, v] of Object.entries(imgs || {})) if (byId[id]) byId[id].img = "/api/img/" + id + "?v=" + v;
}
async function pollMenu() {
  if (mode === "khach" && editMode) return;
  const ae = document.activeElement;
  try {
    const d = await api("menu");
    soldSrv = d.sold || {};
    if (d.promo) { PROMO = d.promo; renderPromo(); }
    if (d.menu && !(ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && editMode)) applyMenu(d.menu, d.imgs);
    else if (d.imgs) for (const [id, v] of Object.entries(d.imgs)) if (byId[id]) byId[id].img = "/api/img/" + id + "?v=" + v;
    if (!menuReady) { menuReady = true; menuSig = d.menu ? JSON.stringify(menuState()) : ""; }
    render();
  } catch (e) { syncErr(e); }
}
// Chuông: đơn mới (chủ quán) hoặc đơn vừa soạn xong (shipper) thì kêu khi đang mở app
let seen = null;
function checkNew(list) {
  const key = o => o.id + (role === "ship" ? ":" + o.st : "");
  const watch = role === "owner" ? list : list.filter(o => o.st === "xong");
  if (seen && watch.some(o => !seen.has(key(o)))) ding();
  seen = new Set(watch.map(key));
}
async function pollOrders() {
  if (!role) return;
  const v = orderVer;
  try { const d = await api("orders"); if (v !== orderVer) return; checkNew(d.orders); orders = d.orders; render(); }
  catch (e) { if (e.status === 401) { role = null; route(); } else syncErr(e); }
}
async function placeOrder(o) {
  try { return { ok: true, ...(await api("orders", { method: "POST", body: JSON.stringify(o), headers: { "x-cus": memGet()?.token || "" } })) }; }
  catch (e) { if (e.status === 409) pollMenu(); return { ok: false, error: e.message }; }
}
async function checkRole() {
  if (!pin) { role = null; return; }
  try { role = (await api("auth")).role; } catch (_) { role = null; }
}
async function startSync() {
  await checkRole();
  await pollMenu();
  if (role) pollOrders();
  route();
  setInterval(() => { if (role) pollOrders(); }, 10000);
  setInterval(pollMenu, 30000);
}
const isPaid = o => o.pay === "Chuyển khoản" && !!o.paid;
document.addEventListener("click", e => {
  const b = e.target.closest("[data-paid]");
  if (!b || role !== "owner") return;
  const o = orders.find(x => x.no == b.dataset.paid);
  if (!o) return;
  b.disabled = true; o.paid = true; render();
  api("orders/" + o.id + "/paid", { method: "POST", body: JSON.stringify({ paid: true }) }).then(pollOrders, syncErr);
});
function save() {}
function load() {}

// Thông báo ra màn hình điện thoại (kể cả khi tắt app) và tiếng chuông
const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let actx = null;
function ding() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    [988, 784, 988, 784].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      const s = t + i * 0.22;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.5, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
      o.start(s); o.stop(s + 0.21);
    });
    if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
  } catch (_) {}
}
document.addEventListener("pointerdown", () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (_) {} }, { once: true });
const bellKey = () => role === "owner" ? "chu" : "ship";
function renderBell() {
  let on = false;
  try { on = canPush && Notification.permission === "granted" && localStorage.getItem("cobich-bell") === bellKey(); } catch (_) {}
  document.querySelectorAll("[data-bell]").forEach(b => { b.classList.toggle("on", on); b.textContent = on ? "🔔 Đã bật thông báo" : "🔔 Bật thông báo"; });
}
const keyBytes = k => Uint8Array.from(atob(k.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - k.length % 4) % 4)), c => c.charCodeAt(0));
async function enableBell() {
  ding();
  if (!role) return;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!canPush) {
    alert(ios ? "Trên iPhone: bấm nút Chia sẻ (ô vuông có mũi tên) rồi chọn “Thêm vào MH chính”. Sau đó mở app từ màn hình chính và bấm chuông lại."
      : "Trình duyệt này chưa nhận được thông báo. Hãy mở link bằng Chrome, chọn “Thêm vào màn hình chính”, rồi bấm chuông lại.");
    return;
  }
  try {
    if ((await Notification.requestPermission()) !== "granted") { alert("Bạn chưa cho phép thông báo. Vào phần Cài đặt của điện thoại, mục Thông báo, để bật cho app này."); return; }
    const reg = await navigator.serviceWorker.register("/sw.js?r=" + bellKey());
    await navigator.serviceWorker.ready;
    const { key } = await api("push/key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await api("push/sub", { method: "POST", body: JSON.stringify({ sub: sub.toJSON() }) });
    try { localStorage.setItem("cobich-bell", bellKey()); } catch (_) {}
    reg.showNotification("Đã bật thông báo", { body: role === "owner" ? "Khách đặt đơn mới, điện thoại sẽ báo và kêu chuông." : "Có đơn soạn xong, điện thoại sẽ báo để đi giao.", icon: "/icon-192.png" });
  } catch (e) { alert("Chưa bật được thông báo: " + (e.message || e)); }
  renderBell();
}
document.addEventListener("click", e => { if (e.target.closest("[data-bell]")) enableBell(); });
// Máy đã bật chuông: đăng ký lại mỗi lần mở để máy chủ luôn có địa chỉ mới nhất
if (canPush) navigator.serviceWorker.getRegistration().then(reg => reg && reg.pushManager.getSubscription()).then(sub => {
  if (sub && pin) api("push/sub", { method: "POST", body: JSON.stringify({ sub: sub.toJSON() }) }).catch(() => {});
}).catch(() => {});
