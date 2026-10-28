// API của app đặt cơm Cô Bích Quán (Cloudflare Pages Functions + D1, binding DB)
const STATUSES = ["moi", "xong", "nau", "giao", "huy"];
const SHIP_CAN = ["nau", "giao"];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const bad = (error, status = 400) => json({ error }, status);

// Ngày theo giờ Việt Nam (UTC+7) để mỗi ngày một sổ đơn
const vnDay = (t = Date.now()) => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function getKV(db, k) {
  const r = await db.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first();
  return r ? JSON.parse(r.v) : null;
}
const putKV = (db, k, v) => db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, JSON.stringify(v)).run();

// Vai trò theo mã PIN: "owner" (chủ quán) hoặc "ship" (shipper)
async function roleOf(db, request) {
  const pin = request.headers.get("x-pin");
  if (!pin) return null;
  const auth = await getKV(db, "auth");
  if (!auth) return null;
  const h = await sha(auth.salt + pin);
  if (h === auth.owner) return "owner";
  if (h === auth.ship) return "ship";
  return null;
}

async function todayOrders(db) {
  const { results } = await db.prepare("SELECT id, data, st FROM orders WHERE day = ? ORDER BY no").bind(vnDay()).all();
  return results.map(r => ({ ...JSON.parse(r.data), id: r.id, st: r.st }));
}
function soldMap(orders) {
  const sold = {};
  for (const o of orders) {
    if (o.st === "huy") continue;
    for (const s of o.sets || []) for (const id of [...(s.picks || []), ...(s.canh ? [s.canh] : [])]) sold[id] = (sold[id] || 0) + (s.qty || 0);
    for (const [id, q] of Object.entries(o.extras || {})) sold[id] = (sold[id] || 0) + (q || 0);
    for (const [id, q] of Object.entries(o.tray?.items || {})) sold[id] = (sold[id] || 0) + (q || 0) * (o.tray.per || 2);
  }
  return sold;
}
// Món trong đơn: suất (theo loại suất), đồ uống, mâm (theo đĩa). Tính tiền ở máy chủ.
function parseItems(body, menu) {
  const tiers = Array.isArray(menu?.tiers) && menu.tiers.length ? menu.tiers
    : [{ price: 35000, picks: 3 }, { price: 40000, picks: 4 }, { price: 50000, picks: 5 }];
  const maxPicks = Math.max(...tiers.map(t => +t.picks || 0));
  const sets = (Array.isArray(body.sets) ? body.sets : []).slice(0, 30).map(s => {
    const picks = [...new Set((Array.isArray(s.picks) ? s.picks : []).slice(0, maxPicks).map(x => str(x, 40)))];
    return { picks, qty: Math.max(1, Math.min(50, parseInt(s.qty, 10) || 1)), price: +tiers.find(t => +t.picks === picks.length)?.price || 0 };
  }).filter(s => s.picks.length);
  if (sets.some(s => !s.price)) return { error: "Số món trong suất chưa đúng, bạn chọn lại giúp quán nhé." };
  const extras = {};
  for (const [id, q] of Object.entries(body.extras || {})) { const n = Math.min(50, parseInt(q, 10) || 0); if (n > 0) extras[str(id, 40)] = n; }
  let tray = null;
  if (body.tray) {
    const T = menu?.tray || {};
    if (!T.on) return { error: "Quán chưa nhận đặt mâm hôm nay." };
    const items = {}, rau = new Set(Object.entries(menu?.cats || {}).filter(([, c]) => c === "Rau").map(([id]) => id));
    for (const [id, q] of Object.entries(body.tray.items || {}).slice(0, 40)) { const n = Math.min(20, parseInt(q, 10) || 0); if (n > 0) items[str(id, 40)] = n; }
    const people = Math.max(1, Math.min(50, parseInt(body.tray.people, 10) || 1));
    if (Object.keys(items).length) {
      const per = Math.max(1, parseInt(T.per, 10) || 2);
      const price = people * (+T.person || 0) + Object.entries(items).reduce((t, [id, q]) => t + q * (rau.has(id) ? +T.rau || 0 : +T.man || 0), 0);
      tray = { people, items, per, price };
    }
  }
  if (!sets.length && !Object.keys(extras).length && !tray) return { error: "Giỏ hàng trống." };
  const total = (tray?.price || 0) + sets.reduce((t, x) => t + x.qty * x.price, 0)
    + Object.entries(extras).reduce((t, [id, q]) => t + q * (menu?.prices?.[id] || 0), 0);
  return { sets, extras, ...(tray ? { tray } : {}), total };
}
function outOf(menu, sold, items) {
  if (!menu) return [];
  const need = soldMap([items]);
  return Object.entries(need).filter(([id, q]) => (menu.stock?.[id] || 0) - (sold[id] || 0) < q).map(([id]) => id);
}
const str = (v, max) => String(v ?? "").trim().slice(0, max);
// Vị trí ghim trên bản đồ (chỉ nhận toạ độ trong khoảng Việt Nam)
const geoOf = g => {
  const lat = +g?.lat, lng = +g?.lng;
  return lat > 8 && lat < 24 && lng > 102 && lng < 110 ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : null;
};
const genderOf = g => g === "nu" ? "nu" : g === "nam" ? "nam" : "";

