SM Scanner PWA — iPhone

Chức năng:
- Mở camera sau của iPhone.
- Chụp tem và OCR số dạng "5.28 SM".
- Tự cộng tổng SM.
- Cố gắng đọc chuỗi số dài trên tem để chống quét trùng.
- Lưu dữ liệu bằng localStorage.
- Hoàn tác, xóa hết, xuất CSV.
- Có thể Thêm vào Màn hình chính như app.

QUAN TRỌNG:
Camera trực tiếp trong Safari/PWA cần trang chạy bằng HTTPS.
Không nên mở index.html trực tiếp từ ứng dụng Files nếu muốn dùng camera trực tiếp.

Cách dễ nhất để chạy:
1. Giải nén thư mục này.
2. Đưa 4 file web lên một hosting HTTPS như GitHub Pages, Netlify hoặc Vercel.
3. Mở đường dẫn bằng Safari trên iPhone.
4. Chọn Chia sẻ > Thêm vào Màn hình chính.
5. Mở SM Scanner từ màn hình chính và cấp quyền Camera.

Nếu chưa host HTTPS:
- Nút "Chụp / chọn ảnh" vẫn có thể dùng trên trình duyệt trong nhiều trường hợp,
  nhưng cách ổn định nhất vẫn là host HTTPS.

OCR:
Ứng dụng dùng Tesseract.js từ CDN. Lần đầu sử dụng cần Internet để tải bộ OCR.
Độ chính xác phụ thuộc ánh sáng, độ nét, góc chụp và cách in tem.
