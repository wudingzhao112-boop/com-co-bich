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
    for (const s of o.sets || []) for (const id of s.picks || []) sold[id] = (sold[id] || 0) + (s.qty || 0);
    for (const [id, q] of Object.entries(o.extras || {})) sold[id] = (sold[id] || 0) + (q || 0);
  }
  return sold;
}
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const phoneKey = v => String(v ?? "").replace(/[\s.]/g, "");

export async function onRequest({ request, env, params }) {
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
      if (!name || !/^[0-9 +.]{9,14}$/.test(phone) || !addr) return bad("Vui lòng điền tên, số điện thoại và địa chỉ.");
      const menu = await getKV(db, "menu");
      const picks = menu?.set?.picks || 5, price = menu?.set?.price || 40000;
      const sets = (Array.isArray(body.sets) ? body.sets : []).slice(0, 30).map(s => ({
        picks: (Array.isArray(s.picks) ? s.picks : []).slice(0, picks).map(x => str(x, 40)),
        qty: Math.max(1, Math.min(50, parseInt(s.qty, 10) || 1)),
      })).filter(s => s.picks.length);
      const extras = {};
      for (const [id, q] of Object.entries(body.extras || {})) { const n = Math.min(50, parseInt(q, 10) || 0); if (n > 0) extras[str(id, 40)] = n; }
      if (!sets.length && !Object.keys(extras).length) return bad("Giỏ hàng trống.");

      const orders = await todayOrders(db), sold = soldMap(orders);
      if (menu) {
        const need = soldMap([{ sets, extras }]);
        const out = Object.entries(need).filter(([id, q]) => (menu.stock?.[id] || 0) - (sold[id] || 0) < q).map(([id]) => id);
        if (out.length) return json({ error: "Có món vừa hết, bạn chọn lại giúp quán nhé.", out }, 409);
      }
      const total = sets.reduce((s, x) => s + x.qty * price, 0)
        + Object.entries(extras).reduce((s, [id, q]) => s + q * (menu?.prices?.[id] || 0), 0);
      const no = orders.reduce((mx, o) => Math.max(mx, o.no || 0), 0) + 1;
      const id = crypto.randomUUID().slice(0, 12), at = Date.now();
      const order = { no, at, name, phone, addr, time: str(body.time, 30) || "Càng sớm càng tốt",
        pay: body.pay === "Chuyển khoản" ? "Chuyển khoản" : "Tiền mặt", paid: false, note: str(body.note, 300), sets, extras, total };
      await db.prepare("INSERT INTO orders (id, no, day, at, st, data) VALUES (?, ?, ?, ?, 'moi', ?)").bind(id, no, vnDay(at), at, JSON.stringify(order)).run();
      return json({ ok: true, id, no, total });
    }

    // Khách tích điểm theo số điện thoại: 1 suất đã giao = 1 điểm
    if (a === "me" && m === "GET") {
      const key = phoneKey(new URL(request.url).searchParams.get("phone"));
      if (!/^\+?\d{9,13}$/.test(key)) return bad("Số điện thoại không hợp lệ.");
      const { results } = await db.prepare("SELECT data, st FROM orders WHERE REPLACE(REPLACE(json_extract(data, '$.phone'), ' ', ''), '.', '') = ? AND st != 'huy'").bind(key).all();
      let points = 0, pending = 0;
      for (const r of results) {
        const n = (JSON.parse(r.data).sets || []).reduce((t, x) => t + (x.qty || 0), 0);
        if (r.st === "giao") points += n; else pending += n;
      }
      return json({ points, pending, orders: results.length });
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
      await db.prepare("UPDATE orders SET st = ? WHERE id = ?").bind(st, b).run();
      return json({ ok: true });
    }
    return bad("Không tìm thấy", 404);
  } catch (e) {
    return bad("Lỗi máy chủ: " + (e?.message || e), 500);
  }
}
