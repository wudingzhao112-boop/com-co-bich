// Thành viên: khách đăng nhập bằng số điện thoại để tích điểm (1 suất đã giao = 1 điểm).
// Lời mời hiện lúc khách bấm "Đặt ngay", kèm số điểm đơn này sẽ được.
const MEM = "cobich-khach";
function memGet() { try { return JSON.parse(localStorage.getItem(MEM) || "null"); } catch (_) { return null; } }
const memSet = v => { try { if (v) localStorage.setItem(MEM, JSON.stringify(v)); else localStorage.removeItem(MEM); } catch (_) {} };
let guest = false;
try { guest = sessionStorage.getItem("cobich-guest") === "1"; } catch (_) {}
async function renderMember() {
  const k = memGet(), n = setCount(cart);
  const state = k?.phone ? "in" : guest ? "guest" : "ask";
  ["ask", "in", "guest"].forEach(s => $("mem-" + s).hidden = s !== state);
  $("mem-ask-title").textContent = n ? `Đơn này được +${n} điểm. Tích ngay!` : "Tích điểm nhận quà tri ân";
  $("mem-top").hidden = mode !== "khach" || editMode || !k?.phone;
  if (state !== "in") return;
  $("mem-hi").textContent = $("mem-top-hi").textContent = `Chào ${k.name || "bạn"}`;
  $("mem-sub").textContent = n ? `Đơn này được +${n} điểm khi giao xong.` : "Mỗi suất cơm = 1 điểm, dùng đổi quà tri ân của quán.";
  try {
    const d = await api("me?phone=" + encodeURIComponent(k.phone));
    $("mem-pts").textContent = $("mem-top-pts").textContent = `${d.points} điểm`;
  } catch (_) { $("mem-pts").textContent = $("mem-top-pts").textContent = ""; }
}
$("m-go").onclick = () => {
  const phone = $("m-phone").value.trim(), name = $("m-name").value.trim();
  if (!/^[0-9 +.]{9,14}$/.test(phone)) { $("m-err").textContent = "Số điện thoại chưa đúng."; $("m-err").hidden = false; return; }
  $("m-err").hidden = true;
  memSet({ name, phone, addr: memGet()?.addr || "" });
  $("f-phone").value = phone; if (name) $("f-name").value = name;
  renderMember();
};
$("m-skip").onclick = () => { guest = true; try { sessionStorage.setItem("cobich-guest", "1"); } catch (_) {} renderMember(); };
$("m-login").onclick = () => { guest = false; try { sessionStorage.removeItem("cobich-guest"); } catch (_) {} renderMember(); $("m-phone").focus(); };
$("m-out").onclick = () => { memSet(null); $("f-name").value = $("f-phone").value = $("f-addr").value = ""; $("m-phone").value = $("m-name").value = ""; renderMember(); };
$("go").addEventListener("click", renderMember);
renderMember();
