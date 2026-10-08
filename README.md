# InkBoard

一个放在家里用的墨水屏看板。后端跑在 NAS 或者随便一台电脑上，负责生成画面；ESP32 墨水屏每隔一段时间醒来取一张，显示完就睡，靠电池能用很久。

断网也不至于黑屏。固件里带了一份月历，和服务器画的逐像素一致，连不上的时候就显示它。

仓库分三块：

- `server/` 后端。TypeScript 写的，用 Hono 和 Node 自带的 SQLite，不需要另装数据库，Docker 一条命令就能起来。网页后台针对手机做过，可以多人、多屏，每块屏有自己的播放列表和内容，也可以几块屏同步。
- `firmware/` 固件。在 [InkSight](https://github.com/datascale-ai/inksight) 的固件上改的，支持 ESP32-C3、WROOM-32E 和 S3。
- `docs/使用说明.md` 从刷固件、配网到日常使用的说明，给家里人看的。

## 实物

![三块屏](pic/photos/family-1.jpg)

左起：5.83 寸黑白红（古诗词）、4.2 寸黑白红（年度进度）、3.98 寸黑白黄红（日期牌）。

| | |
|---|---|
| ![](pic/photos/398-datecard.jpg)<br>3.98 寸 · 日期牌 | ![](pic/photos/398-weather.jpg)<br>3.98 寸 · 天气 |
| ![](pic/photos/398-poetry.jpg)<br>3.98 寸 · 古诗词 | ![](pic/photos/398-yearprogress.jpg)<br>3.98 寸 · 年度进度 |
| ![](pic/photos/398-photo.jpg)<br>3.98 寸 · 相框（照片按四色抖动） | ![](pic/photos/42-yearprogress.jpg)<br>4.2 寸 · 年度进度 |
| ![](pic/photos/583-weather.jpg)<br>5.83 寸 · 天气 | ![](pic/photos/583-words.jpg)<br>5.83 寸 · 外语单词 |

![三块 3.98 寸](pic/photos/398-trio.jpg)

三块 3.98 寸，分别放着外语单词、相框和日期牌。

![三块屏](pic/photos/family-2.jpg)

## 能显示什么

日历（农历、节气、干支，法定节假日的休和班）、日期牌、天气、相框、年度进度、倒数日、留言板、待办作业、古诗词、外语单词、月相黄历、日程、课程表、看板、一言、行情、资讯。

文字都是按屏幕的原生分辨率用点阵字体画的，没有缩放，所以小字也清楚。照片会按屏幕能显示的几种颜色做抖动。

## 画面一览

下面是后端为两块屏生成的预览图，左边是 3.98 寸（768×552，黑白黄红），右边是 4.2 寸（400×300，黑白红）。留言、日程、待办这些内容是编的，天气、行情、资讯是生成时联网取的。在 `server` 目录下运行 `npx tsx scripts/render-gallery.ts` 可以重新生成。

| 布局 | 3.98 寸 | 4.2 寸 |
|---|---|---|
| 日历 | <img src="pic/calendar-398.png" width="384"> | <img src="pic/calendar-42.png" width="200"> |
| 日期牌 | <img src="pic/datecard-398.png" width="384"> | <img src="pic/datecard-42.png" width="200"> |
| 天气 | <img src="pic/weather-398.png" width="384"> | <img src="pic/weather-42.png" width="200"> |
| 相框 | <img src="pic/photo-398.png" width="384"> | <img src="pic/photo-42.png" width="200"> |
| 年度进度 | <img src="pic/yearprogress-398.png" width="384"> | <img src="pic/yearprogress-42.png" width="200"> |
| 倒数日 | <img src="pic/countdown-398.png" width="384"> | <img src="pic/countdown-42.png" width="200"> |
| 留言板 | <img src="pic/messages-398.png" width="384"> | <img src="pic/messages-42.png" width="200"> |
| 待办作业 | <img src="pic/todo-398.png" width="384"> | <img src="pic/todo-42.png" width="200"> |
| 古诗词 | <img src="pic/poetry-398.png" width="384"> | <img src="pic/poetry-42.png" width="200"> |
| 外语单词 | <img src="pic/words-398.png" width="384"> | <img src="pic/words-42.png" width="200"> |
| 月相黄历 | <img src="pic/almanac-398.png" width="384"> | <img src="pic/almanac-42.png" width="200"> |
| 日程 | <img src="pic/agenda-398.png" width="384"> | <img src="pic/agenda-42.png" width="200"> |
| 课程表 | <img src="pic/timetable-398.png" width="384"> | <img src="pic/timetable-42.png" width="200"> |
| 看板 | <img src="pic/dashboard-398.png" width="384"> | <img src="pic/dashboard-42.png" width="200"> |
| 一言 | <img src="pic/hitokoto-398.png" width="384"> | <img src="pic/hitokoto-42.png" width="200"> |
| 行情 | <img src="pic/market-398.png" width="384"> | <img src="pic/market-42.png" width="200"> |
| 资讯 | <img src="pic/news-398.png" width="384"> | <img src="pic/news-42.png" width="200"> |

### 竖着放

每个布局都有竖版。在后台"设备"里把屏幕方向改成纵向，再把屏逆时针转 90° 竖起来就行；断网时的离线日历也跟着变成竖版。下面是 3.98 寸竖放（552×768）的样子：

| | | | |
|---|---|---|---|
| <img src="pic/portrait/calendar-398.png" width="180"><br>日历 | <img src="pic/portrait/datecard-398.png" width="180"><br>日期牌 | <img src="pic/portrait/weather-398.png" width="180"><br>天气 | <img src="pic/portrait/photo-398.png" width="180"><br>相框 |
| <img src="pic/portrait/yearprogress-398.png" width="180"><br>年度进度 | <img src="pic/portrait/countdown-398.png" width="180"><br>倒数日 | <img src="pic/portrait/messages-398.png" width="180"><br>留言板 | <img src="pic/portrait/todo-398.png" width="180"><br>待办作业 |
| <img src="pic/portrait/poetry-398.png" width="180"><br>古诗词 | <img src="pic/portrait/words-398.png" width="180"><br>外语单词 | <img src="pic/portrait/almanac-398.png" width="180"><br>月相黄历 | <img src="pic/portrait/agenda-398.png" width="180"><br>日程 |
| <img src="pic/portrait/timetable-398.png" width="180"><br>课程表 | <img src="pic/portrait/dashboard-398.png" width="180"><br>看板 | <img src="pic/portrait/hitokoto-398.png" width="180"><br>一言 | <img src="pic/portrait/market-398.png" width="180"><br>行情 |
| <img src="pic/portrait/news-398.png" width="180"><br>资讯 |  |  |  |

## 屏幕

我手上实测过的是 3.98 寸 SE0398NZ07（A0 版，黑白黄红）和 4.2 寸 HINK SSD1683（黑白红）。3.98 寸的 A1 版也写好了驱动，但还没有实物测过。

上游 InkSight 支持的其它屏也都能用，包括 4.2 寸黑白黄红、5.83 寸和 7.5 寸三色，以及各种 4.2、5.83、7.5 寸黑白屏，不过都没在真机上验证。另外加了 UC8159 等每像素 4 位的屏：5.65 寸七色、7.3 寸七色和六色（Spectra 6）、7.5 寸 V1（640×384）和 5.83 寸 V1（600×448）的三色和黑白，以及从 EPD-nRF5 移植的 4.2 寸 UC8176 三色、7.5 寸和 5.83 寸 JD79665 四色、7.5 寸 HD（880×528）三色和黑白；彩色屏先显示黑白黄红四种颜色。这些都没有实物测过。2.9 寸太小，现有的版面排不下，没有适配。每块屏对应的编译环境见 [firmware/README.md](firmware/README.md#支持的屏幕)。

## 快速开始

后端（需要 Docker）：

```bash
cd server
docker compose up -d --build
```

然后用浏览器打开 `http://服务器IP:8080`，先建一个管理员账号。不想用 Docker 的话，直接用 Node.js 24 跑也行，见 [server/README.md](server/README.md)。

固件（需要 [PlatformIO](https://platformio.org/)）：

```bash
cd firmware
pio run -e epd_398_se0398nz07a0_c3_promini -t upload   # 3.98 寸
pio run -e epd_42_hink_ssd1683_c3_promini -t upload    # 4.2 寸
```

刷完屏幕上会显示一个 WiFi 热点，用手机连上，填好家里的 WiFi 和服务器地址就行。更详细的步骤在[使用说明](docs/使用说明.md)里。

## 许可

GPL-3.0。固件基于 InkSight（MIT），月历是从 EPD-nRF5（GPL-3.0）移植过来的，所以整个项目跟着用 GPL-3.0。字体、节假日数据、词库等第三方内容的出处和许可写在 [NOTICE.md](NOTICE.md)。
