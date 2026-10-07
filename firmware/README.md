# InkBoard 固件

ESP32 墨水屏的固件，在 InkSight 固件的基础上改的。它做的事情很简单：醒来，连 WiFi，从后端取一张画面显示，然后深度睡眠，到点再醒。

使用说明在 [docs/使用说明.md](../docs/使用说明.md)，后端在 [server/](../server/README.md)。

## 我自己用的硬件

开发板都是 ESP32-C3 promini，屏有两块：

| 屏幕 | 编译环境 |
|---|---|
| 3.98 寸 SE0398NZ07 A0，768×552，黑白黄红 | `epd_398_se0398nz07a0_c3_promini` |
| 4.2 寸 HINK SSD1683，400×300，黑白红 | `epd_42_hink_ssd1683_c3_promini` |

3.98 寸还有一个 A1 版（驱动芯片是 JD79661，排线上印着 A1），对应 `epd_398_se0398nz07a1_c3_promini`。驱动按参考资料写好了，但我手上没有 A1 的屏，没测过。

每个环境还有几个变体：`_led5` 是给 LED 接在 GPIO5 上的旧板子用的（新板子的 LED 在 GPIO3）；`_test` 每分钟醒一次，配合 `tools/mock_server.py` 测功能；`_selftest` 不联网，直接显示一张 1 像素线条、小字和四色色块的测试图，用来看屏幕本身的显示效果。

## 支持的屏幕

上游支持的面板和开发板都在 `boards/other_panels.ini` 里，C3 的环境都带 `_led5` 变体。`_yd_s3_n16r8` 是 YD-ESP32-S3 N16R8 开发板（引脚见 `src/config.h`，串口日志走板上的 USB 转串口口），还没在真机上试过。除了 2.9 寸，每种屏都能显示后端的画面，也都有离线日历，日历和服务器画的一个像素都不差（用 `tools/calendar_test` 对比过）。

| 屏幕 | 颜色 | 编译环境 | 画面怎么写进屏幕 | 实测 |
|---|---|---|---|---|
| 3.98 寸 SE0398NZ07 A0 | 黑白黄红 | `epd_398_se0398nz07a0_c3_promini`、`_wroom32e`、`_yd_s3_n16r8` | 收一行写一行，不占整帧内存 | 是 |
| 3.98 寸 SE0398NZ07 A1 | 黑白黄红 | `epd_398_se0398nz07a1_c3_promini`、`_yd_s3_n16r8` | 同上 | 否 |
| 4.2 寸 HINK SSD1683 | 黑白红 | `epd_42_hink_ssd1683_c3_promini`、`_wroom32e`、`_yd_s3_n16r8` | 收一行写一行 | 是 |
| 5.83 寸 UC8179（微雪 V2） | 黑白红 | `epd_583_uc8179_bwr_c3_promini`、`_bwr_wroom32e` | 黑白部分逐行写，红色部分先放内存（39 KB） | 否 |
| 7.5 寸 GDEY075Z08 | 黑白红 | `epd_75_uc8179_c3_promini`、`_wroom32e` | 同上，红色部分 48 KB | 否 |
| 4.2 寸 GDEM042F52 | 黑白黄红 | `epd_42_gdem042f52_jd79668_c3_promini`、`_c3_std`、`_wroom32e` | 整帧放内存，30 KB | 否 |
| 4.2 寸 DKE DEPG0420RY683 | 黑白黄红 | `epd_42_depg0420ry683_ssd1683_c3_promini` | 整帧放内存，30 KB | 否 |
| 4.2 寸 WFT0420CZ15 | 黑白红 | `epd_42_wft0cz15_bwr_c3_promini`、`_c3_std`、`_c3_wroom02`、`_wroom32e` | 30 KB，刷新时再临时用 30 KB | 否 |
| 4.2 寸黑白屏 | 黑白 | 微雪 V2（`epd_42_wsv2_ssd1683_*`）、中景园（`epd_42_zhongjingyuan_bw_*`）、GDEY042T81 / GDEW042T2 / GDEW042M01（`epd_42_gxepd2_*`）、WFT0420CZ15 黑白（`epd_42_wft0cz15_bw_*`） | 用固件本来就有的 15 KB 黑白缓冲 | 否 |
| 5.83 寸黑白屏 | 黑白 | `epd_583_c3_promini`、`epd_583_wroom32e`，以及把 UC8179 三色屏当黑白用的 `epd_583_uc8179_*` | 38 KB 黑白缓冲 | 否 |
| 7.5 寸黑白屏 | 黑白 | `epd_75_c3_promini`、`epd_75_wroom32e` | 48 KB 黑白缓冲 | 否 |
| 2.9 寸 | 黑白 | `epd_29_c3_promini`、`_wroom32e` | 没有适配：后端的版面放不下，也没有离线日历 | — |

