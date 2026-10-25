# Cơm Cô Bích Quán – app đặt cơm

Ba trang trên cùng một link:
- `/` – khách xem món, đặt cơm (không cần đăng nhập)
- `/#chu` – chủ quán: đơn hàng, tiền, bật/tắt món, số suất (mã PIN chủ quán)
- `/#shipper` – shipper: đơn xếp theo giờ, đơn gấp lên đầu (mã PIN shipper)

Chạy trên Cloudflare Pages + D1 (binding `DB`, xem `wrangler.toml`, bảng trong `schema.sql`).
Lần đầu mở `/#chu` sẽ hỏi tạo 2 mã PIN.

Sửa giao diện trong `src/app.html` rồi chạy `python3 build.py` để tạo `public/index.html`.
