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

File `ANS-Video-Tools-Setup-<version>-x64.msi` được phát hành thêm để cài thủ công. Đây là MSI wrapper chạy cùng payload NSIS, nhờ đó bản cài vẫn tương thích với auto-update. Kênh cập nhật tiếp tục dùng installer `.exe`, file `.blockmap` và `latest.yml`; MSI không thay thế ba file bắt buộc này.

Không đổi tên installer sau khi build và không sửa tay `latest.yml`, vì file này chứa URL, kích thước và SHA-512 của installer.

## 3. Đưa bản mới lên GitHub Releases

1. Tạo release public với tag trùng version, ví dụ `v1.1.1`.
2. Release không được ở trạng thái Draft.
3. Đính kèm đủ installer, blockmap và `latest.yml` từ cùng một lần build.
4. Có thể dùng nội dung release làm changelog; app sẽ hiển thị nội dung này.

## 4. Hành vi trong ứng dụng

- Ngay khi mở app, tiến trình chính kiểm tra bản mới **trước mọi lần đăng nhập**, kể cả đăng nhập tự động bằng thông tin đã nhớ.
- Nếu có bản mới lúc khởi động, app tự tải, hiển thị tiến độ, cài đặt và khởi động lại; màn hình đăng nhập chỉ xuất hiện ở lần mở lại với phiên bản mới.
- Nếu đã xác định có bản mới nhưng tải/cài lỗi, app giữ màn hình cập nhật và cho thử lại, không mở đăng nhập bằng phiên bản cũ.
- Nếu metadata phiên bản/cấu hình phát hành không hợp lệ hoặc không thể xác minh an toàn, app giữ màn hình cập nhật và yêu cầu thử lại.
- Chỉ lỗi kết nối tạm thời (mất mạng, timeout, máy chủ 5xx/rate-limit) mới được ghi nhận rồi cho phép đăng nhập, để tránh khóa công cụ khi hạ tầng tạm gián đoạn.
- Sau bước kiểm tra lúc mở app, ứng dụng tiếp tục kiểm tra lại mỗi 6 giờ. Bản mới tìm thấy khi đang sử dụng vẫn được tự tải và có thể cài bằng nút **Cài đặt & khởi động lại**.
- Auto-update chỉ chạy trong bản Windows NSIS đã đóng gói/cài đặt, không chạy trong `npm run dev`.

## 5. Bảo mật phát hành

- Nên dùng HTTPS và ký code installer Windows bằng chứng thư hợp lệ.
- Nguồn cập nhật đã khóa vào repo public `tankg123/ANS-video-tools`; không nhúng GitHub token vào ứng dụng.
- Luôn phát hành installer và `latest.yml` từ cùng một build để tránh lỗi checksum.
