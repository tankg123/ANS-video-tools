# Phát hành và tự cập nhật ANS Video Tools

Từ phiên bản **1.1.0**, bản Windows đã cài đặt có thể tự kiểm tra, tải và cài phiên bản mới.
Phiên bản 1.0.0 chưa có updater nên người dùng cần cài 1.1.0 thủ công một lần; các bản sau sẽ tự cập nhật.

## 1. Nguồn cập nhật cố định

Nguồn cập nhật được khóa trực tiếp trong mã và không thể thay đổi từ giao diện:

`https://github.com/tankg123/ANS-video-tools/releases`

Repo này phải luôn ở chế độ **Public**. Ứng dụng không nhận URL cập nhật từ settings người dùng,
nhờ đó không thể bị chuyển sang máy chủ cập nhật khác từ trong Tools.

## 2. Tạo phiên bản mới

Sau khi hoàn tất code và kiểm thử, chạy một trong các lệnh:

```powershell
npm run release:patch  # 1.1.0 -> 1.1.1
npm run release:minor  # 1.1.0 -> 1.2.0
npm run release:major  # 1.1.0 -> 2.0.0
```

Mỗi lệnh tự cập nhật version trong `package.json`/`package-lock.json`, build app và tạo bộ phát hành trong `release/`.

Các file bắt buộc phải phát hành cùng nhau:

- `ANS-Video-Tools-Setup-<version>-x64.exe`
- `ANS-Video-Tools-Setup-<version>-x64.exe.blockmap`
- `latest.yml`

Không đổi tên installer sau khi build và không sửa tay `latest.yml`, vì file này chứa URL, kích thước và SHA-512 của installer.

## 3. Đưa bản mới lên GitHub Releases

1. Tạo release public với tag trùng version, ví dụ `v1.1.1`.
2. Release không được ở trạng thái Draft.
3. Đính kèm đủ installer, blockmap và `latest.yml` từ cùng một lần build.
4. Có thể dùng nội dung release làm changelog; app sẽ hiển thị nội dung này.

## 4. Hành vi trong ứng dụng

- Tự kiểm tra sau khi mở app khoảng 10 giây và kiểm tra lại mỗi 6 giờ.
- Khi có bản mới, app tự tải và hiển thị phần trăm/tốc độ.
- Khi tải xong, người dùng có thể bấm **Cài đặt & khởi động lại**.
- Nếu người dùng đóng app sau khi tải xong, bản mới cũng được tự cài.
- Auto-update chỉ chạy trong bản Windows NSIS đã đóng gói/cài đặt, không chạy trong `npm run dev`.

## 5. Bảo mật phát hành

- Nên dùng HTTPS và ký code installer Windows bằng chứng thư hợp lệ.
- Nguồn cập nhật đã khóa vào repo public `tankg123/ANS-video-tools`; không nhúng GitHub token vào ứng dụng.
- Luôn phát hành installer và `latest.yml` từ cùng một build để tránh lỗi checksum.