// Thông báo đẩy (Web Push, VAPID, không gửi nội dung): báo chủ quán khi có đơn mới, báo shipper khi đơn soạn xong.
// Khoá VAPID tự tạo lần đầu và lưu trong D1.
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function vapidKeys(db) {
  let v = await getKV(db, "vapid");
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    v = { pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
    await putKV(db, "vapid", v);
  }
  return v;
}
async function sendPush(db, role) {
  const { results } = await db.prepare("SELECT k, v FROM kv WHERE k LIKE ?").bind(`push:${role}:%`).all();
  if (!results.length) return;
  const v = await vapidKeys(db);
  const key = await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  await Promise.all(results.map(async r => {
    try {
      const sub = JSON.parse(r.v).sub, aud = new URL(sub.endpoint).origin;
      const head = enc({ typ: "JWT", alg: "ES256" }) + "." + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://com-co-bich.wudingzhao112.workers.dev" });
      const sig = b64u(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head)));
      const res = await fetch(sub.endpoint, { method: "POST", headers: { TTL: "3600", Urgency: "high", Authorization: `vapid t=${head}.${sig}, k=${v.pub}`, "Content-Length": "0" } });
      if (res.status === 404 || res.status === 410) await db.prepare("DELETE FROM kv WHERE k = ?").bind(r.k).run();
    } catch (_) {}
  }));
}
// Số điện thoại chuẩn: bỏ dấu cách, dấu chấm, gạch; +84 / 84 đổi về 0 (0399… và +84399… là một người)
const phoneKey = v => String(v ?? "").replace(/[\s.\-()]/g, "").replace(/^(\+84|84)(?=\d{9}$)/, "0");
const PHONE_SQL = "REPLACE(REPLACE(REPLACE(REPLACE(json_extract(data, '$.phone'), ' ', ''), '.', ''), '-', ''), '+84', '0')";

