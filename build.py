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
rep('<a class="tab" href="#chu-sp" id="t-sp">Sửa sản phẩm</a>',
    '<a class="tab" href="#chu-sp" id="t-sp">Sửa sản phẩm</a>\n    <button type="button" class="tab" id="chpin" style="margin-left:auto">Đổi mã</button>\n    <button type="button" class="tab" id="logout">Thoát</button>')
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
  $("nav").hidden = role !== "owner" || r === "khach";
  if (!allowed) { showLogin(r); return; }
  $("login").hidden = true;
  $("mem-top").hidden = r !== "khach" || !memGet()?.phone;''')

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
    finishOrder(o); renderMember();
    $("done-msg").textContent += ` Đơn này được +${setCount(o)} điểm khi giao xong (tích theo số ${o.phone}).`;
  });
});
function finishOrder(o) {
  $("ticket").textContent = orderText(o);''')
rep('''    : `Quán sẽ giao đúng giờ. Bạn trả ${fmt(orderTotal(o))} tiền mặt khi nhận cơm.`;
  $("done-title").textContent = `Cảm ơn ${o.name} đã đặt cơm Cô Bích Quán!`;
  showKhach("done");
});''', '''    : `Quán sẽ giao đúng giờ. Bạn trả ${fmt(orderTotal(o))} tiền mặt khi nhận cơm.`;
  $("done-title").textContent = `Cảm ơn ${o.name} đã đặt cơm Cô Bích Quán!`;
  $("done-msg").textContent = "Chúc bạn ngon miệng! " + $("done-msg").textContent;
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
rep("“Sang ngày mới” tắt hết món đang bán. Kho", "“Sang ngày mới” tắt hết món đang bán, sổ đơn tự sang trang mới mỗi ngày. Kho")


# Thành viên tích điểm bằng số điện thoại
rep('.price-tag b { font-family: var(--font-display); font-size: 22px; white-space: nowrap; }', """.price-tag b { font-family: var(--font-display); font-size: 22px; white-space: nowrap; }
.member { border: 1.5px solid var(--yolk); background: var(--yolk-soft); border-radius: 12px; padding: 14px; }
.member h3 { margin: 0; }
.mem-top { display: flex; justify-content: space-between; gap: 8px; background: var(--yolk-soft); border-radius: 10px; padding: 8px 12px; font-size: 14px; }
.mem-top .pts { color: var(--leaf); }
.member .sub { margin: 4px 0 0; }
.mem-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mem-row .pts { color: var(--leaf); }
.linkish { font: inherit; font-size: 14px; background: none; border: 0; color: var(--muted); text-decoration: underline; cursor: pointer; padding: 4px; }""")
rep("""      <div class="price-tag"><b id="set-price-k">40k</b><span id="set-rule">1 suất, chọn 5 món</span></div>
    </header>""", """      <div class="price-tag"><b id="set-price-k">40k</b><span id="set-rule">1 suất, chọn 5 món</span></div>
    </header>
    <div class="mem-top" id="mem-top" hidden><span id="mem-top-hi"></span><b class="pts" id="mem-top-pts"></b></div>""")
rep("""      <div class="total"><span>Tổng cộng</span><span id="total-co"></span></div>
      <form id="form" novalidate""", """      <div class="total"><span>Tổng cộng</span><span id="total-co"></span></div>
      <div class="member" id="member">
        <div id="mem-ask">
          <h3 id="mem-ask-title">Tích điểm cho đơn này</h3>
          <p class="sub">Đăng nhập bằng số điện thoại: mỗi suất cơm được 1 điểm, đổi quà tri ân của quán. Lần sau đặt nhanh, không phải gõ lại.</p>
          <div style="display:grid;gap:10px;margin-top:12px">
            <div class="field"><label for="m-phone">Số điện thoại</label><input id="m-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="09xx xxx xxx"></div>
            <div class="field"><label for="m-name">Tên của bạn</label><input id="m-name" autocomplete="name" placeholder="VD: Chị Lan"></div>
            <p class="err" id="m-err" hidden></p>
            <button type="button" class="btn-main" id="m-go">Đăng nhập và tích điểm</button>
            <button type="button" class="linkish" id="m-skip">Đặt không cần đăng nhập</button>
          </div>
        </div>
        <div id="mem-in" class="mem-row" hidden><div><b id="mem-hi"></b> · <b id="mem-pts" class="pts"></b><small class="sub" id="mem-sub" style="display:block"></small></div><button type="button" class="linkish" id="m-out">Đổi số</button></div>
        <div id="mem-guest" class="mem-row" hidden><span>Đăng nhập số điện thoại để <b>tích điểm</b> cho đơn này.</span><button type="button" class="btn-sm" id="m-login">Đăng nhập</button></div>
      </div>
      <form id="form" novalidate""")


# Chuyển khoản: chủ quán xác nhận đã nhận tiền (khách chọn chuyển khoản chưa chắc đã chuyển)
rep("""  const paid = orders.filter(o => o.pay === "Chuyển khoản").reduce((s, o) => s + orderTotal(o), 0);
  const due = orders.filter(o => o.pay !== "Chuyển khoản" && o.st !== "giao").reduce((s, o) => s + orderTotal(o), 0);""",
"""  const paid = orders.filter(isPaid).reduce((s, o) => s + orderTotal(o), 0);
  const due = orders.filter(o => !isPaid(o) && o.st !== "giao").reduce((s, o) => s + orderTotal(o), 0);
  const wait = orders.filter(o => o.pay === "Chuyển khoản" && !o.paid);""")
rep("""  $("st-paid").innerHTML = `<span class="paid">Đã thu ${fmt(paid)}</span> · <span class="collect">Cần thu ${fmt(due)}</span>`;""",
"""  $("st-paid").innerHTML = `<span class="paid">Đã thu ${fmt(paid)}</span> · <span class="collect">Cần thu ${fmt(due)}</span>${wait.length ? ` · <span class="collect">${wait.length} đơn chờ xác nhận chuyển khoản</span>` : ""}`;""")
rep("""${o.pay === "Chuyển khoản" ? `<b class="paid">Đã thu tiền (chuyển khoản)</b>` : `<b class="collect">Thu tiền mặt ${fmt(orderTotal(o))} khi giao</b>`}</div>""",
"""${isPaid(o) ? `<b class="paid">Đã nhận tiền (chuyển khoản)</b>` : o.pay === "Chuyển khoản" ? `<span><b class="collect">Chờ xác nhận chuyển khoản ${fmt(orderTotal(o))}</b><br><small class="sub">Nội dung: COBICH ${esc(o.phone.replace(/\\D/g, ""))}</small><br><button type="button" class="btn-sm" style="margin-top:4px;background:var(--leaf);color:var(--leaf-ink);border-color:var(--leaf)" data-paid="${o.no}">Đã nhận tiền</button></span>` : `<b class="collect">Thu tiền mặt ${fmt(orderTotal(o))} khi giao</b>`}</div>""")
rep("""${o.pay === "Chuyển khoản" ? "ĐÃ THU TIỀN (chuyển khoản)" : "THU TIỀN MẶT: " + fmt(orderTotal(o))}""",
"""${isPaid(o) ? "ĐÃ THU TIỀN (chuyển khoản)" : o.pay === "Chuyển khoản" ? "CHUYỂN KHOẢN CHƯA XÁC NHẬN: hỏi chủ quán trước khi thu " + fmt(orderTotal(o)) : "THU TIỀN MẶT: " + fmt(orderTotal(o))}""")
rep("""const u = urgency(o), gone = o.st === "giao", cash = o.pay !== "Chuyển khoản";""",
"""const u = urgency(o), gone = o.st === "giao", cash = !isPaid(o), waitBank = o.pay === "Chuyển khoản" && !o.paid;""")
rep("""  const cash = list.filter(o => o.pay !== "Chuyển khoản").reduce((s, o) => s + orderTotal(o), 0);""",
"""  const cash = list.filter(o => !isPaid(o)).reduce((s, o) => s + orderTotal(o), 0);""")
rep("""    ? "Đơn đã thanh toán bằng chuyển khoản. Quán sẽ giao đúng giờ, bạn không cần trả thêm."
""", """    ? "Quán sẽ xác nhận khi nhận được tiền chuyển khoản, rồi giao đúng giờ. Nhớ ghi đúng nội dung chuyển khoản nhé."
""")
rep("""    <div class="s-money">${cash ? `<span class="collect">Thu tiền mặt ${fmt(orderTotal(o))}</span>` : `<span class="paid">Đã thu tiền (chuyển khoản)</span>`}</div>""",
"""    <div class="s-money">${waitBank ? `<span class="collect">Khách chọn chuyển khoản, quán CHƯA xác nhận tiền. Gọi chủ quán trước khi thu ${fmt(orderTotal(o))}.</span>` : cash ? `<span class="collect">Thu tiền mặt ${fmt(orderTotal(o))}</span>` : `<span class="paid">Đã thu tiền (chuyển khoản)</span>`}</div>""")

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
''' + (here / "src/member.js").read_text(encoding="utf8") + '''
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
