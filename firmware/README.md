# InkBoard 墨水屏固件

ESP32 墨水屏固件（基于 InkSight 固件修改）。连上 WiFi 后定时从 InkBoard 后端取一帧画面显示，然后深度睡眠省电。

- 使用说明（从刷固件到日常使用）：[`../docs/使用说明.md`](../docs/使用说明.md)
- 后端：[`../server/README.md`](../server/README.md)

## 我们的硬件

| 屏幕 | 开发板 | PlatformIO 环境 |
|---|---|---|
| 3.98" SE0398NZ07 A0，768×552，黑白黄红 | ESP32-C3 promini | `epd_398_se0398nz07a0_c3_promini` |
| 3.98" SE0398NZ07 **A1**（同一块屏的另一版驱动芯片 JD79661，排线上印着 A1） | ESP32-C3 promini | `epd_398_se0398nz07a1_c3_promini`（未在真机验证） |
| 4.2" HINK SSD1683，400×300，黑白红 | ESP32-C3 promini | `epd_42_hink_ssd1683_c3_promini` |

变体：`_led5`（LED 接 GPIO5 的旧板，新板 LED 在 GPIO3）、`_test`（每 1 分钟唤醒，配合 `tools/mock_server.py` 做功能测试）、
`_selftest`（不联网，显示 1px 线条 / 文字 / 四色测试图）。

## 支持的屏幕

除 2.9" 外，每种屏都有后端的画面和本地日历（离线、只当日历用），日历和服务器逐像素相同（`tools/calendar_test`）。
上游的面板和开发板在 `boards/other_panels.ini`。C3 板的环境都有 `_led5` 变体。

| 屏幕 | 颜色 | 环境 | 联网画面 / 本地日历怎么上屏（内存） | 真机 |
|---|---|---|---|---|
| 3.98" SE0398NZ07 A0 | 黑白黄红 | `epd_398_se0398nz07a0_c3_promini`、`_wroom32e` | 逐行写进屏幕；日历 24 行一段画（4.6 KB） | ✅ |
| 3.98" SE0398NZ07 A1 | 黑白黄红 | `epd_398_se0398nz07a1_c3_promini` | 同上 | 未验证 |
| 4.2" HINK SSD1683 | 黑白红 | `epd_42_hink_ssd1683_c3_promini`、`_wroom32e` | 逐行写进屏幕；日历分段（2.4 KB） | ✅ |
| 5.83" UC8179（微雪 V2） | 黑白红 | `epd_583_uc8179_bwr_c3_promini`、`_bwr_wroom32e` | 黑白平面逐行写进屏幕，红色平面留在内存（39 KB）；日历分段 | 未验证 |
| 7.5" GDEY075Z08（UC8179） | 黑白红 | `epd_75_uc8179_c3_promini`、`_wroom32e` | 同上，红色平面 48 KB | 未验证 |
| 4.2" GDEM042F52（JD79668） | 黑白黄红 | `epd_42_gdem042f52_jd79668_c3_promini`、`_c3_std`、`_wroom32e` | 整帧颜色缓冲 30 KB | 未验证 |
| 4.2" DKE DEPG0420RY683 | 黑白黄红 | `epd_42_depg0420ry683_ssd1683_c3_promini` | 整帧颜色缓冲 30 KB | 未验证 |
| 4.2" WFT0420CZ15 | 黑白红 | `epd_42_wft0cz15_bwr_c3_promini`、`_c3_std`、`_c3_wroom02`、`_wroom32e` | 颜色缓冲 30 KB，刷新时再临时用 30 KB | 未验证 |
| 4.2" 黑白屏 | 黑白 | 微雪 V2 SSD1683（`epd_42_wsv2_ssd1683_*`、`epd_42_wroom32e_ai_chat`、`_vocab_review`）、中景园 SSD1683（`epd_42_zhongjingyuan_bw_ssd1683_*`）、中景园 GYE042A87（`epd_42_zhongjingyuan_bw_gxepd2_gye042a87_*`）、GDEY042T81、GDEW042T2、GDEW042M01（`epd_42_gxepd2_*`）、WFT0420CZ15 黑白（`epd_42_wft0cz15_bw_*`） | 固件本来就有的黑白帧缓冲 15 KB | 未验证 |
| 5.83" 黑白屏 | 黑白 | `epd_583_c3_promini`、`epd_583_wroom32e`；UC8179 三色屏当黑白用：`epd_583_uc8179_c3_promini`、`_c3_std`、`_c3_wroom02`、`_wroom32e` | 黑白帧缓冲 38 KB | 未验证 |
| 7.5" 黑白屏 | 黑白 | `epd_75_c3_promini`、`epd_75_wroom32e` | 黑白帧缓冲 48 KB | 未验证 |
| 2.9"（296×128） | 黑白 | `epd_29_c3_promini`、`_wroom32e` | 不适配：后端版面排不下，没有本地日历 | — |

