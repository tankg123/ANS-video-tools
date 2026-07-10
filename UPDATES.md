# Phát hành và tự cập nhật ANS Video Tools

Từ phiên bản **1.1.0**, bản Windows đã cài đặt có thể tự kiểm tra, tải và cài phiên bản mới.
Phiên bản 1.0.0 chưa có updater nên người dùng cần cài 1.1.0 thủ công một lần; các bản sau sẽ tự cập nhật.

## 1. Chọn nguồn cập nhật

Trong **Cài đặt → Nguồn tự cập nhật**, nhập một trong hai dạng:

- GitHub public repository/release: `https://github.com/OWNER/REPO/releases`
- GitHub Releases API: `https://api.github.com/repos/OWNER/REPO/releases/latest`
- Generic HTTPS feed: `https://updates.example.com/ans-video-tools/`

Generic feed phải phục vụ các file phát hành trong cùng một thư mục qua HTTPS.

## 2. Tạo phiên bản mới

Sau khi hoàn tất code và kiểm thử, chạy một trong các lệnh:

```powershell
npm run release:patch  # 1.1.0 -> 1.1.1
npm run release:minor  # 1.1.0 -> 1.2.0
npm run release:major  # 1.1.0 -> 2.0.0
```

Mỗi lệnh tự cập nhật version trong `package.json`/`package-lock.json`, build app và tạo bộ phát hành trong `release/`.

Các file bắt buộc phải phát hành cùng nhau:

- `ANS Video Tools-Setup-<version>-x64.exe`
- `ANS Video Tools-Setup-<version>-x64.exe.blockmap`
- `latest.yml`

Không đổi tên installer sau khi build và không sửa tay `latest.yml`, vì file này chứa URL, kích thước và SHA-512 của installer.

## 3. Đưa bản mới lên máy chủ

### GitHub Releases

1. Tạo release public với tag trùng version, ví dụ `v1.1.1`.
2. Release không được ở trạng thái Draft.
3. Đính kèm đủ installer, blockmap và `latest.yml` từ cùng một lần build.
4. Có thể dùng nội dung release làm changelog; app sẽ hiển thị nội dung này.

### Generic HTTPS server

Upload đủ ba file vào đúng thư mục đã cấu hình trong app. Máy chủ phải cho tải trực tiếp `latest.yml`, installer và blockmap, không yêu cầu trang đăng nhập HTML.

## 4. Hành vi trong ứng dụng

- Tự kiểm tra sau khi mở app khoảng 10 giây và kiểm tra lại mỗi 6 giờ.
- Khi có bản mới, app tự tải và hiển thị phần trăm/tốc độ.
- Khi tải xong, người dùng có thể bấm **Cài đặt & khởi động lại**.
- Nếu người dùng đóng app sau khi tải xong, bản mới cũng được tự cài.
- Auto-update chỉ chạy trong bản Windows NSIS đã đóng gói/cài đặt, không chạy trong `npm run dev`.

## 5. Bảo mật phát hành

- Nên dùng HTTPS và ký code installer Windows bằng chứng thư hợp lệ.
- Chỉ dùng GitHub repository public cho client auto-update; không nhúng GitHub token vào ứng dụng.
- Luôn phát hành installer và `latest.yml` từ cùng một build để tránh lỗi checksum.
