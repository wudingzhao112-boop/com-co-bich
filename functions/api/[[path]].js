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
  }
  return sold;
}
const str = (v, max) => String(v ?? "").trim().slice(0, max);

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
async function pointsOf(db, key) {
  const { results } = await db.prepare(`SELECT data, st FROM orders WHERE ${PHONE_SQL} = ? AND st != 'huy'`).bind(key).all();
  let points = 0, pending = 0;
  for (const r of results) {
    const n = (JSON.parse(r.data).sets || []).reduce((t, x) => t + (x.qty || 0), 0);
    if (r.st === "giao") points += n; else pending += n;
  }
  return { points, pending, orders: results.length };
}
const pubCus = c => ({ name: c.name, phone: c.phone, addr: c.addr });

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
      return json({ menu, sold: soldMap(orders), imgs: Object.fromEntries(imgs.results.map(r => [r.id, r.v])), day: vnDay() });
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
      const tiers = Array.isArray(menu?.tiers) && menu.tiers.length ? menu.tiers
        : [{ price: 35000, picks: 3 }, { price: 40000, picks: 4 }, { price: 50000, picks: 5 }];
      const maxPicks = Math.max(...tiers.map(t => +t.picks || 0));
      const sets = (Array.isArray(body.sets) ? body.sets : []).slice(0, 30).map(s => {
        const picks = [...new Set((Array.isArray(s.picks) ? s.picks : []).slice(0, maxPicks).map(x => str(x, 40)))];
        const canh = s.canh ? str(s.canh, 40) : "";
        return { picks, qty: Math.max(1, Math.min(50, parseInt(s.qty, 10) || 1)), price: +tiers.find(t => +t.picks === picks.length)?.price || 0, ...(canh ? { canh } : {}) };
      }).filter(s => s.picks.length);
      if (sets.some(s => !s.price)) return bad("Số món trong suất chưa đúng, bạn chọn lại giúp quán nhé.");
      const extras = {};
      for (const [id, q] of Object.entries(body.extras || {})) { const n = Math.min(50, parseInt(q, 10) || 0); if (n > 0) extras[str(id, 40)] = n; }
      if (!sets.length && !Object.keys(extras).length) return bad("Giỏ hàng trống.");

      const orders = await todayOrders(db), sold = soldMap(orders);
      if (menu) {
        const need = soldMap([{ sets, extras }]);
        const out = Object.entries(need).filter(([id, q]) => (menu.stock?.[id] || 0) - (sold[id] || 0) < q).map(([id]) => id);
        if (out.length) return json({ error: "Có món vừa hết, bạn chọn lại giúp quán nhé.", out }, 409);
      }
      const total = sets.reduce((s, x) => s + x.qty * x.price, 0)
        + Object.entries(extras).reduce((s, [id, q]) => s + q * (menu?.prices?.[id] || 0), 0);
      const no = orders.reduce((mx, o) => Math.max(mx, o.no || 0), 0) + 1;
      const id = crypto.randomUUID().slice(0, 12), at = Date.now();
      const order = { no, at, name, phone, addr, time: str(body.time, 30) || "Càng sớm càng tốt",
        pay: body.pay === "Chuyển khoản" ? "Chuyển khoản" : "Tiền mặt", paid: false, note: str(body.note, 300), sets, extras, total };
      await db.prepare("INSERT INTO orders (id, no, day, at, st, data) VALUES (?, ?, ?, ?, 'moi', ?)").bind(id, no, vnDay(at), at, JSON.stringify(order)).run();
      later(sendPush(db, "owner"));
      return json({ ok: true, id, no, total });
    }

    // Tài khoản khách: đăng ký, đăng nhập, xem và sửa thông tin (tên, địa chỉ)
    if (a === "cus" && (b === "register" || b === "login") && m === "POST") {
      const body = await request.json();
      const phone = phoneKey(body.phone), pass = String(body.pass ?? "");
      if (!/^\+?\d{9,13}$/.test(phone)) return bad("Số điện thoại chưa đúng.");
      if (pass.length < 6 || pass.length > 64) return bad("Mật khẩu từ 6 ký tự trở lên.");
      const cur = await getKV(db, "cus:" + phone);
      if (b === "register") {
        const name = str(body.name, 80), addr = str(body.addr, 200);
        if (!name) return bad("Vui lòng nhập họ tên.");
        if (addr.length < 8) return bad("Vui lòng nhập địa chỉ đầy đủ: số nhà, ngõ, đường, phường.");
        if (cur) return bad("Số điện thoại này đã có tài khoản. Bạn bấm “Đăng nhập” nhé.", 409);
        const salt = crypto.randomUUID();
        const c = { phone, name, addr, salt, hash: await passHash(pass, salt), at: Date.now() };
        await putKV(db, "cus:" + phone, c);
        return json({ token: await newSession(db, phone), me: { ...pubCus(c), ...(await pointsOf(db, phone)) } });
      }
      if (!cur || (await passHash(pass, cur.salt)) !== cur.hash) return bad("Sai số điện thoại hoặc mật khẩu.", 401);
      return json({ token: await newSession(db, phone), me: { ...pubCus(cur), ...(await pointsOf(db, phone)) } });
    }
    if (a === "cus" && b === "me") {
      const c = await cusOf(db, request);
      if (!c) return bad("Cần đăng nhập lại.", 401);
      if (m === "PUT") {
        const body = await request.json();
        const name = str(body.name, 80) || c.name, addr = str(body.addr, 200);
        if (addr.length < 8) return bad("Vui lòng nhập địa chỉ đầy đủ: số nhà, ngõ, đường, phường.");
        Object.assign(c, { name, addr });
        await putKV(db, "cus:" + c.phone, c);
      }
      return json({ me: { ...pubCus(c), ...(await pointsOf(db, c.phone)) } });
    }

    // Khách tích điểm theo số điện thoại: 1 suất đã giao = 1 điểm
    if (a === "me" && m === "GET") {
      const key = phoneKey(new URL(request.url).searchParams.get("phone"));
      if (!/^\+?\d{9,13}$/.test(key)) return bad("Số điện thoại không hợp lệ.");
      return json(await pointsOf(db, key));
    }

    // Chủ quán và shipper xem đơn hôm nay
    if (a === "orders" && !b && m === "GET") {
      const role = await roleOf(db, request);
      if (!role) return bad("Cần mã PIN.", 401);
      return json({ role, orders: await todayOrders(db) });
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
      const { st } = await request.json();
      if (!STATUSES.includes(st) || (role === "ship" && !SHIP_CAN.includes(st))) return bad("Không đổi được trạng thái này.", 403);
      if (role === "owner" && st === "giao") return bad("Đơn đã giao do shipper xác nhận.", 403);
      await db.prepare("UPDATE orders SET st = ? WHERE id = ?").bind(st, b).run();
      if (st === "xong") later(sendPush(db, "ship"));
      return json({ ok: true });
    }
    return bad("Không tìm thấy", 404);
  } catch (e) {
    return bad("Lỗi máy chủ: " + (e?.message || e), 500);
  }
}