"逐行写进屏幕"的屏下载画面时不用整帧缓冲，HTTPS（每条连接约 45–50 KB）的余量最大。黑白屏的帧缓冲是固定分配的，
画面和本地日历都画在里面，不另外占内存。彩色屏的红色是服务器按面板换好的：三色屏的黄色显示成红色，黑白屏的红、黄显示成黑色。

## 编译和上传

需要 [PlatformIO](https://platformio.org/)（VS Code 插件或命令行）。用 USB 线连上开发板，在 `firmware` 目录打开 PowerShell。
下面的 `$pio` 是 PlatformIO 自带的命令行（VS Code 插件安装后就有）：

```powershell
$pio = "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"
& $pio run -e epd_398_se0398nz07a0_c3_promini -t upload     # 3.98" 屏：编译并上传
& $pio run -e epd_42_hink_ssd1683_c3_promini -t upload      # 4.2" 屏
```

其它常用命令：

| 命令 | 作用 |
|---|---|
| `& $pio run` | 只编译两块屏的固件（不上传） |
| `& $pio device monitor -b 115200` | 串口日志（Ctrl+C 退出） |
| `... -t upload --upload-port COM5` | 指定串口（同时插着几块板时，串口号在设备管理器"端口"里看） |
| `& $pio run -e <环境> -t erase` | 擦除整片 Flash（清掉保存的 WiFi 和服务器地址），之后再上传 |

环境名后加 `_test`（每 1 分钟唤醒的功能测试版）、`_selftest`（屏幕自检图）或 `_led5`（LED 接 GPIO5 的旧板），
例如 `epd_398_se0398nz07a0_c3_promini_selftest`。

**连不上串口时**：按住 BOOT，按一下 RESET，松开 BOOT，再上传（进入下载模式）；上传完按一下 RESET。

编译结果在 `.pio/build/<环境>/`：`firmware.bin`（应用）和 `firmware_merged.bin`（含引导程序和分区表，
可以用 [ESP 网页刷机工具](https://espressif.github.io/esptool-js/) 从地址 `0x0` 烧录，不用装开发环境）。

## 按键和指示灯

| 操作 | 作用 |
|---|---|
| 按一下 RESET | 立即唤醒并刷新画面 |
| 醒着时长按 BOOT 2 秒（或按 RESET 后马上按住 BOOT 直到 LED 常亮） | 进入配网模式 |
| 配网模式下短按 BOOT | 跳过配网，显示本地日历 |

| LED | 含义 |
|---|---|
| 常亮 | 配网模式，等手机连接热点 `InkBoard-XXXX`（10 分钟没人操作改为显示日历） |
| 慢闪 | 正在连接 WiFi |
| 亮 1 秒 | 刷新成功，随后进入睡眠 |
| 快闪 5 下 | 失败（WiFi 或服务器连不上），稍后自动重试 |

配网模式 10 分钟没人操作会自动睡眠（WiFi 连不上自动进入的配网模式为 3 分钟）。

## 离线日历

固件里有一份和服务器完全相同的月历（`src/calendar_render.cpp`，数据和字形在 `src/calendar_data.h`，覆盖 2025–2074 年）：

- **连不上 WiFi 或后端**：显示本地日历，有缓存的留言板时和它轮流显示；重试间隔 15 分钟到 3 小时逐步拉长，零点后必醒。
  所有屏（2.9" 除外）都有；各屏的日历怎么上屏、占多少内存见上面的"支持的屏幕"。
- **只当日历用**：配网页的按钮、配网模式下短按 BOOT、或配网超时（且没有可用的 WiFi）都会进入；每天零点后醒一次。
- **时钟**：中国时间；联网时取服务器回应的 `Date`，没有再用 NTP（阿里云 / 腾讯 / pool），配网页打开时取手机时间；
  深度睡眠的计时偏差由每次对时测出并补偿（`src/offline_calendar.cpp`）。
- **节假日**：编译时带上已公布的年份；之后每年联网时从后端 `/api/holidays/<年>` 取一次新的一年。
- **Flash 写入**：只保存留言板这一帧（内容变了才写）；联网画面直接逐行写进屏幕，不经过 Flash。
- **整点刷新**：时钟对准后，醒来时间对齐到刷新间隔的整倍数（15 分钟 → 每小时 :00 :15 :30 :45，2 小时 → 偶数整点），
  再晚 30 秒，所以课程、日程开始时屏幕就换好了。

服务器的日历版式或节假日数据变了：在 `server` 运行 `npx tsx scripts/export-firmware-calendar.ts` 重新生成
`calendar_data.h`，再按 `tools/calendar_test/README.md` 逐像素对比一遍。

## 内存、Flash 和 HTTPS

- HTTPS 每条连接要约 45–50 KB 内存（框架预编译的 16 KB 收 / 16 KB 发缓冲，无法调小），所以画面不放整帧缓冲：
  每收到一行就写进屏幕控制器的显存（3.98 寸 192 字节一行；4.2 寸 100 字节一行，拆成黑白和红两个平面），收完再刷新。
  5.83" / 7.5" UC8179：黑白平面逐行写进屏幕，红色平面先留在内存里（整帧的一半），收完再写入。
  本地日历和离线留言在 WiFi 关闭后才画，那时才用整帧缓冲。
- 请求带 `If-None-Match`（屏上那帧的 `ETag`），画面没变时服务器回 304：不下载、不刷新、不写 Flash。
  只有刚下载并显示的画面才记下 `ETag`，显示其它内容（日历、缓存的留言、配网画面）时清掉。
- Flash 只在留言板的 `ETag` 变化时写一次（`/msg.raw`），其它画面从不落盘。
- 证书：固件带 38 个常用公共根证书（Let's Encrypt X1/X2、谷歌 GTS、亚马逊、DigiCert/GeoTrust/RapidSSL、Sectigo/ZeroSSL、GlobalSign、
  GoDaddy、Entrust、Certum、SSL.com、微软等，约 17 KB），用 ESP-IDF 证书包格式存放（`src/cert_bundle.cpp`）：
  握手时只按服务器证书链的签发者查一个根，不会因为根多而多占内存。
  根证书放在 `tools/certs/`（取自 Windows 受信任根证书库，按白名单挑选），加一个就把它的文件放进去再运行
  `python tools/make_cert_bundle.py`；`python tools/check_cert_bundle.py <中间证书目录>` 用设备的查找方式逐个验签。
  这个框架不校验证书有效期，所以断电后时钟不准不影响 HTTPS。

## 配网页

热点 `InkBoard-XXXX`（XXXX 是 MAC 地址最后两段），连上后打开 `http://192.168.4.1`。
页面在 `data/portal_html.h`，接口在 `src/portal.cpp`：`/scan`、`/info`、`/save_wifi`、`/connect_saved`、`/add_wifi`、
`/delete_wifi`、`/wifi_list`、`/restart`、`/reset_portal`、`/settime`（手机时间）、`/calendar_only`。最多保存 5 个 WiFi，开机按顺序尝试。

## 代码结构

| 文件 | 内容 |
|---|---|
| `src/main.cpp` | 启动、状态机、按键、深度睡眠 |
| `src/network.cpp` | WiFi、与后端通信（注册、心跳、取画面） |
| `src/portal.cpp`、`data/portal_html.h` | 配网热点和网页 |
| `src/display.cpp`、`src/epd_driver*.cpp` | 显示和各面板驱动（`epd_driver_398_se0398nz07a0.cpp`（A0 / A1）、`epd_driver_hink_ssd1683.cpp`、`epd_driver_uc8179.cpp`，其余上游面板在 `epd_driver.cpp`） |
| `src/storage.cpp` | 保存的 WiFi、服务器地址、配对码 |
| `src/offline_calendar.cpp` | 时钟、离线日历、只当日历用、留言缓存、节假日更新 |
| `src/calendar_render.cpp`、`src/calendar_data.h` | 本地月历（服务器日历的 C++ 移植）和它的数据 |
| `src/offline_cache.cpp` | 文件缓存（其它面板离线时显示上一帧） |
| `src/selftest.cpp` | `_selftest` 环境的测试图 |
| `src/config.h` | 引脚、超时等常量 |
| `src/cert_bundle.*`、`tools/certs/`、`tools/make_cert_bundle.py` | HTTPS 信任的根证书 |
| `tools/make_setup_screen.py`、`src/setup_screen_data.h` | 配网时屏幕上显示的画面：热点名称、要打开的地址和提示（生成的压缩图） |
| `tools/mock_server.py` | 测试用的假后端 |
