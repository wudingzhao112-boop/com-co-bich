# Tạo public/index.html từ src/app.html (giao diện) + src/sync-real.js (kết nối máy chủ)
import re, pathlib
here = pathlib.Path(__file__).parent
s = (here / "src/app.html").read_text(encoding="utf8")
def rep(a, b, cnt=1):
    global s
    n = s.count(a)
    if n != cnt: raise SystemExit(f"count {n} for: {a[:90]}")
    s = s.replace(a, b)

# Khung trang đầy đủ (bản demo được bọc khi đăng)
s = ('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
     '<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}[hidden]{display:none!important}</style></head><body>' + s + '</body></html>')

# Đồng bộ thật
a = s.index("// Ba link dùng chung một sổ"); b = s.index("// Hạn giao")
s = s[:a] + (here / "src/sync-real.js").read_text(encoding="utf8") + s[b:]

rep('const cart = { sets: [{ picks: ["suon", "thitkho", "muong", "dua", "bi"], qty: 1 }], extras: {} };', 'const cart = { sets: [], extras: {} };')
# Không có đơn mẫu
a = s.index("let orders = ["); b = s.index('let filter = "all";')
s = s[:a] + "let orders = [];\n" + s[b:]

rep("const sold = id => orders.reduce((s, o) => s + usedBy(o, id), 0);",
    "const sold = id => role ? orders.filter(o => o.st !== \"huy\").reduce((s, o) => s + usedBy(o, id), 0) : (soldSrv[id] || 0);")

# Ghi chú demo -> dòng báo kết nối; thanh 3 link chỉ chủ quán thấy
s = re.sub(r'<p class="demo-note" id="demo-note">.*?</p>', '<p class="demo-note" id="demo-note" hidden><b id="sync-note"></b></p>', s, count=1, flags=re.S)
rep('<nav class="mode three" aria-label="Ba link của quán">', '<nav class="mode three" id="nav" aria-label="Ba link của quán" hidden>')
rep('<a class="tab" href="#chu-mon" id="t-mon">Món hôm nay</a>',
    '<a class="tab" href="#chu-mon" id="t-mon">Món hôm nay</a>\n    <button type="button" class="tab" id="chpin" style="margin-left:auto">Đổi mã</button>\n    <button type="button" class="tab" id="logout">Thoát</button>')
rep('<a class="btn-ghost" href="#chu" id="see-owner" style="text-decoration:none">Xem bên chủ quán (demo)</a>', '')
rep('<h1>Đơn cần giao</h1>', '<div class="order-head"><h1>Đơn cần giao</h1><button type="button" class="tab" id="logout2">Thoát</button></div>')

# Màn hình nhập mã PIN
rep('  <!-- ============ KHÁCH ============ -->', '''  <!-- ============ ĐĂNG NHẬP ============ -->
  <section class="panel" id="login" hidden>
    <h2 id="login-title">Nhập mã PIN</h2>
    <p class="sub" id="login-sub"></p>
    <form id="login-form" style="display:grid;gap:12px">
      <div class="field"><label for="pin1" id="pin1-l">Mã PIN</label><input id="pin1" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12"></div>
      <div class="field" id="pin2-w" hidden><label for="pin2">Mã PIN cho shipper</label><input id="pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="12"></div>
      <p class="err" id="login-err" hidden></p>
      <button type="submit" class="btn-main">Vào</button>
    </form>
  </section>

  <!-- ============ KHÁCH ============ -->''')

# Định tuyến: trang chủ quán, shipper cần mã PIN
rep('''  mode = r === "chu" ? "chu" : r === "shipper" ? "shipper" : "khach";''', '''  mode = r === "chu" ? "chu" : r === "shipper" ? "shipper" : "khach";
  const allowed = r === "khach" || role === "owner" || (role === "ship" && r === "shipper");
  $("nav").hidden = role !== "owner";
  if (!allowed) { showLogin(r); return; }
  $("login").hidden = true;''')

# Đặt đơn: gửi lên máy chủ, chờ số đơn
rep('''  orders.push(o);
  cart.sets = []; cart.extras = {}; save(); pushOrder(o); updateBadge();
  $("ticket").textContent = orderText(o);''', '''  $("submit-btn").disabled = true; $("submit-btn").textContent = "Đang gửi…";
  placeOrder(o).then(r => {
    $("submit-btn").disabled = false; $("submit-btn").textContent = "Đặt cơm";
    if (!r.ok) { $("err").textContent = r.error; $("err").hidden = false; return; }
    o.no = r.no; o.id = r.id;
    try { localStorage.setItem("cobich-khach", JSON.stringify({ name: o.name, phone: o.phone, addr: o.addr })); } catch (_) {}
    cart.sets = []; cart.extras = {}; pollMenu();
    finishOrder(o);
  });
});
function finishOrder(o) {
  $("ticket").textContent = orderText(o);''')