// Tài khoản khách: tên đăng nhập là số điện thoại, mật khẩu băm PBKDF2
async function passHash(pass, salt) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 20000 }, k, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function newSession(db, phone) {
  const token = crypto.randomUUID() + crypto.randomUUID().slice(0, 8);
  await putKV(db, "cses:" + await sha(token), { phone, at: Date.now() });
  return token;
}
async function cusOf(db, request) {
  const t = request.headers.get("x-cus");
  if (!t) return null;
  const s = await getKV(db, "cses:" + await sha(t));
  return s ? await getKV(db, "cus:" + s.phone) : null;
}
async function pointsOf(db, key, olds = []) {
  const keys = [key, ...olds].slice(0, 6);
  const { results } = await db.prepare(`SELECT data, st FROM orders WHERE ${PHONE_SQL} IN (${keys.map(() => "?").join(",")}) AND st != 'huy'`).bind(...keys).all();
  let earned = 0, pending = 0, spent = 0, refUsed = 0;
  for (const r of results) {
    const d = JSON.parse(r.data), n = (d.sets || []).reduce((t, x) => t + (x.qty || 0), 0);
    if (r.st === "giao") earned += n; else pending += n;
    spent += d.promo?.points || 0; refUsed += d.promo?.ref || 0;
  }
  return { points: Math.max(0, earned - spent), earned, spent, pending, orders: results.length, refUsed };
}
// Chương trình khuyến mãi: chủ quán bật/tắt
const PROMO0 = { gift: { on: false, text: "" }, free: { on: false, points: 10 }, ref: { on: false, amount: 5000 } };
const promoOf = async db => {
  const p = (await getKV(db, "promo")) || {};
  return { gift: { ...PROMO0.gift, ...p.gift }, free: { ...PROMO0.free, ...p.free }, ref: { ...PROMO0.ref, ...p.ref } };
};
// Mã mời riêng của mỗi khách (link ?ref=MÃ)
async function ensureCode(db, c) {
  if (c.code) return;
  for (let i = 0; i < 5 && !c.code; i++) {
    const code = [...crypto.getRandomValues(new Uint8Array(6))].map(x => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
    if (!(await getKV(db, "ref:" + code))) { c.code = code; await putKV(db, "ref:" + code, { phone: c.phone }); await putKV(db, "cus:" + c.phone, c); }
  }
}
const maskPhone = p => String(p).replace(/^(\d{3})\d+(\d{3})$/, "$1 xxx $2");
const pubCus = c => ({ name: c.name, phone: c.phone, addr: c.addr, avatar: c.avatar || "", gender: c.gender || "", geo: c.geo || null });
async function cusPoints(db, c) {
  await ensureCode(db, c);
  const p = await pointsOf(db, c.phone, c.olds || []), inv = c.invites || [];
  return { ...p, code: c.code, invites: inv.map(x => ({ name: x.name, phone: maskPhone(x.phone), at: x.at })), refLeft: Math.max(0, inv.length - p.refUsed) };
}

export async function onRequest({ request, env, params, waitUntil }) {
  const later = p => (waitUntil ? waitUntil(p) : p.catch(() => {}));
  const db = env.DB;
  if (!db) return bad("Chưa gắn cơ sở dữ liệu DB", 500);
  const path = [].concat(params.path || []);
  const [a, b] = path;
  const m = request.method;

  try {
    // Trạng thái đăng nhập: đã tạo mã PIN chưa
    if (a === "auth" && m === "GET") {
      const auth = await getKV(db, "auth");
      return json({ ready: !!auth, role: await roleOf(db, request) });
    }
    // Lần đầu: chủ quán tạo mã PIN cho mình và cho shipper
    if (a === "auth" && m === "POST") {
      const body = await request.json();
      const auth = await getKV(db, "auth");
      const owner = str(body.owner, 20), ship = str(body.ship, 20);
      if (!/^\d{6,12}$/.test(owner) || !/^\d{6,12}$/.test(ship) || owner === ship) return bad("Mã PIN gồm 6 đến 12 chữ số, hai mã phải khác nhau.");
      if (auth && (await roleOf(db, request)) !== "owner") return bad("Đã có mã PIN. Cần mã chủ quán để đổi.", 403);
      const salt = crypto.randomUUID();
      await putKV(db, "auth", { salt, owner: await sha(salt + owner), ship: await sha(salt + ship) });
      return json({ ok: true });
    }

    // Thông báo đẩy: lấy khoá công khai, đăng ký máy nhận thông báo (cần mã PIN)
    if (a === "push" && b === "key" && m === "GET") return json({ key: (await vapidKeys(db)).pub });
    if (a === "push" && b === "sub" && m === "POST") {
      const role = await roleOf(db, request);
      if (!role) return bad("Cần mã PIN.", 401);
      const { sub } = await request.json();
      if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint)) return bad("Đăng ký thông báo không hợp lệ.");
      await putKV(db, `push:${role}:${(await sha(sub.endpoint)).slice(0, 20)}`, { sub, at: Date.now() });
      return json({ ok: true });
    }
    if (a === "push" && b === "test" && m === "POST") {
      const role = await roleOf(db, request);
      if (!role) return bad("Cần mã PIN.", 401);
      await sendPush(db, role);
      return json({ ok: true });
    }

    // Khách xem thực đơn hôm nay và số suất đã bán
    if (a === "menu" && m === "GET") {
      const [menu, orders, imgs] = await Promise.all([getKV(db, "menu"), todayOrders(db), db.prepare("SELECT id, v FROM images").all()]);
      return json({ menu, promo: await promoOf(db), sold: soldMap(orders), imgs: Object.fromEntries(imgs.results.map(r => [r.id, r.v])), day: vnDay() });
    }
    if (a === "promo" && m === "PUT") {
      if ((await roleOf(db, request)) !== "owner") return bad("Cần mã PIN chủ quán.", 401);
      const b2 = await request.json();
      const p = {
        gift: { on: !!b2.gift?.on, text: str(b2.gift?.text, 200) },
        free: { on: !!b2.free?.on, points: Math.max(1, Math.min(500, parseInt(b2.free?.points, 10) || 10)) },
        ref: { on: !!b2.ref?.on, amount: Math.max(0, Math.min(100000, parseInt(b2.ref?.amount, 10) || 0)) } };
      await putKV(db, "promo", p);
      return json({ promo: p });
    }
    if (a === "menu" && m === "PUT") {
      if ((await roleOf(db, request)) !== "owner") return bad("Cần mã PIN chủ quán.", 401);
      const menu = await request.json();
      if (!menu || typeof menu.stock !== "object") return bad("Dữ liệu món không hợp lệ.");
      await putKV(db, "menu", menu);
      return json({ ok: true });
    }

    // Ảnh món chủ quán tải lên
    if (a === "img" && b && m === "GET") {
      const r = await db.prepare("SELECT data FROM images WHERE id = ?").bind(b).first();
      if (!r) return new Response("", { status: 404 });
      const [, type, b64] = /^data:([^;]+);base64,(.*)$/.exec(r.data) || [];
      if (!b64) return new Response("", { status: 404 });
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
    }
    if (a === "img" && b && m === "PUT") {
      if ((await roleOf(db, request)) !== "owner") return bad("Cần mã PIN chủ quán.", 401);
      const { data } = await request.json();
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(data || "") || data.length > 1_500_000) return bad("Ảnh không hợp lệ hoặc quá lớn.");
      const v = Date.now();
      await db.prepare("INSERT INTO images (id, data, v) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, v = excluded.v").bind(b, data, v).run();
      return json({ ok: true, v });
    }

    // Khách đặt đơn
    if (a === "orders" && !b && m === "POST") {
      const body = await request.json();
      const name = str(body.name, 80), phone = str(body.phone, 20), addr = str(body.addr, 200);
      if (!name || !/^\+?\d{9,12}$/.test(phone.replace(/[\s.\-()]/g, "")) || !addr) return bad("Vui lòng điền tên, số điện thoại và địa chỉ.");
      const menu = await getKV(db, "menu");
      const it = parseItems(body, menu);
      if (it.error) return bad(it.error);
      const { sets, extras, tray } = it;
      let total = it.total;

      const orders = await todayOrders(db), sold = soldMap(orders);
      const out = outOf(menu, sold, it);
      if (out.length) return json({ error: "Có món vừa hết, bạn chọn lại giúp quán nhé.", out }, 409);
      // Ưu đãi: đổi điểm lấy 1 suất miễn phí, phiếu mời bạn
      let discount = 0; const promo = {};
      if (body.use?.free || body.use?.ref) {
        const c = await cusOf(db, request);
        if (!c || ![c.phone, ...(c.olds || [])].includes(phoneKey(phone))) return bad("Đăng nhập đúng số điện thoại của đơn để dùng ưu đãi.", 401);
        const pr = await promoOf(db), pts = await pointsOf(db, c.phone, c.olds || []);
        if (body.use.free) {
          if (!pr.free.on || pts.points < pr.free.points || !sets.length) return bad("Chưa đủ điểm để đổi suất miễn phí.", 409);
          if (!sets.length) return bad("Đổi suất miễn phí cần có ít nhất 1 suất cơm.", 409);
          discount += Math.min(...sets.map(x => x.price)); promo.points = pr.free.points;
        }
        if (body.use.ref) {
          if (!pr.ref.on || (c.invites || []).length - pts.refUsed < 1) return bad("Bạn chưa có phiếu mời bạn để dùng.", 409);
          discount += pr.ref.amount; promo.ref = 1;
        }
      }
      discount = Math.min(discount, total);
      const no = orders.reduce((mx, o) => Math.max(mx, o.no || 0), 0) + 1;
      const id = crypto.randomUUID().slice(0, 12), at = Date.now();
      const geo = geoOf(body.geo);
      const ckey = crypto.randomUUID();
      const order = { no, at, ckey, name, phone, addr, ...(geo ? { geo } : {}), time: str(body.time, 30) || "Càng sớm càng tốt",
        pay: body.pay === "Chuyển khoản" ? "Chuyển khoản" : "Tiền mặt", paid: false, note: str(body.note, 300), sets, extras, ...(tray ? { tray } : {}),
        ...(discount ? { discount, promo } : {}), total: total - discount };
      await db.prepare("INSERT INTO orders (id, no, day, at, st, data) VALUES (?, ?, ?, ?, 'moi', ?)").bind(id, no, vnDay(at), at, JSON.stringify(order)).run();
      later(sendPush(db, "owner"));
      return json({ ok: true, id, no, ckey, at, total: total - discount, discount });
    }

    // Tài khoản khách: đăng ký, đăng nhập, xem và sửa thông tin (tên, địa chỉ)
    if (a === "cus" && (b === "register" || b === "login") && m === "POST") {
      const body = await request.json();
      const phone = phoneKey(body.phone), pass = String(body.pass ?? "");
      if (!/^\+?\d{9,13}$/.test(phone)) return bad("Số điện thoại chưa đúng.");
      if (pass.length < 6 || pass.length > 64) return bad("Mật khẩu từ 6 ký tự trở lên.");
      const cur = await getKV(db, "cus:" + phone);
      if (b === "register") {
        // Đăng ký gọn: số điện thoại, mật khẩu, giới tính, địa chỉ (tên sửa sau trong Cài đặt)
        const gender = genderOf(body.gender), addr = str(body.addr, 200), geo = geoOf(body.geo);
        const name = str(body.name, 80) || (gender === "nu" ? "Chị" : "Anh");
        if (!gender) return bad("Vui lòng chọn giới tính.");
        if (addr.length < 8) return bad("Vui lòng nhập địa chỉ đầy đủ: số nhà, ngõ, đường, phường.");
        if (cur) return bad("Số điện thoại này đã có tài khoản. Bạn bấm “Đăng nhập” nhé.", 409);
        const salt = crypto.randomUUID();
        const c = { phone, name, gender, addr, ...(geo ? { geo } : {}), salt, hash: await passHash(pass, salt), at: Date.now() };
        // Được bạn mời (link ?ref=MÃ): ghi nhận cho người mời nếu là khách mới
        const inv = body.ref ? await getKV(db, "ref:" + str(body.ref, 12).toUpperCase()) : null;
        if (inv && inv.phone !== phone && !(await pointsOf(db, phone)).orders) {
          const host = await getKV(db, "cus:" + inv.phone);
          if (host) { c.by = host.phone; host.invites = [...(host.invites || []), { phone, name: c.name, at: Date.now() }].slice(-200); await putKV(db, "cus:" + host.phone, host); }
        }
        await putKV(db, "cus:" + phone, c);
        return json({ token: await newSession(db, phone), me: { ...pubCus(c), ...(await cusPoints(db, c)) } });
      }
      if (!cur || (await passHash(pass, cur.salt)) !== cur.hash) return bad("Sai số điện thoại hoặc mật khẩu.", 401);
      return json({ token: await newSession(db, phone), me: { ...pubCus(cur), ...(await cusPoints(db, cur)) } });
    }
    if (a === "cus" && b === "me") {
      const c = await cusOf(db, request);
      if (!c) return bad("Cần đăng nhập lại.", 401);
      if (m === "PUT") {
        const body = await request.json();
        const name = str(body.name, 80) || c.name, addr = body.addr == null ? c.addr : str(body.addr, 200);
        if (addr.length < 8) return bad("Vui lòng nhập địa chỉ đầy đủ: số nhà, ngõ, đường, phường.");
        if (body.avatar != null) {
          const av = String(body.avatar);
          if (av && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(av) || av.length > 120000)) return bad("Ảnh chưa hợp lệ, bạn chọn ảnh khác nhé.");
          c.avatar = av;
        }
        const old = c.phone, phone = body.phone == null ? old : phoneKey(body.phone);
        if (phone !== old) {
          // Đổi số điện thoại: cần mật khẩu, giữ điểm của số cũ
          if (!/^\+?\d{9,13}$/.test(phone)) return bad("Số điện thoại chưa đúng.");
          if ((await passHash(String(body.pass ?? ""), c.salt)) !== c.hash) return bad("Đổi số điện thoại cần nhập đúng mật khẩu.", 401);
          if (await getKV(db, "cus:" + phone)) return bad("Số này đã có tài khoản khác.", 409);
          c.olds = [...new Set([old, ...(c.olds || [])])].filter(x => x !== phone).slice(0, 5);
          c.phone = phone;
          if (c.code) await putKV(db, "ref:" + c.code, { phone });
          await putKV(db, "cses:" + await sha(request.headers.get("x-cus")), { phone, at: Date.now() });
          await db.prepare("DELETE FROM kv WHERE k = ?").bind("cus:" + old).run();
        }
        Object.assign(c, { name, addr });
        if (body.gender != null && genderOf(body.gender)) c.gender = genderOf(body.gender);
        if (body.geo !== undefined) { const g = geoOf(body.geo); if (g) c.geo = g; else delete c.geo; }
        await putKV(db, "cus:" + c.phone, c);
      }
      return json({ me: { ...pubCus(c), ...(await cusPoints(db, c)) } });
    }
    if (a === "cus" && b === "pass" && m === "POST") {
      const c = await cusOf(db, request);
      if (!c) return bad("Cần đăng nhập lại.", 401);
      const body = await request.json(), pass = String(body.pass ?? "");
      if ((await passHash(String(body.old ?? ""), c.salt)) !== c.hash) return bad("Mật khẩu cũ chưa đúng.", 401);
      if (pass.length < 6 || pass.length > 64) return bad("Mật khẩu mới từ 6 ký tự trở lên.");
      c.salt = crypto.randomUUID(); c.hash = await passHash(pass, c.salt);
      await putKV(db, "cus:" + c.phone, c);
      return json({ ok: true });
    }

    // Góp ý của khách: ai cũng gửi được, chủ quán xem trong Báo cáo
    if (a === "feedback" && m === "POST") {
      const body = await request.json(), c = await cusOf(db, request);
      const text = str(body.text, 1000);
      if (text.length < 3) return bad("Bạn viết góp ý giúp quán nhé.");
      const at = Date.now();
      await putKV(db, `fb:${at}:${crypto.randomUUID().slice(0, 6)}`, { at, text, name: c?.name || str(body.name, 80), phone: c?.phone || "" });
      return json({ ok: true });
    }
    if (a === "feedback" && m === "GET") {
      if ((await roleOf(db, request)) !== "owner") return bad("Cần mã PIN chủ quán.", 401);
      const { results } = await db.prepare("SELECT v FROM kv WHERE k LIKE 'fb:%' ORDER BY k DESC LIMIT 50").all();
      return json({ items: results.map(r => JSON.parse(r.v)) });
    }

    // Khách tích điểm theo số điện thoại: 1 suất đã giao = 1 điểm
    if (a === "me" && m === "GET") {
      const key = phoneKey(new URL(request.url).searchParams.get("phone"));
      if (!/^\+?\d{9,13}$/.test(key)) return bad("Số điện thoại không hợp lệ.");
      return json(await pointsOf(db, key));
    }

    // Chủ quán và shipper xem đơn hôm nay
    // Báo cáo theo khoảng ngày (chủ quán): số đơn, số suất, tiền
    if (a === "report" && m === "GET") {
      if ((await roleOf(db, request)) !== "owner") return bad("Cần mã PIN chủ quán.", 401);
      const q = new URL(request.url).searchParams, ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
      const from = ok(q.get("from")) ? q.get("from") : vnDay(), to = ok(q.get("to")) ? q.get("to") : from;
      const { results } = await db.prepare("SELECT day, st, data FROM orders WHERE day BETWEEN ? AND ? AND st != 'huy'").bind(from, to).all();
      const days = {}, tot = { orders: 0, sets: 0, money: 0, done: 0, cust: new Set() };
      for (const r of results) {
        const d = JSON.parse(r.data), n = (d.sets || []).reduce((t, x) => t + (x.qty || 0), 0), money = +d.total || 0;
        const x = days[r.day] ||= { day: r.day, orders: 0, sets: 0, money: 0 };
        x.orders++; x.sets += n; x.money += money;
        tot.orders++; tot.sets += n; tot.money += money; if (r.st === "giao") tot.done++; tot.cust.add(phoneKey(d.phone));
      }
      return json({ from, to, orders: tot.orders, sets: tot.sets, money: tot.money, done: tot.done, cust: tot.cust.size, days: Object.values(days).sort((p, q2) => q2.day.localeCompare(p.day)) });
    }
    if (a === "orders" && !b && m === "GET") {
      const role = await roleOf(db, request);
      if (!role) return bad("Cần mã PIN.", 401);
      return json({ role, orders: await todayOrders(db) });
    }
    // Khách theo dõi đơn: đơn đặt trên máy này (id + mã) và đơn theo tài khoản đăng nhập
    if (a === "track" && m === "POST") {
      const body = await request.json(), c = await cusOf(db, request), out = new Map();
      const pub = r => { const d = JSON.parse(r.data); return { id: r.id, no: d.no, at: r.at, day: r.day, st: r.st, time: d.time, total: d.total, sets: (d.sets || []).reduce((t, x) => t + (x.qty || 0), 0), drinks: Object.values(d.extras || {}).reduce((t, q) => t + q, 0), addr: d.addr,
        tray: d.tray ? d.tray.people : 0, edited: d.edited || 0, discount: d.discount || 0,
        detail: { name: d.name, phone: d.phone, addr: d.addr, geo: d.geo || null, time: d.time, note: d.note, sets: (d.sets || []).map(x => ({ picks: x.picks, qty: x.qty, price: x.price })), extras: d.extras || {}, tray: d.tray || null } }; };
      for (const it of (Array.isArray(body.items) ? body.items : []).slice(0, 20)) {
        const r = await db.prepare("SELECT id, day, at, st, data FROM orders WHERE id = ?").bind(str(it.id, 40)).first();
        if (r && JSON.parse(r.data).ckey === it.key) out.set(r.id, pub(r));
      }
      if (c) {
        const keys = [c.phone, ...(c.olds || [])].slice(0, 6);
        const { results } = await db.prepare(`SELECT id, day, at, st, data FROM orders WHERE ${PHONE_SQL} IN (${keys.map(() => "?").join(",")}) ORDER BY at DESC LIMIT 20`).bind(...keys).all();
        for (const r of results) out.set(r.id, pub(r));
      }
      return json({ orders: [...out.values()].sort((x, y) => y.at - x.at) });
    }
    // Khách tự huỷ đơn trong 5 phút sau khi đặt (cần mã huỷ trả về lúc đặt)
    if (a === "orders" && b && path[2] === "cancel" && m === "POST") {
      const { key } = await request.json();
      const row = await db.prepare("SELECT st, at, data FROM orders WHERE id = ?").bind(b).first();
      if (!row || !key || JSON.parse(row.data).ckey !== key) return bad("Không tìm thấy đơn.", 404);
      if (Date.now() - row.at > 5 * 60e3 + 15e3) return bad("Đã quá 5 phút, không huỷ được nữa. Bạn gọi quán 035 456 3552 nhé.", 409);
      if (!["moi", "xong"].includes(row.st)) return bad("Đơn đã giao cho shipper, không huỷ được. Bạn gọi quán 035 456 3552 nhé.", 409);
      await db.prepare("UPDATE orders SET st = 'huy' WHERE id = ? AND st IN ('moi', 'xong')").bind(b).run();
      return json({ ok: true });
    }
    // Khách sửa đơn trong 5 phút sau khi đặt (giữ số đơn, quán thấy “Khách đã sửa”)
    if (a === "orders" && b && path[2] === "edit" && m === "POST") {
      const body = await request.json();
      const row = await db.prepare("SELECT st, at, data FROM orders WHERE id = ?").bind(b).first();
      const old = row ? JSON.parse(row.data) : null;
      if (!row || !body.key || old.ckey !== body.key) return bad("Không tìm thấy đơn.", 404);
      if (Date.now() - row.at > 5 * 60e3 + 15e3) return bad("Đã quá 5 phút, không sửa được nữa. Bạn gọi quán 035 456 3552 nhé.", 409);
      if (row.st !== "moi") return bad("Quán đã soạn xong đơn này, không sửa được nữa. Bạn gọi quán 035 456 3552 nhé.", 409);
      const name = str(body.name, 80), phone = str(body.phone, 20), addr = str(body.addr, 200);
      if (!name || !/^\+?\d{9,12}$/.test(phone.replace(/[\s.\-()]/g, "")) || !addr) return bad("Vui lòng điền tên, số điện thoại và địa chỉ.");
      const menu = await getKV(db, "menu");
      const it = parseItems(body, menu);
      if (it.error) return bad(it.error);
      const others = (await todayOrders(db)).filter(o => o.id !== b);
      const out = outOf(menu, soldMap(others), it);
      if (out.length) return json({ error: "Có món vừa hết, bạn chọn lại giúp quán nhé.", out }, 409);
      if (old.promo?.points && !it.sets.length) return bad("Đơn có đổi suất miễn phí nên cần giữ ít nhất 1 suất cơm.", 409);
      const discount = Math.min(old.discount || 0, it.total), geo = geoOf(body.geo);
      const order = { ...old, name, phone, addr, time: str(body.time, 30) || "Càng sớm càng tốt", note: str(body.note, 300),
        sets: it.sets, extras: it.extras, total: it.total - discount, edited: Date.now(), ...(discount ? { discount } : {}) };
      delete order.tray; if (it.tray) order.tray = it.tray;
      delete order.geo; if (geo) order.geo = geo;
      const r = await db.prepare("UPDATE orders SET data = ? WHERE id = ? AND st = 'moi'").bind(JSON.stringify(order), b).run();
      if (!(r.meta?.changes ?? r.changes)) return bad("Quán vừa soạn xong đơn này, không sửa được nữa.", 409);
      later(sendPush(db, "owner"));
      return json({ ok: true, id: b, no: old.no, ckey: old.ckey, at: row.at, total: order.total, discount });
    }
    // Khách bật báo khi shipper lấy hàng (không cần đăng nhập, cần mã của đơn)
    if (a === "push" && b === "cus" && m === "POST") {
      const { id, key, sub } = await request.json();
      const row = await db.prepare("SELECT data FROM orders WHERE id = ?").bind(str(id, 40)).first();
      if (!row || !key || JSON.parse(row.data).ckey !== key) return bad("Không tìm thấy đơn.", 404);
      if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint)) return bad("Đăng ký thông báo không hợp lệ.");
      await putKV(db, `push:cus:${str(id, 40)}:${(await sha(sub.endpoint)).slice(0, 20)}`, { sub, at: Date.now() });
      return json({ ok: true });
    }
    // Chủ quán xác nhận đã nhận tiền chuyển khoản
    if (a === "orders" && b && path[2] === "paid" && m === "POST") {
      if ((await roleOf(db, request)) !== "owner") return bad("Cần mã PIN chủ quán.", 401);
      const { paid } = await request.json();
      await db.prepare("UPDATE orders SET data = json_set(data, '$.paid', json(?)) WHERE id = ?").bind(paid ? "true" : "false", b).run();
      return json({ ok: true });
    }
    // Đổi trạng thái đơn
    if (a === "orders" && b && m === "POST") {
      const role = await roleOf(db, request);
      if (!role) return bad("Cần mã PIN.", 401);
      const { st, from } = await request.json();
      if (!STATUSES.includes(st) || (role === "ship" && !SHIP_CAN.includes(st))) return bad("Không đổi được trạng thái này.", 403);
      if (role === "owner" && st === "giao") return bad("Đơn đã giao do shipper xác nhận.", 403);
      // Chỉ đổi khi đơn vẫn đang ở trạng thái máy này nhìn thấy: tránh máy khác (màn hình cũ) kéo đơn đã giao quay lại
      const ok = { owner: { moi: ["xong", "huy"], xong: ["nau", "moi", "huy"], nau: ["xong"] }, ship: { xong: ["nau"], nau: ["giao"] } }[role];
      if (!ok[from]?.includes(st)) return bad("Đơn này vừa được đổi trên máy khác. Trang đã cập nhật lại.", 409);
      const r = await db.prepare("UPDATE orders SET st = ? WHERE id = ? AND st = ?").bind(st, b, from).run();
      if (!(r.meta?.changes ?? r.changes)) return bad("Đơn này vừa được đổi trên máy khác. Trang đã cập nhật lại.", 409);
      if (st === "xong") later(sendPush(db, "ship"));
      // Shipper đã lấy hàng: báo cho khách đã bật thông báo; giao xong thì xoá đăng ký
      if (st === "nau") later(sendPush(db, "cus:" + b));
      if (st === "giao" || st === "huy") later(db.prepare("DELETE FROM kv WHERE k LIKE ?").bind(`push:cus:${b}:%`).run());
      return json({ ok: true });
    }
    return bad("Không tìm thấy", 404);
  } catch (e) {
    return bad("Lỗi máy chủ: " + (e?.message || e), 500);
  }
}
