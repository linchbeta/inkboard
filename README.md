# InkBoard

自托管的 ESP32 墨水屏家庭看板：后端在家里的 NAS 或电脑上生成画面，墨水屏定时醒来取一帧显示，然后深度睡眠省电。
连不上服务器时，屏幕显示设备上本地渲染的月历（和服务器画的逐像素相同），用电池也能长期工作。

- **后端** [`server/`](server/)：TypeScript + Hono + Node 自带的 SQLite，不依赖外部数据库，Docker 一条命令部署；
  手机友好的网页后台，多用户、多块屏，每块屏有自己的播放列表和内容，可以多屏同步。
- **固件** [`firmware/`](firmware/)：ESP32（C3 / WROOM-32E / S3），基于 [InkSight](https://github.com/datascale-ai/inksight) 固件修改；
  画面逐行流式写入屏幕（HTTPS 下也省内存）、304 不变不刷新、整点对齐唤醒、离线月历、节假日更新。
- **使用说明** [`docs/使用说明.md`](docs/使用说明.md)：从刷固件、配网到日常使用。

## 画面（布局）

日历（农历、节气、干支、法定节假日休 / 班）、日期牌、天气、相框（按屏幕颜色抖动）、年度进度、倒数日、留言板、待办作业、
古诗词、外语单词（英法德西意葡日韩，课本 / 考试词库，按遗忘曲线复习）、月相黄历、日程（ICS 订阅）、课程表（小学到大学）、
看板、一言、行情、资讯。

所有文字都按屏幕原生分辨率用点阵字体逐像素绘制，不缩放、不抖动，小字也清晰。

## 支持的屏幕

| 屏幕 | 颜色 | 状态 |
|---|---|---|
| 3.98" SE0398NZ07（A0 / A1） | 黑白黄红 | A0 实机验证 |
| 4.2" HINK SSD1683 | 黑白红 | 实机验证 |
| 4.2" GDEM042F52 / DKE RY683 | 黑白黄红 | 未实机验证 |
| 4.2" WFT0420CZ15、5.83" / 7.5" UC8179 | 黑白红 | 未实机验证 |
| 4.2" / 5.83" / 7.5" 各种黑白屏 | 黑白 | 未实机验证 |

完整列表和每块屏的编译环境见 [`firmware/README.md`](firmware/README.md#支持的屏幕)。

## 快速开始

**后端**（NAS / 服务器，需要 Docker）：

```bash
cd server
docker compose up -d --build
```

浏览器打开 `http://<服务器 IP>:8080`，创建管理员账号。也可以直接用 Node.js 24 运行，见 [`server/README.md`](server/README.md)。

**固件**（需要 [PlatformIO](https://platformio.org/)）：

```powershell
cd firmware
pio run -e epd_398_se0398nz07a0_c3_promini -t upload     # 3.98" 屏
pio run -e epd_42_hink_ssd1683_c3_promini -t upload      # 4.2" 屏
```

刷好后屏幕显示配网热点，手机连上热点填 WiFi 和服务器地址即可。详见 [`docs/使用说明.md`](docs/使用说明.md)。

## 目录

| 目录 | 内容 |
|---|---|
| `server/` | 后端：接口、画面渲染、网页后台、测试（`npm test`） |
| `firmware/` | ESP32 固件、面板驱动、离线日历、配网页；`tools/` 里有日历逐像素对比测试、证书包生成等工具 |
| `docs/` | 使用说明 |

## 许可

本项目按 [GPL-3.0](LICENSE) 发布。固件基于 InkSight（MIT），月历画面移植自 EPD-nRF5（GPL-3.0）；
字体、节假日和词库等第三方内容的来源与许可见 [`NOTICE.md`](NOTICE.md)。