rep('''    : `Quán sẽ giao đúng giờ. Bạn trả ${fmt(orderTotal(o))} tiền mặt khi nhận cơm.`;
  showKhach("done");
});''', '''    : `Quán sẽ giao đúng giờ. Bạn trả ${fmt(orderTotal(o))} tiền mặt khi nhận cơm.`;
  showKhach("done");
}''')

# Ảnh và món mới lưu lên máy chủ
rep('readImage(e.target.files[0], url => { byId[d.img].img = url; renderCatalog(); });',
    'readImage(e.target.files[0], url => { byId[d.img].img = url; uploadImg(d.img, url); renderCatalog(); });')
rep('if (file) readImage(file, url => { m.img = url; renderCatalog(); });',
    'if (file) readImage(file, url => { m.img = url; uploadImg(m.id, url); renderCatalog(); });')
rep('const m = { id, cat, name, ...', 'const m = { id, cat, name, added: true, ...')
rep('MENU.splice(MENU.indexOf(byId[id]), 1); delete byId[id]; delete stock[id];', 'removed.add(id); MENU.splice(MENU.indexOf(byId[id]), 1); delete byId[id]; delete stock[id];')
rep('''  if (db) { const ids = orders.map(o => o.id); (async () => { for (const id of ids) await db.doc("orders/" + id).delete().catch(syncErr); })(); }
  orders = []; cart.sets = []; cart.extras = {}; build = new Set();''', '''  cart.sets = []; cart.extras = {}; build = new Set();''')
rep('“Sang ngày mới” tắt hết món đang bán và xoá đơn của hôm trước.', '“Sang ngày mới” tắt hết món đang bán. Sổ đơn tự sang trang mới mỗi ngày.')

# Khởi động
rep('''load(); fillTimes(); route();''', '''fillTimes();
try { const k = JSON.parse(localStorage.getItem("cobich-khach") || "null"); if (k) { $("f-name").value = k.name; $("f-phone").value = k.phone; $("f-addr").value = k.addr; } } catch (_) {}
function showLogin(r) {
  ["khach", "chu", "ship"].forEach(id => show(id, false)); $("cartbar").hidden = true; $("owner-tabs").hidden = true;
  $("login").hidden = false;
  api("auth").then(d => {
    const setup = !d.ready;
    $("login").dataset.setup = setup ? "1" : "";
    $("login-title").textContent = setup ? "Tạo mã PIN lần đầu" : r === "shipper" ? "Shipper nhập mã PIN" : "Chủ quán nhập mã PIN";
    $("login-sub").textContent = setup ? "Chủ quán đặt 2 mã (6 chữ số trở lên): một mã cho mình, một mã cho shipper. Nhớ kỹ, không gửi cho khách." : "Máy này sẽ nhớ mã, lần sau không phải nhập lại.";
    $("pin1-l").textContent = setup ? "Mã PIN chủ quán" : "Mã PIN";
    $("pin2-w").hidden = !setup;
  }).catch(syncErr);
}
$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const p1 = $("pin1").value.trim(), p2 = $("pin2").value.trim();
  $("login-err").hidden = true;
  try {
    if ($("login").dataset.setup) await api("auth", { method: "POST", body: JSON.stringify({ owner: p1, ship: p2 }) });
    pin = p1; await checkRole();
    if (!role) throw new Error("Mã PIN không đúng.");
    try { localStorage.setItem(KEY, pin); } catch (_) {}
    $("pin1").value = $("pin2").value = "";
    await pollOrders(); route();
  } catch (err) { pin = ""; $("login-err").textContent = err.message; $("login-err").hidden = false; }
});
const logout = () => { pin = ""; role = null; orders = []; try { localStorage.removeItem(KEY); } catch (_) {} location.hash = ""; route(); };
$("logout").onclick = logout; $("logout2").onclick = logout;
$("chpin").onclick = () => {
  ["khach", "chu", "ship"].forEach(id => show(id, false)); $("cartbar").hidden = true; $("owner-tabs").hidden = true;
  $("login").hidden = false; $("login").dataset.setup = "1";
  $("login-title").textContent = "Đổi mã PIN";
  $("login-sub").textContent = "Nhập mã mới cho chủ quán và cho shipper (6 chữ số trở lên, hai mã khác nhau). Máy shipper sẽ phải nhập lại mã mới.";
  $("pin1-l").textContent = "Mã PIN chủ quán mới"; $("pin2-w").hidden = false;
};
route();''')
rep('''window.addEventListener("storage", e => { if (e.key === KEY && !db) { load(); render(); } });
setInterval(() => { if (mode !== "khach") render(); else updateBadge(); }, 30000);''', '''setInterval(() => { if (mode !== "khach") render(); }, 30000);''')
(here / "public/index.html").write_text(s, encoding="utf8")
print("built", len(s))
