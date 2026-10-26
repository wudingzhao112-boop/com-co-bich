// Thông báo đẩy của app Cô Bích Quán. Vai trò lấy từ địa chỉ đăng ký: /sw.js?r=chu hoặc /sw.js?r=ship
const ROLE = new URL(self.location.href).searchParams.get("r") || "chu";
const TEXT = {
  chu: { title: "Cô Bích Quán: có đơn mới!", body: "Bấm để xem đơn và soạn cơm.", url: "/#chu" },
  ship: { title: "Có đơn soạn xong, đi giao!", body: "Bấm để xem địa chỉ và lấy đơn.", url: "/#shipper" },
};
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let t = TEXT[ROLE] || TEXT.chu;
  try { const d = e.data && e.data.json(); if (d) t = { ...t, ...d }; } catch (_) {}
  e.waitUntil(self.registration.showNotification(t.title, {
    body: t.body, icon: "/icon-192.png", badge: "/icon-192.png", tag: "cobich-" + ROLE, renotify: true,
    vibrate: [300, 100, 300, 100, 300], requireInteraction: true, data: { url: t.url },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
