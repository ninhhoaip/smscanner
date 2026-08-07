SM Scanner PWA v2

Điểm cải tiến:
- OCR Worker chỉ khởi tạo 1 lần, không tải lại mỗi lần quét.
- Tự quét khoảng mỗi 0,9 giây.
- Ảnh được phóng to 2x và tăng tương phản trước OCR.
- Cần nhận cùng một kết quả 2 lần liên tiếp trước khi cộng để giảm đọc nhầm.
- Không cộng lại cùng tem khi vẫn đang nằm trước camera.
- Nếu OCR đọc được mã dài trên tem, app chống quét trùng theo mã.

Cập nhật GitHub Pages:
1. Vào repository cũ.
2. Thay index.html, app.js, manifest.webmanifest, sw.js bằng các file trong gói này.
3. Commit changes.
4. Đợi GitHub Pages cập nhật 1-2 phút.
5. Trên iPhone đóng hẳn app web rồi mở lại. Nếu vẫn thấy bản cũ, Safari > xóa dữ liệu website của trang hoặc đổi URL thêm ?v=2 một lần.
