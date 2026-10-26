// Tài khoản khách: đăng ký bằng số điện thoại + mật khẩu để tích điểm (1 suất đã giao = 1 điểm).
// Đăng nhập rồi thì lần sau tự điền tên, số điện thoại, địa chỉ.
const MEM = "cobich-khach";
function memGet() { try { return JSON.parse(localStorage.getItem(MEM) || "null"); } catch (_) { return null; } }
const memSet = v => { try { if (v) localStorage.setItem(MEM, JSON.stringify(v)); else localStorage.removeItem(MEM); } catch (_) {} };
let guest = false;
const cusApi = (path, opts = {}) => api(path, { ...opts, headers: { "x-cus": memGet()?.token || "" } });
function fillFromMem() {
  const k = memGet(); if (!k?.member) return;
  $("f-name").value = k.name || $("f-name").value; $("f-phone").value = k.phone || $("f-phone").value; $("f-addr").value = k.addr || $("f-addr").value;
}
async function renderMember() {
  const k = memGet(), n = setCount(cart), on = !!k?.member && !!k?.token;
  ["ask", "guest"].forEach(s => $("mem-" + s).hidden = true);
  $("mem-in").hidden = !on; $("member").hidden = !on;
  $("mem-top").hidden = mode !== "khach" || editMode;
  if (!on) { $("mem-top-hi").textContent = "Đăng ký / đăng nhập tích điểm"; $("mem-top-pts").textContent = "›"; return; }
  $("mem-hi").textContent = $("mem-top-hi").textContent = `Chào ${k.name || "bạn"}`;
  $("mem-sub").textContent = n ? `Đơn này được +${n} điểm khi giao xong.` : "Mỗi suất cơm = 1 điểm, dùng đổi quà tri ân của quán.";
  try {
    const d = (await cusApi("cus/me")).me;
    memSet({ ...k, name: d.name, phone: d.phone, addr: d.addr, points: d.points });
    $("mem-pts").textContent = $("mem-top-pts").textContent = `${d.points} điểm`;
  } catch (e) {
    if (e.status === 401) { memSet({ ...k, member: false, token: "" }); return renderMember(); }
    $("mem-pts").textContent = $("mem-top-pts").textContent = k.points != null ? `${k.points} điểm` : "";
  }
}
// Hộp đăng ký / đăng nhập / tài khoản
let acctMode = "reg";
function openAcct(m, pre = {}) {
  const k = memGet();
  acctMode = k?.member && k?.token ? "me" : m || "reg";
  $("acct-err").hidden = true; $("a-pass").value = $("a-pass2").value = "";
  $("a-uname").value = pre.name ?? k?.name ?? $("f-name").value ?? "";
  $("a-phone").value = pre.phone ?? k?.phone ?? $("f-phone").value ?? "";
  $("a-addr").value = pre.addr ?? k?.addr ?? $("f-addr").value ?? "";
  renderAcct(); $("acct").hidden = false;
}
function renderAcct() {
  const me = acctMode === "me";
  document.querySelectorAll("#acct-tabs [data-acct]").forEach(b => { b.setAttribute("aria-pressed", b.dataset.acct === acctMode); b.hidden = me ? b.dataset.acct !== "me" : b.dataset.acct === "me"; });
  document.querySelectorAll("#acct-form .field, #acct-form .acct-me").forEach(el => { el.hidden = !el.classList.contains("acct-" + acctMode); });
  $("acct-title").textContent = me ? "Tài khoản của bạn" : acctMode === "login" ? "Đăng nhập tích điểm" : "Đăng ký tích điểm";
  $("acct-sub").hidden = me;
  $("acct-go").textContent = me ? "Lưu thông tin" : acctMode === "login" ? "Đăng nhập" : "Đăng ký";
  if (me) { const k = memGet(); $("acct-pts").textContent = `Tài khoản ${k.phone} · ${k.points ?? 0} điểm`; }
}
$("acct-tabs").addEventListener("click", e => { const b = e.target.closest("[data-acct]"); if (b) { acctMode = b.dataset.acct; $("acct-err").hidden = true; renderAcct(); } });
$("acct-close").onclick = () => { $("acct").hidden = true; };
$("acct").addEventListener("click", e => { if (e.target.id === "acct") $("acct").hidden = true; });
$("acct-out").onclick = () => { memSet(null); $("acct").hidden = true; renderMember(); };
$("acct-form").addEventListener("submit", async e => {
  e.preventDefault();
  const err = t => { $("acct-err").textContent = t; $("acct-err").hidden = false; };
  const name = $("a-uname").value.trim(), phone = $("a-phone").value.trim(), pass = $("a-pass").value, addr = $("a-addr").value.trim();
  if (acctMode === "reg") {
    if (!name) return err("Vui lòng nhập họ tên.");
    if (!/^\+?\d{9,12}$/.test(phone.replace(/[\s.\-()]/g, ""))) return err("Số điện thoại chưa đúng.");
    if (pass.length < 6) return err("Mật khẩu từ 6 ký tự trở lên.");
    if (pass !== $("a-pass2").value) return err("Hai mật khẩu chưa giống nhau.");
    if (addr.length < 8) return err("Vui lòng nhập địa chỉ đầy đủ: số nhà, ngõ, đường, phường.");
  }
  $("acct-go").disabled = true;
  try {
    let d;
    if (acctMode === "me") d = await cusApi("cus/me", { method: "PUT", body: JSON.stringify({ name, addr }) });
    else d = await api("cus/" + (acctMode === "reg" ? "register" : "login"), { method: "POST", body: JSON.stringify({ name, phone, pass, addr }) });
    const k = memGet() || {};
    memSet({ ...k, member: true, token: d.token || k.token, name: d.me.name, phone: d.me.phone, addr: d.me.addr, points: d.me.points });
    fillFromMem(); $("acct").hidden = true; renderMember();
    if (!$("view-done").hidden && lastOrder) showMemDone(lastOrder, true);
  } catch (ex) { err(ex.message); }
  finally { $("acct-go").disabled = false; }
});
$("mem-top").onclick = () => openAcct("reg");
$("m-out").onclick = () => openAcct("me");
$("go").addEventListener("click", renderMember);
fillFromMem();
renderMember();

// Sau khi đặt xong: mời đăng ký tích điểm, điền sẵn tên, số điện thoại, địa chỉ của đơn
let lastOrder = null;
function showMemDone(o, justJoined) {
  lastOrder = o;
  const on = !!memGet()?.member;
  $("mem-done").hidden = on;
  $("mem-done-msg").hidden = !on;
  if (on) $("mem-done-msg").textContent = (justJoined ? "Đăng ký xong! " : "") + `Đơn này được +${setCount(o)} điểm khi giao xong.`;
}
$("mem-done").onclick = () => { const o = lastOrder || {}; openAcct("reg", { name: o.name, phone: o.phone, addr: o.addr }); };
