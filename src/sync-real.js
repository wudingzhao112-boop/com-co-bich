// Bản thật: đơn và món lưu trên máy chủ quán (Cloudflare). Khách đặt không cần đăng nhập, chủ quán và shipper vào bằng mã PIN.
const KEY = "cobich-pin", DAY = "";
let db = null, role = null, pin = "", soldSrv = {}, menuReady = false, menuSig = "", menuQ = Promise.resolve();
const removed = new Set();
try { pin = localStorage.getItem(KEY) || ""; } catch (_) {}
const menuState = () => ({ stock: { ...stock }, lastQty: { ...lastQty }, tiers: TIERS.map(t => ({ ...t })), today: [...todaySet],
  prices: Object.fromEntries(MENU.filter(m => m.price).map(m => [m.id, m.price])),
  added: MENU.filter(m => m.added).map(({ id, cat, name, price }) => ({ id, cat, name, price })), removed: [...removed] });
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
function pushOrder(o) { api("orders/" + o.id, { method: "POST", body: JSON.stringify({ st: o.st }) }).then(pollOrders, syncErr); }
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
  for (const [id, v] of Object.entries(imgs || {})) if (byId[id]) byId[id].img = "/api/img/" + id + "?v=" + v;
}
async function pollMenu() {
  if (mode === "khach" && editMode) return;
  const ae = document.activeElement;
  try {
    const d = await api("menu");
    soldSrv = d.sold || {};
    if (d.menu && !(ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && editMode)) applyMenu(d.menu, d.imgs);
    else if (d.imgs) for (const [id, v] of Object.entries(d.imgs)) if (byId[id]) byId[id].img = "/api/img/" + id + "?v=" + v;
    if (!menuReady) { menuReady = true; menuSig = d.menu ? JSON.stringify(menuState()) : ""; }
    render();
  } catch (e) { syncErr(e); }
}
async function pollOrders() {
  if (!role) return;
  try { const d = await api("orders"); orders = d.orders; render(); }
  catch (e) { if (e.status === 401) { role = null; route(); } else syncErr(e); }
}
async function placeOrder(o) {
  try { return { ok: true, ...(await api("orders", { method: "POST", body: JSON.stringify(o) })) }; }
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