逐行写入的好处是下载画面时不用留整帧的内存，走 HTTPS 时余量最足（一条 HTTPS 连接本身就要 45 到 50 KB）。颜色由后端按面板换算好：三色屏上黄色显示成红色，黑白屏上红和黄都显示成黑色。

## 编译和上传

需要装 [PlatformIO](https://platformio.org/)，VS Code 插件或者命令行版都行。USB 线连上板子，在 `firmware` 目录下：

```powershell
$pio = "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"
& $pio run -e epd_398_se0398nz07a0_c3_promini -t upload   # 3.98 寸
& $pio run -e epd_42_hink_ssd1683_c3_promini -t upload    # 4.2 寸
```

`$pio` 就是 PlatformIO 自带的命令行，装了 VS Code 插件就有。其它常用的：

| 命令 | 作用 |
|---|---|
| `& $pio run` | 只编译，不上传 |
| `& $pio device monitor -b 115200` | 看串口日志，Ctrl+C 退出 |
| 命令后面加 `--upload-port COM5` | 同时插着几块板子时指定串口，串口号在设备管理器的"端口"里 |
| `& $pio run -e <环境> -t erase` | 把 Flash 整个擦掉（保存的 WiFi 和服务器地址也没了），之后重新上传 |

如果连不上串口，按住 BOOT，按一下 RESET，再松开 BOOT，这样就进了下载模式，然后再上传，传完按一下 RESET。

编译出来的文件在 `.pio/build/<环境>/` 下。`firmware_merged.bin` 已经把引导程序和分区表合在一起了，没装开发环境的电脑可以用 [ESP 网页刷机工具](https://espressif.github.io/esptool-js/) 从地址 `0x0` 直接烧。

## 按键和指示灯

板子上只有 RESET 和 BOOT 两个键。按一下 RESET 会马上醒来刷新。想进配网模式，可以在醒着时按住 BOOT 两秒，或者按完 RESET 立刻按住 BOOT，直到 LED 常亮。配网模式下短按一下 BOOT，就跳过配网直接显示日历。

LED 常亮表示在配网模式，等手机连热点 `InkBoard-XXXX`；慢闪是在连 WiFi；亮一秒后熄灭表示刷新成功，接着就睡了；快闪五下是失败了，WiFi 或服务器连不上，过一会儿会自己再试。

配网模式没人管的话，10 分钟后自动转成显示日历；如果是因为连不上 WiFi 才进的配网模式，3 分钟就转。

## 离线日历

固件里有一份和服务器完全一样的月历，代码在 `src/calendar_render.cpp`，数据和字形在 `src/calendar_data.h`，能用到 2074 年。

连不上 WiFi 或者后端的时候，屏幕就显示这份日历；如果之前收到过留言，会和留言板轮流显示。重试的间隔从 15 分钟开始慢慢拉长，最长 3 小时，但每天零点过后一定会醒来翻到新的一天。

屏幕竖着放的时候（后台"设备"里选了纵向），离线日历也是竖版，和服务器的竖版月历一样；方向是后端在每次回应里告诉板子的（`X-Orientation`），板子记在 Flash 里。配网画面只有横版，屏幕怎么放都一样。

也可以干脆不联网，只当日历用：在配网页上点"只当日历用"，或者配网时短按 BOOT，又或者配网超时而且没有能用的 WiFi，都会进这个模式。之后每天只在零点后醒一次。

几个细节：

- 时间按中国时区。联网时用服务器回应头里的 `Date` 对时，没有的话再用 NTP（阿里云、腾讯和 pool.ntp.org），打开配网页时也会用手机的时间对一次。板子没有时钟晶振，深度睡眠时会走偏，每次对时都会测出偏差，下次睡眠时补回来。
- 节假日：编译时把已经公布的年份打进去，以后每年联网时从后端的 `/api/holidays/<年份>` 取一次新的。
- Flash 只存留言板那一帧，而且只在内容变了的时候写。联网取到的画面直接写进屏幕，不经过 Flash。
- 时钟对准以后，醒来的时间会对齐到整点：后端在回应头 `X-Next-Wake` 里给出下一次该醒的时刻（白天每 15 分钟、夜里每 2 小时，早上到点开始），板子睡到那个时刻再晚 30 秒。比如每 15 分钟一次，就在每小时的 0、15、30、45 分过半分钟醒，这样课程表、日程到点就已经换好了。下载和刷屏花的时间不影响醒来的时刻。连的是不带这个头的后端时，按刷新间隔自己对齐。

后端的日历版式或者节假日数据改了以后，在 `server` 里运行 `npx tsx scripts/export-firmware-calendar.ts` 重新生成 `calendar_data.h`，然后照 `tools/calendar_test/README.md` 逐像素对比一遍。

## 内存、Flash 和 HTTPS

一条 HTTPS 连接大约要 45 到 50 KB 内存，是框架里固定的 16 KB 收和 16 KB 发缓冲，调不小。所以画面不整帧存着，每收到一行就写进屏幕控制器自己的显存：3.98 寸一行 192 字节，4.2 寸一行 100 字节（拆成黑白和红两层写）。5.83 寸和 7.5 寸的 UC8179 是黑白层逐行写进去，红色层先在内存里攒着，收完再写。离线日历和缓存的留言是在关掉 WiFi 以后才画的，那时候才会用到整帧的缓冲。

请求画面时会带上 `If-None-Match`（屏幕上当前那一帧的 `ETag`）。画面没变，服务器就回 304，屏幕不下载、不刷新，也不写 Flash。只有刚下载并显示出来的画面才会记下 `ETag`；如果屏幕显示的是别的东西（日历、缓存的留言、配网画面），就把它清掉，下次照常下载。

证书方面，固件带了 38 个常用的根证书，大约 17 KB，用 ESP-IDF 的证书包格式存在 `src/cert_bundle.cpp` 里。握手时按服务器证书链的签发者只查一个根，所以证书多了也不额外占内存。这些根证书放在 `tools/certs/`，是从 Windows 的受信任根证书里按名单挑出来的；要加一个，把它的文件放进去，再运行 `python tools/make_cert_bundle.py`。`python tools/check_cert_bundle.py <中间证书目录>` 会按设备的查找方式逐个验一遍签名。这个框架不检查证书有效期，所以断电后时钟不准也不影响 HTTPS。

## 配网页

热点名是 `InkBoard-XXXX`，XXXX 是 MAC 地址的最后两段。连上以后打开 `http://192.168.4.1`。

页面在 `data/portal_html.h`，接口在 `src/portal.cpp`：`/scan`、`/info`、`/save_wifi`、`/connect_saved`、`/add_wifi`、`/delete_wifi`、`/wifi_list`、`/restart`、`/reset_portal`、`/settime`（用手机时间对时）和 `/calendar_only`。最多存 5 个 WiFi，开机按顺序挨个试。

## 代码结构

| 文件 | 内容 |
|---|---|
| `src/main.cpp` | 启动流程、状态机、按键、深度睡眠 |
| `src/network.cpp` | WiFi 和跟后端打交道：注册、心跳、取画面 |
| `src/portal.cpp`、`data/portal_html.h` | 配网热点和网页 |
| `src/display.cpp`、`src/epd_driver*.cpp` | 显示和各种屏的驱动。3.98 寸（A0 和 A1）、4.2 寸 HINK、UC8179 各有单独的文件，其它上游的屏在 `epd_driver.cpp` 里 |
| `src/storage.cpp` | 存 WiFi、服务器地址和配对码 |
| `src/offline_calendar.cpp` | 时钟、离线日历、只当日历用、留言缓存、节假日更新 |
| `src/calendar_render.cpp`、`src/calendar_data.h` | 本地月历，是服务器日历的 C++ 移植版，以及它要用的数据 |
| `src/offline_cache.cpp` | 文件缓存 |
| `src/selftest.cpp` | `_selftest` 环境显示的测试图 |
| `src/config.h` | 引脚、超时之类的常量 |
| `src/cert_bundle.*`、`tools/certs/`、`tools/make_cert_bundle.py` | HTTPS 信任的根证书 |
| `tools/make_setup_screen.py`、`src/setup_screen_data.h` | 配网时屏幕上那张画面（热点名、网址和提示），生成后压缩存放 |
| `tools/mock_server.py` | 测试用的假后端 |
