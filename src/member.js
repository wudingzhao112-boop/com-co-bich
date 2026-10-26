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
    memSet({ ...k, name: d.name, phone: d.phone, addr: d.addr, avatar: d.avatar || "", points: d.points });
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
$("acct-out").onclick = () => { memSet(null); $("acct").hidden = true; renderMember(); refreshMeViews(); };
const refreshMeViews = () => { if (!$("view-pts").hidden) renderPts(); if (!$("view-cai").hidden) renderCai(); };
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
    memSet({ ...k, member: true, token: d.token || k.token, name: d.me.name, phone: d.me.phone, addr: d.me.addr, avatar: d.me.avatar || "", points: d.me.points });
    fillFromMem(); $("acct").hidden = true; renderMember(); refreshMeViews();
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

// Thanh menu dưới: trang Tích điểm và Cài đặt
const loggedIn = () => { const k = memGet(); return !!(k?.member && k?.token); };
const avHTML = k => k?.avatar ? `<img src="${esc(k.avatar)}" alt="">` : "👤";
const joinBtns = `<div class="cart-actions"><button type="button" class="btn-main" data-acctgo="reg" style="flex:1">Đăng ký</button><button type="button" class="btn-ghost" data-acctgo="login" style="flex:1">Đăng nhập</button></div>`;
async function renderPts() {
  const box = $("pts-body");
  if (!loggedIn()) {
    box.innerHTML = `<p class="sub" style="margin:0">Mỗi suất cơm giao xong được <b>1 điểm</b>. Điểm dùng đổi quà tri ân của quán. Đăng ký bằng số điện thoại để bắt đầu tích điểm.</p>${joinBtns}`;
    return;
  }
  const show = d => { box.innerHTML = `<div class="me-card"><div class="avatar">${avHTML(memGet())}</div><div><b>${esc(d.name || "")}</b><div class="pts-big">${d.points ?? 0}</div><small class="sub">điểm đã tích</small></div></div>
    ${d.pending ? `<p class="sub" style="margin:0">Sắp được cộng thêm <b>${d.pending} điểm</b> khi các đơn đang làm giao xong.</p>` : ""}
    <p class="sub" style="margin:0">Mỗi suất cơm giao xong = 1 điểm. Quà tri ân quán sẽ báo sau.${d.orders != null ? ` Bạn đã đặt ${d.orders} đơn.` : ""}</p>`; };
  show(memGet());
  try { const d = (await cusApi("cus/me")).me; memSet({ ...memGet(), ...d }); show(d); } catch (e) { if (e.status === 401) { memSet({ ...memGet(), member: false, token: "" }); renderPts(); } }
}
function renderCai() {
  const box = $("cai-body");
  if (!loggedIn()) {
    box.innerHTML = `<p class="sub" style="margin:0">Đăng nhập để sửa tên, ảnh, địa chỉ, số điện thoại và mật khẩu. Lần sau đặt cơm không phải gõ lại.</p>${joinBtns}`;
    return;
  }
  const k = memGet();
  box.innerHTML = `<div class="me-card"><div class="avatar" id="av">${avHTML(k)}</div><div style="display:grid;gap:2px"><b style="font-size:18px">${esc(k.name || "")}</b><small class="sub">${esc(k.phone || "")}</small>
      <button type="button" class="btn-sm" id="av-pick" style="justify-self:start">Đổi ảnh đại diện</button><input type="file" id="av-file" accept="image/*" hidden></div></div>
    <form id="me-form" novalidate style="display:grid;gap:10px">
      <div class="field"><label for="me-name">Họ tên</label><input id="me-name" autocomplete="name" value="${esc(k.name || "")}"></div>
      <div class="field"><label for="me-addr">Địa chỉ giao cơm</label><input id="me-addr" autocomplete="street-address" value="${esc(k.addr || "")}" placeholder="Số nhà, ngõ/ngách, đường, phường"></div>
      <div class="field"><label for="me-phone">Số điện thoại (tên đăng nhập)</label><input id="me-phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(k.phone || "")}"></div>
      <div class="field" id="me-pass-w" hidden><label for="me-pass">Mật khẩu hiện tại (để đổi số điện thoại)</label><input id="me-pass" type="password" autocomplete="current-password"></div>
      <p class="err" id="me-err" hidden></p><p class="toast" id="me-ok" aria-live="polite"></p>
      <button type="submit" class="btn-main">Lưu thông tin</button>
    </form>
    <details class="member"><summary style="cursor:pointer;font-weight:600">Đổi mật khẩu</summary>
      <form id="pw-form" novalidate style="display:grid;gap:10px;margin-top:10px">
        <div class="field"><label for="pw-old">Mật khẩu cũ</label><input id="pw-old" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pw-new">Mật khẩu mới</label><input id="pw-new" type="password" autocomplete="new-password" placeholder="Từ 6 ký tự trở lên"></div>
        <div class="field"><label for="pw-new2">Nhập lại mật khẩu mới</label><input id="pw-new2" type="password" autocomplete="new-password"></div>
        <p class="err" id="pw-err" hidden></p><p class="toast" id="pw-ok" aria-live="polite"></p>
        <button type="submit" class="btn-main">Đổi mật khẩu</button>
      </form>
    </details>
    <button type="button" class="btn-ghost" id="cai-out">Đăng xuất</button>`;
  const phoneChanged = () => phoneNorm($("me-phone").value) !== phoneNorm(k.phone);
  $("me-phone").oninput = () => { $("me-pass-w").hidden = !phoneChanged(); };
  $("av-pick").onclick = () => $("av-file").click();
  $("av-file").onchange = async () => {
    const f = $("av-file").files[0]; if (!f) return;
    try {
      const avatar = await shrinkImg(f, 192);
      const d = (await cusApi("cus/me", { method: "PUT", body: JSON.stringify({ avatar }) })).me;
      memSet({ ...memGet(), ...d }); renderCai(); renderMember();
    } catch (ex) { $("me-err").textContent = ex.message || "Không đổi được ảnh."; $("me-err").hidden = false; }
  };
  $("me-form").onsubmit = async e => {
    e.preventDefault();
    const err = t => { $("me-err").textContent = t; $("me-err").hidden = false; $("me-ok").textContent = ""; };
    $("me-err").hidden = true;
    const name = $("me-name").value.trim(), addr = $("me-addr").value.trim(), phone = $("me-phone").value.trim();
    if (!name) return err("Vui lòng nhập họ tên.");
    if (addr.length < 8) return err("Vui lòng nhập địa chỉ đầy đủ: số nhà, ngõ, đường, phường.");
    if (!/^\+?\d{9,12}$/.test(phone.replace(/[\s.\-()]/g, ""))) return err("Số điện thoại chưa đúng.");
    if (phoneChanged() && !$("me-pass").value) return err("Đổi số điện thoại cần nhập mật khẩu hiện tại.");
    try {
      const d = (await cusApi("cus/me", { method: "PUT", body: JSON.stringify({ name, addr, phone, pass: $("me-pass").value }) })).me;
      memSet({ ...memGet(), ...d }); fillFromMem(); renderMember(); renderCai();
      $("me-ok").textContent = "Đã lưu thông tin.";
    } catch (ex) { err(ex.message); }
  };
  $("pw-form").onsubmit = async e => {
    e.preventDefault();
    const err = t => { $("pw-err").textContent = t; $("pw-err").hidden = false; $("pw-ok").textContent = ""; };
    $("pw-err").hidden = true;
    if ($("pw-new").value.length < 6) return err("Mật khẩu mới từ 6 ký tự trở lên.");
    if ($("pw-new").value !== $("pw-new2").value) return err("Hai mật khẩu mới chưa giống nhau.");
    try {
      await cusApi("cus/pass", { method: "POST", body: JSON.stringify({ old: $("pw-old").value, pass: $("pw-new").value }) });
      $("pw-old").value = $("pw-new").value = $("pw-new2").value = "";
      $("pw-ok").textContent = "Đã đổi mật khẩu.";
    } catch (ex) { err(ex.message); }
  };
  $("cai-out").onclick = () => { memSet(null); renderMember(); renderCai(); };
}
const phoneNorm = p => String(p || "").replace(/[\s.\-()]/g, "").replace(/^\+?84/, "0");
// Thu nhỏ ảnh đại diện thành ảnh vuông nhỏ trước khi gửi lên
function shrinkImg(file, size) {
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error("Không đọc được ảnh này.")); };
    img.src = url;
  });
}
document.addEventListener("click", e => { const b = e.target.closest("[data-acctgo]"); if (b) openAcct(b.dataset.acctgo); });
$("fb-form").addEventListener("submit", async e => {
  e.preventDefault();
  const text = $("fb-text").value.trim();
  $("fb-err").hidden = true; $("fb-ok").textContent = "";
  if (text.length < 3) { $("fb-err").textContent = "Bạn viết góp ý giúp quán nhé."; $("fb-err").hidden = false; return; }
  try {
    await cusApi("feedback", { method: "POST", body: JSON.stringify({ text, name: memGet()?.name || "" }) });
    $("fb-text").value = ""; $("fb-ok").textContent = "Cảm ơn quý khách đã góp ý! Quán sẽ đọc và sửa.";
  } catch (ex) { $("fb-err").textContent = ex.message; $("fb-err").hidden = false; }
});
// Chủ quán xem góp ý (tab Báo cáo)
async function loadFeedback() {
  if (!pin) return;
  try {
    const { items } = await api("feedback");
    $("fb-list").innerHTML = items.length ? items.map(f => `<div class="cart-set"><small class="sub">${new Date(f.at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}${f.name ? " · " + esc(f.name) : ""}${f.phone ? " · " + esc(f.phone) : ""}</small><div>${esc(f.text)}</div></div>`).join("") : `<p class="sub" style="margin:0">Chưa có góp ý.</p>`;
  } catch (_) {}
}
