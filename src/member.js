// Tài khoản khách: đăng ký bằng số điện thoại + mật khẩu để tích điểm (1 suất đã giao = 1 điểm).
// Đăng nhập rồi thì lần sau tự điền tên, số điện thoại, địa chỉ.
const MEM = "cobich-khach";
function memGet() { try { return JSON.parse(localStorage.getItem(MEM) || "null"); } catch (_) { return null; } }
const memSet = v => { try { if (v) localStorage.setItem(MEM, JSON.stringify(v)); else localStorage.removeItem(MEM); } catch (_) {} };
let guest = false;
const cusApi = (path, opts = {}) => api(path, { ...opts, headers: { "x-cus": memGet()?.token || "" } });
function fillFromMem() {
  const k = memGet(); if (!k?.member) return;
  if (k.geo) setPin("f", k.geo);
  $("f-name").value = k.name || $("f-name").value; $("f-phone").value = k.phone || $("f-phone").value; $("f-addr").value = k.addr || $("f-addr").value;
}
async function renderMember() {
  const k = memGet(), n = setCount(cart), on = !!k?.member && !!k?.token;
  ["ask", "guest"].forEach(s => $("mem-" + s).hidden = true);
  $("mem-in").hidden = !on; $("member").hidden = !on;
  $("mem-top").hidden = mode !== "khach" || editMode;
  $("mem-top").classList.toggle("join", !on);
  if (!on) { $("mem-top-hi").innerHTML = "⭐ <b class=\"blink-soft\">ĐĂNG KÝ / ĐĂNG NHẬP</b> để tích điểm"; $("mem-top-pts").textContent = "Bấm vào đây ›"; return; }
  $("mem-hi").textContent = $("mem-top-hi").textContent = `Chào ${k.name || "bạn"}`;
  $("mem-sub").textContent = n ? `Đơn này được +${n} điểm khi giao xong.` : "Mỗi suất cơm = 1 điểm, dùng đổi quà tri ân của quán.";
  try {
    const d = (await cusApi("cus/me")).me;
    memSet({ ...k, name: d.name, phone: d.phone, addr: d.addr, avatar: d.avatar || "", gender: d.gender, geo: d.geo, points: d.points, code: d.code, invites: d.invites, refLeft: d.refLeft });
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
  document.querySelectorAll('[name="a-gender"]').forEach(x => { x.checked = x.value === k?.gender; });
  setPin("a", k?.member ? k.geo : pinGeo.f);
  renderAcct(); $("acct").hidden = false;
}
function renderAcct() {
  const me = acctMode === "me";
  document.querySelectorAll("#acct-tabs [data-acct]").forEach(b => { b.setAttribute("aria-pressed", b.dataset.acct === acctMode); b.hidden = me ? b.dataset.acct !== "me" : b.dataset.acct === "me"; });
  document.querySelectorAll("#acct-form .field, #acct-form .acct-me").forEach(el => { el.hidden = !el.classList.contains("acct-" + acctMode); });
  $("acct-title").textContent = me ? "Tài khoản của bạn" : acctMode === "login" ? "Đăng nhập tích điểm" : "Đăng ký tích điểm";
  $("acct-sub").hidden = me;
  $("acct-go").textContent = me ? "Lưu thông tin" : acctMode === "login" ? "ĐĂNG NHẬP" : "ĐĂNG KÝ";
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
  const gender = document.querySelector('[name="a-gender"]:checked')?.value || "", geo = pinGeo.a;
  const name = $("a-uname").value.trim(), phone = $("a-phone").value.trim(), pass = $("a-pass").value, addr = $("a-addr").value.trim();
  if (acctMode === "reg") {
    if (!gender) return err("Vui lòng chọn giới tính.");
    if (!/^\+?\d{9,12}$/.test(phone.replace(/[\s.\-()]/g, ""))) return err("Số điện thoại chưa đúng.");
    if (pass.length < 6) return err("Mật khẩu từ 6 ký tự trở lên.");
    if (pass !== $("a-pass2").value) return err("Hai mật khẩu chưa giống nhau.");
    if (addr.length < 8) return err("Vui lòng nhập địa chỉ đầy đủ: số nhà, ngõ, đường, phường.");
  }
  $("acct-go").disabled = true;
  try {
    let d;
    if (acctMode === "me") d = await cusApi("cus/me", { method: "PUT", body: JSON.stringify({ name, addr, gender, geo }) });
    else d = await api("cus/" + (acctMode === "reg" ? "register" : "login"), { method: "POST", body: JSON.stringify({ phone, pass, addr, gender, geo, ref: refCode() }) });
    if (acctMode === "reg") try { localStorage.removeItem("cobich-ref"); } catch (_) {}
    const k = memGet() || {};
    memSet({ ...k, member: true, token: d.token || k.token, name: d.me.name, phone: d.me.phone, addr: d.me.addr, avatar: d.me.avatar || "", gender: d.me.gender, geo: d.me.geo, points: d.me.points, code: d.me.code, invites: d.me.invites, refLeft: d.me.refLeft });
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
const joinBtns = `<div class="cart-actions"><button type="button" class="btn-main btn-red blink-soft" data-acctgo="reg" style="flex:1">ĐĂNG KÝ</button><button type="button" class="btn-ghost blink-soft" data-acctgo="login" style="flex:1;font-weight:700">ĐĂNG NHẬP</button></div>`;
async function renderPts() {
  const box = $("pts-body");
  if (!loggedIn()) {
    box.innerHTML = `<p class="sub" style="margin:0">Mỗi suất cơm giao xong được <b>1 điểm</b>. Điểm dùng đổi quà tri ân của quán. Đăng ký bằng số điện thoại để bắt đầu tích điểm.</p>${joinBtns}`;
    return;
  }
  const show = d => { box.innerHTML = `<div class="me-card"><div class="avatar">${avHTML(memGet())}</div><div><b>${esc(d.name || "")}</b><div class="pts-big">${d.points ?? 0}</div><small class="sub">điểm đã tích</small></div></div>
    ${d.pending ? `<p class="sub" style="margin:0">Sắp được cộng thêm <b>${d.pending} điểm</b> khi các đơn đang làm giao xong.</p>` : ""}
    <p class="sub" style="margin:0">Mỗi suất cơm giao xong = 1 điểm.${PROMO.free.on ? "" : " Quà tri ân quán sẽ báo sau."}${d.orders != null ? ` Bạn đã đặt ${d.orders} đơn.` : ""}</p>`; };
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
      <div class="field"><span class="lbl">Giới tính</span><div class="radios"><label><input type="radio" name="me-gender" value="nam"${k.gender === "nam" ? " checked" : ""}> Anh (nam)</label><label><input type="radio" name="me-gender" value="nu"${k.gender === "nu" ? " checked" : ""}> Chị (nữ)</label></div></div>
      <div class="field"><label for="me-addr">Địa chỉ cụ thể</label><input id="me-addr" autocomplete="street-address" value="${esc(k.addr || "")}" placeholder="Số nhà, ngõ/ngách, đường, phường"><button type="button" class="btn-ghost pin-btn" data-mappin="s">📍 Ghim nhà trên bản đồ</button><small class="geo-st" id="s-geo-st"></small></div>
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
  setPin("s", k.geo);
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
      const d = (await cusApi("cus/me", { method: "PUT", body: JSON.stringify({ name, addr, phone, pass: $("me-pass").value, gender: document.querySelector('[name="me-gender"]:checked')?.value || "", geo: pinGeo.s }) })).me;
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
    $("fb-text").value = ""; setTimeout(() => { $("fb-wrap").open = false; $("fb-ok").textContent = ""; }, 4000); $("fb-ok").textContent = "Cảm ơn quý khách đã góp ý! Quán sẽ đọc và sửa.";
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

// Ghim nhà trên bản đồ (OpenStreetMap). a = đăng ký, s = cài đặt, f = đặt cơm
const pinGeo = { a: null, s: null, f: null };
const SHOP = [22.5006, 103.9668];
function setPin(w, g) {
  pinGeo[w] = g || null;
  const st = $(w + "-geo-st"); if (st) st.textContent = g ? "✓ Đã ghim vị trí trên bản đồ" : "";
  const b = document.querySelector(`[data-mappin="${w}"]`); if (b) b.textContent = g ? "📍 Sửa vị trí ghim" : "📍 Ghim nhà trên bản đồ";
}
let leafletP = null, lmap = null, lmark = null, mapFor = "", mapPick = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return leafletP ||= new Promise((ok, no) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/leaflet/leaflet.css"; document.head.append(css);
    const js = document.createElement("script"); js.src = "/leaflet/leaflet.js";
    js.onload = ok; js.onerror = () => { leafletP = null; no(new Error("map")); }; document.head.append(js);
  });
}
function placePin(lat, lng) {
  mapPick = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  if (lmap) { lmark ? lmark.setLatLng([lat, lng]) : (lmark = L.marker([lat, lng]).addTo(lmap)); }
  $("map-ok").disabled = false; $("map-st").textContent = "Đã chọn vị trí. Bấm “Xong” để lưu.";
}
async function openMap(w) {
  mapFor = w; mapPick = pinGeo[w]; $("map-ok").disabled = !mapPick; $("map-st").textContent = "";
  $("mapbox").hidden = false;
  try { await loadLeaflet(); } catch (_) { $("map-st").textContent = "Không tải được bản đồ. Bạn bấm “Vị trí của tôi” khi đang ở nhà, hoặc ghi rõ địa chỉ."; return; }
  const c = mapPick ? [mapPick.lat, mapPick.lng] : SHOP;
  if (!lmap) {
    lmap = L.map("map").setView(c, 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(lmap);
    lmap.on("click", e => placePin(e.latlng.lat, e.latlng.lng));
  } else lmap.setView(c, 17);
  if (lmark) { lmark.remove(); lmark = null; }
  if (mapPick) lmark = L.marker(c).addTo(lmap);
  setTimeout(() => lmap.invalidateSize(), 50);
}
$("map-me").onclick = () => {
  if (!navigator.geolocation) { $("map-st").textContent = "Máy này không cho lấy vị trí."; return; }
  $("map-st").textContent = "Đang lấy vị trí…";
  navigator.geolocation.getCurrentPosition(p => { placePin(p.coords.latitude, p.coords.longitude); if (lmap) lmap.setView([p.coords.latitude, p.coords.longitude], 18); },
    () => { $("map-st").textContent = "Chưa lấy được vị trí. Bạn cho phép vị trí, hoặc bấm vào bản đồ."; }, { enableHighAccuracy: true, timeout: 10000 });
};
$("map-ok").onclick = () => {
  if (!mapPick) return;
  setPin(mapFor, mapPick);
  if (mapFor === "f") pinGeo.f = mapPick;
  $("mapbox").hidden = true;
};
$("map-close").onclick = () => { $("mapbox").hidden = true; };
document.addEventListener("click", e => { const b = e.target.closest("[data-mappin]"); if (b) openMap(b.dataset.mappin); });

// Mở app: làm mờ trang, chào khách và mời chọn suất 35k / 40k / 50k
function showWelcome() {
  const k = memGet(), h = new Date().getHours();
  const who = k?.member && k.name ? k.name : "bạn";
  $("w-hi").textContent = `Chào ${who}! 👋`;
  $("w-sub").textContent = `Cô Bích Quán chúc ${who === "bạn" ? "bạn" : "quý khách"} ${h < 11 ? "một ngày tốt lành và bữa trưa" : h < 15 ? "bữa trưa" : "bữa tối"} thật ngon miệng.`;
  $("w-tiers").innerHTML = TIERS.map((t, i) => `<button type="button" class="tier" data-tier="${i}"><b>${k2(t.price)}</b><small>${t.picks} món</small></button>`).join("");
  if (refCode() && !k?.member) $("w-sub").textContent += " Bạn được bạn bè mời dùng app, bấm Tích điểm để đăng ký nhé.";
  $("welcome").hidden = false;
}
const k2 = v => Math.round(v / 1000) + "k";
$("w-skip").onclick = () => { $("welcome").hidden = true; };

// ---------- Chương trình khuyến mãi ----------
let PROMO = { gift: { on: false, text: "" }, free: { on: false, points: 10 }, ref: { on: false, amount: 5000 } };
const promoUse = { free: false, ref: false };
// Khách mở link mời ?ref=MÃ: nhớ mã để gửi khi đăng ký
try { const rc = new URLSearchParams(location.search).get("ref"); if (rc) localStorage.setItem("cobich-ref", rc.toUpperCase().slice(0, 12)); } catch (_) {}
const refCode = () => { try { return localStorage.getItem("cobich-ref") || ""; } catch (_) { return ""; } };
const inviteUrl = code => location.origin + "/?ref=" + code;
function renderPromo() {
  const k = memGet(), items = [];
  if (PROMO.gift.on && PROMO.gift.text) items.push(`<button type="button" data-nav-go="pts">🎁 ${esc(PROMO.gift.text)}</button>`);
  if (PROMO.free.on) items.push(`<button type="button" data-nav-go="pts">⭐ Tích đủ ${PROMO.free.points} điểm đổi 1 suất cơm miễn phí${k?.member ? ` · bạn có ${k.points ?? 0} điểm` : ""}</button>`);
  if (PROMO.ref.on) items.push(`<button type="button" data-nav-go="pts">🤝 Mời bạn dùng app: mỗi bạn đăng ký, bạn được giảm ${fmt(PROMO.ref.amount)}</button>`);
  $("promo-bar").innerHTML = items.join(""); $("promo-bar").hidden = !items.length || mode !== "khach" || editMode;
  // ô chủ quán (không ghi đè khi đang gõ)
  const ae = document.activeElement;
  [["gift"], ["free"], ["ref"]].forEach(([x]) => $("pr-" + x).setAttribute("aria-pressed", !!PROMO[x].on));
  if (ae !== $("pr-gift-text")) $("pr-gift-text").value = PROMO.gift.text;
  if (ae !== $("pr-free-pts")) $("pr-free-pts").value = PROMO.free.points;
  if (ae !== $("pr-ref-amt")) $("pr-ref-amt").value = PROMO.ref.amount;
  if (!$("view-pts").hidden && typeof renderPts === "function") renderPtsExtra();
}
async function savePromo() {
  try { PROMO = (await api("promo", { method: "PUT", body: JSON.stringify(PROMO) })).promo; $("promo-ok").textContent = "Đã lưu, khách thấy ngay."; renderPromo(); }
  catch (e) { $("promo-ok").textContent = "Chưa lưu được: " + e.message; }
}
["gift", "free", "ref"].forEach(x => { $("pr-" + x).onclick = () => { PROMO[x].on = !PROMO[x].on; savePromo(); }; });
$("pr-gift-text").onchange = () => { PROMO.gift.text = $("pr-gift-text").value.trim(); savePromo(); };
$("pr-free-pts").onchange = () => { PROMO.free.points = Math.max(1, parseInt($("pr-free-pts").value, 10) || 10); savePromo(); };
$("pr-ref-amt").onchange = () => { PROMO.ref.amount = Math.max(0, Math.round(parseFloat($("pr-ref-amt").value) || 0)); savePromo(); };
document.addEventListener("click", e => { const b = e.target.closest("[data-nav-go]"); if (b) showKhach(b.dataset.navGo); });

// Trang Tích điểm: tiến độ đổi suất miễn phí + mời bạn
function renderPtsExtra() {
  const k = memGet(); let box = $("pts-extra");
  if (!box) { box = document.createElement("div"); box.id = "pts-extra"; box.style.cssText = "display:grid;gap:12px"; $("view-pts").append(box); }
  if (!k?.member || !k?.token) { box.innerHTML = ""; return; }
  const parts = [];
  if (PROMO.gift.on && PROMO.gift.text) parts.push(`<div class="member">🎁 <b>Quà tặng:</b> ${esc(PROMO.gift.text)}</div>`);
  if (PROMO.free.on) {
    const pts = k.points ?? 0, need = PROMO.free.points, pct = Math.min(100, Math.round(pts / need * 100));
    parts.push(`<div class="member" style="display:grid;gap:6px"><b>⭐ Đổi ${need} điểm lấy 1 suất miễn phí</b>
      <div class="live"><div class="bar"><i style="width:${pct}%"></i></div></div>
      <span class="sub" style="margin:0">${pts >= need ? "Bạn đã đủ điểm! Khi thanh toán, tick “Đổi điểm” để được miễn phí 1 suất." : `Còn ${need - pts} điểm nữa (${pts}/${need}).`}</span></div>`);
  }
  if (PROMO.ref.on || (k.invites || []).length) {
    const inv = k.invites || [], url = k.code ? inviteUrl(k.code) : "";
    parts.push(`<div class="member" style="display:grid;gap:8px"><b>🤝 Mời bạn dùng app</b>
      <span class="sub" style="margin:0">Gửi link này cho bạn bè. Bạn bè đăng ký tài khoản qua link, bạn được 1 phiếu giảm ${fmt(PROMO.ref.amount)} cho 1 đơn.</span>
      <div class="inv-link"><input id="inv-url" readonly value="${esc(url)}" aria-label="Link mời"><button type="button" class="btn-sm" id="inv-copy">Sao chép</button></div>
      <button type="button" class="btn-main" id="inv-share">Chia sẻ cho bạn bè</button>
      <b style="margin-top:4px">Bạn bè đã nhận lời mời: ${inv.length}</b>
      ${inv.length ? `<ul style="margin:0;padding-left:18px">${inv.map(x => `<li>${esc(x.name || "Bạn mới")} · ${esc(x.phone)} · đăng ký ${new Date(x.at).toLocaleDateString("vi-VN")}</li>`).join("")}</ul>` : `<span class="sub" style="margin:0">Chưa có ai. Khi bạn bè đăng ký qua link của bạn, tên họ hiện ở đây.</span>`}
      <span style="color:var(--leaf);font-weight:600">Phiếu giảm còn dùng được: ${k.refLeft ?? 0}</span></div>`);
  }
  box.innerHTML = parts.join("");
  const copy = $("inv-copy"), share = $("inv-share");
  if (copy) copy.onclick = () => { const u = $("inv-url"); try { navigator.clipboard.writeText(u.value).then(() => copy.textContent = "Đã chép", () => { u.select(); }); } catch (_) { u.select(); } };
  if (share) share.onclick = () => {
    const url = $("inv-url").value, text = "Đặt cơm Cô Bích Quán ngon, giao tận nơi. Đăng ký qua link này nhé:";
    if (navigator.share) navigator.share({ title: "Cơm Cô Bích", text, url }).catch(() => {});
    else location.href = "https://zalo.me/share?url=" + encodeURIComponent(url);
  };
}
const _renderPts = renderPts;
renderPts = async function () { await _renderPts(); renderPtsExtra(); };

// Thanh toán: chọn dùng ưu đãi
function promoDiscount() {
  let d = 0; const sets = cart.sets;
  if (promoUse.free && sets.length) d += Math.min(...sets.map(s => setPrice(s)));
  if (promoUse.ref) d += PROMO.ref.amount;
  return Math.min(d, orderTotal(cart));
}
function renderUse() {
  const k = memGet(), on = !!(k?.member && k?.token);
  const canFree = PROMO.free.on && on && (k.points ?? 0) >= PROMO.free.points && cart.sets.length;
  const canRef = PROMO.ref.on && on && (k.refLeft ?? 0) > 0;
  if (!canFree) promoUse.free = false; if (!canRef) promoUse.ref = false;
  const rows = [];
  if (canFree) rows.push(`<label><input type="checkbox" data-use="free"${promoUse.free ? " checked" : ""}> <span>Đổi ${PROMO.free.points} điểm: miễn phí 1 suất (−${fmt(Math.min(...cart.sets.map(s => setPrice(s))))})</span></label>`);
  if (canRef) rows.push(`<label><input type="checkbox" data-use="ref"${promoUse.ref ? " checked" : ""}> <span>Dùng 1 phiếu mời bạn (−${fmt(PROMO.ref.amount)}), còn ${k.refLeft} phiếu</span></label>`);
  if (!on && (PROMO.free.on || PROMO.ref.on)) rows.push(`<span class="sub" style="margin:0">Có ưu đãi cho khách có tài khoản. <button type="button" class="linkish" data-acctgo="login" style="padding:0">Đăng nhập</button></span>`);
  $("use-box").innerHTML = rows.length ? `<b>Ưu đãi của bạn</b>${rows.join("")}${promoDiscount() ? `<span style="color:var(--leaf);font-weight:700">Đã giảm ${fmt(promoDiscount())}</span>` : ""}` : "";
  $("use-box").hidden = !rows.length;
  $("total-co").textContent = fmt(Math.max(0, orderTotal(cart) - promoDiscount()));
  if (typeof updateQR === "function") updateQR();
}
document.addEventListener("change", e => { const x = e.target.dataset?.use; if (x) { promoUse[x] = e.target.checked; renderUse(); } });

if (!location.hash && !cart.sets.length && tierIx < 0) showWelcome();

// Báo cáo theo ngày: hôm nay, hôm qua, tuần, tháng hoặc chọn ngày trên lịch
const vnDate = (t = Date.now()) => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
let rpMode = "today";
function rpRange() {
  const now = Date.now(), today = vnDate(now), dow = (new Date(now + 7 * 3600e3).getUTCDay() + 6) % 7;
  if (rpMode === "yest") { const y = vnDate(now - 864e5); return [y, y]; }
  if (rpMode === "week") return [vnDate(now - dow * 864e5), today];
  if (rpMode === "month") return [today.slice(0, 8) + "01", today];
  if (rpMode === "pick") { const f = $("rp-from").value || today, t = $("rp-to").value || f; return f <= t ? [f, t] : [t, f]; }
  return [today, today];
}
const dmy = d => d.split("-").reverse().join("/");
async function loadReport() {
  if (!pin) return;
  const [from, to] = rpRange();
  document.querySelectorAll("#rp-chips [data-rp]").forEach(b => b.setAttribute("aria-pressed", b.dataset.rp === rpMode));
  $("rp-pick").hidden = rpMode !== "pick";
  try {
    const d = await api(`report?from=${from}&to=${to}`);
    $("rp-stats").innerHTML = `<div class="stat"><b>${d.orders}</b><small>đơn hàng</small></div><div class="stat"><b>${d.sets}</b><small>suất cơm</small></div><div class="stat"><b>${d.cust}</b><small>khách</small></div><div class="stat"><b>${fmt(d.money)}</b><small>tiền bán</small></div>`;
    $("rp-days").innerHTML = `<p class="sub" style="margin:4px 0">${from === to ? "Ngày " + dmy(from) : `Từ ${dmy(from)} đến ${dmy(to)}`}</p>` + (d.days.length > 1 ? d.days.map(x => `<div class="promo-row" style="padding:8px 0"><span>${dmy(x.day)}</span><span>${x.orders} đơn · ${x.sets} suất · <b>${fmt(x.money)}</b></span></div>`).join("") : "");
  } catch (e) { $("rp-days").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
$("rp-chips").addEventListener("click", e => { const b = e.target.closest("[data-rp]"); if (!b) return; rpMode = b.dataset.rp; if (rpMode === "pick" && !$("rp-from").value) $("rp-from").value = $("rp-to").value = vnDate(); loadReport(); });
$("rp-from").onchange = $("rp-to").onchange = loadReport;
const _loadFeedback = loadFeedback;
loadFeedback = async function () { loadReport(); return _loadFeedback(); };

// Khách huỷ đơn trong 5 phút sau khi đặt
let cancelled = [];
const LAST = "cobich-last";
function saveLastOrder(r) { try { const my = JSON.parse(localStorage.getItem("cobich-my") || "[]"); my.unshift({ id: r.id, key: r.ckey }); localStorage.setItem("cobich-my", JSON.stringify(my.slice(0, 20))); } catch (_) {} try { localStorage.setItem(LAST, JSON.stringify({ id: r.id, key: r.ckey, no: r.no, at: r.at || Date.now() })); } catch (_) {} renderCancel(); }
function lastOrderGet() { try { return JSON.parse(localStorage.getItem(LAST) || "null"); } catch (_) { return null; } }
let cancelTimer = null, cancelMsg = "";
function renderCancel() {
  const L = lastOrderGet(), box = $("cancel-bar");
  const left = L ? 5 * 60e3 - (Date.now() - L.at) : 0;
  if (cancelMsg) { box.innerHTML = `<span>${cancelMsg}</span>`; box.hidden = false; return; }
  if (!L || left <= 0 || mode !== "khach" || editMode) { box.hidden = true; if (L && left <= 0) try { localStorage.removeItem(LAST); } catch (_) {} clearInterval(cancelTimer); cancelTimer = null; return; }
  const s = Math.ceil(left / 1000), mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, "0");
  box.innerHTML = `<span>Đơn #${L.no} vừa đặt. Muốn huỷ thì bấm trong <b>${mm}:${ss}</b></span><button type="button" id="cancel-go">Huỷ đơn</button>`;
  box.hidden = false;
  if (!cancelTimer) cancelTimer = setInterval(renderCancel, 1000);
}
document.addEventListener("click", async e => {
  if (e.target.id !== "cancel-go") return;
  const L = lastOrderGet(); if (!L) return;
  if (!confirm(`Huỷ đơn #${L.no}?`)) return;
  try {
    await api(`orders/${L.id}/cancel`, { method: "POST", body: JSON.stringify({ key: L.key }) });
    cancelMsg = `Đã huỷ đơn #${L.no}. Quán đã nhận được.`;
  } catch (ex) { cancelMsg = esc(ex.message); }
  try { localStorage.removeItem(LAST); } catch (_) {}
  clearInterval(cancelTimer); cancelTimer = null; renderCancel();
  setTimeout(() => { cancelMsg = ""; renderCancel(); }, 8000);
  pollMenu();
});
renderCancel();

// Trang Đơn hàng của khách: xem đơn đang ở bước nào
const TRACK = [["moi", "Quán đã nhận"], ["xong", "Đã soạn xong"], ["nau", "Shipper đang giao"], ["giao", "Đã giao"]];
const TRACK_NOW = { moi: "Quán đã nhận đơn, đang soạn cơm", xong: "Đã soạn xong, chờ shipper lấy", nau: "Shipper đang mang cơm đến bạn", giao: "Đã giao xong. Chúc ngon miệng!", huy: "Đơn đã huỷ" };
let donTimer = null;
async function renderDon() {
  const box = $("don-body");
  let my = []; try { my = JSON.parse(localStorage.getItem("cobich-my") || "[]"); } catch (_) {}
  if (!box.innerHTML) box.innerHTML = `<p class="sub">Đang tải…</p>`;
  try {
    const { orders: list } = await cusApi("track", { method: "POST", body: JSON.stringify({ items: my }) });
    box.innerHTML = list.length ? list.map(o => {
      const ix = TRACK.findIndex(([k]) => k === o.st);
      return `<div class="track${o.st === "huy" ? " huy" : ""}"><div class="hd"><span>Đơn #${o.no} · ${o.day === vnDate() ? "hôm nay" : dmy(o.day)}</span><span>${fmt(o.total || 0)}</span></div>
        <span class="sub" style="margin:0">${o.sets} suất${o.drinks ? ` · ${o.drinks} nước` : ""} · nhận ${/^\d/.test(o.time) ? "lúc " + esc(o.time) : "sớm nhất"}</span>
        ${o.st === "huy" ? "" : `<div class="steps">${TRACK.map(([, l], i) => `<span class="${i <= ix ? "on" : ""}">${l}</span>`).join("")}</div>`}
        <span class="now">${TRACK_NOW[o.st] || ""}</span></div>`;
    }).join("") : `<p class="sub" style="margin:0">Bạn chưa có đơn nào. Bấm “+ Chọn món” để đặt cơm nhé.</p>`;
  } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  clearTimeout(donTimer);
  if (!$("view-don").hidden) donTimer = setTimeout(renderDon, 15000);
}
