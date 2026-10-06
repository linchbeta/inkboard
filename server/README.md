# InkBoard 后端

给 ESP32 墨水屏生成画面，顺带提供一个网页后台，用来管理屏幕、内容和账号。技术上是 TypeScript + Hono，数据存在 Node 自带的 SQLite 里，没有别的依赖。

怎么用、怎么配网，看 [docs/使用说明.md](../docs/使用说明.md)；固件相关的看 [firmware/README.md](../firmware/README.md)。

## 部署

### Docker（推荐）

把这个 `server` 文件夹（或者打好的部署包）拷到 NAS 上，进到目录里执行：

```bash
docker compose up -d --build
```

第一次要拉 Node 镜像、装依赖，得等几分钟，以后启动就是几秒钟的事。起来之后浏览器打开 `http://NAS的IP:8080`，第一次进去会让你建管理员账号。墨水屏配网时，服务器地址也填这个。

所有数据都在 `./data/` 下面，就一个 `inkboard.db`，账号、设备、内容、照片都在里面。备份就拷这个文件夹，升级或者重建容器都不会丢。

几个可能用到的地方：

- 8080 被占了，就改 `docker-compose.yml` 里 `ports` 冒号左边的数字，比如 `"8090:8080"`，设备上的地址也跟着改。
- 时区默认 `Asia/Shanghai`，日期和刷新时间都按它算，在 `docker-compose.yml` 里改。
- 国内拉镜像慢，把 `docker-compose.yml` 里 `NODE_IMAGE` 和 `NPM_REGISTRY` 那两行的注释去掉，会改用 DaoCloud 和 npmmirror 的源。
- 看日志 `docker compose logs -f`，停掉 `docker compose down`。
- 升级：新代码覆盖旧的（`data` 留着），再跑一次 `docker compose up -d --build`。

镜像里只有编译好的代码、生产依赖、字体和节假日数据。开发时对比用的微软字体被 `.dockerignore` 挡在外面，不会打进去。

要打一个部署包，在仓库根目录执行（`release/` 不会进仓库）：

```powershell
git archive --format=zip -o release\inkboard-docker-20261006.zip HEAD:server
```

### 直接用 Node 跑

Node.js 22.5 以上就行，推荐 24。在 `server` 目录下：

```powershell
npm install
npm run build; npm start
```

电脑得和墨水屏在同一个局域网里。第一次运行 Windows 防火墙会弹窗问，勾上"专用网络"。

### 放到公网上

后端只听 HTTP。要从外面访问，前面挂一个反向代理加上 HTTPS 就行，比如 Caddy：

```
board.example.com {
    reverse_proxy 192.168.1.10:8080
}
```

屏幕配网时服务器地址填 `https://board.example.com`。固件里带了 38 个常见的根证书（Let's Encrypt、谷歌、亚马逊、DigiCert、Sectigo、GlobalSign 等，见 `firmware/src/cert_bundle.cpp`），正规证书基本都认，自签名的不行。

另外别让代理压缩 `/api/render` 的返回，也别改 `ETag`。不然画面没变时屏幕也拿不到 304，每次都得重新下载，虽然不影响显示，但费电。

### 环境变量

| 变量 | 默认值 | 作用 |
|---|---|---|
| `PORT` | `8080` | 监听端口 |
| `DATA_DIR` | `./data` | 数据库放在哪 |
| `TZ` | 系统时区 | 比如 `Asia/Shanghai` |

## 开发

```powershell
npm run dev            # 改了代码自动重启
npm test               # 跑测试
npx tsc --noEmit -p .  # 类型检查
```

`scripts/bench-render.ts` 可以测各个布局的渲染耗时，`scripts/export-firmware-calendar.ts` 用来给固件生成离线日历的数据。

代码大致是这么分的：

| 位置 | 内容 |
|---|---|
| `src/server.ts`、`src/app.ts` | 入口和路由 |
| `src/api/` | 设备接口。`compat.ts` 兼容 InkSight 固件，`v1.ts` 是新协议 |
| `src/deviceFrame.ts` | 决定一块屏现在该显示什么：播放列表 → 布局 → 画面 |
| `src/screens/` | 每个布局一个文件 |
| `src/data/` | 各种数据：设备设置、按屏存储的内容和同步、留言、照片、天气、节假日、账号；单词相关的在 `data/vocab/` |
| `src/render/` | 画布、点阵字体、抖动，以及输出成 2bpp、BMP 或者预览用的 PNG |
| `src/admin/` | 网页后台 |
| `src/scope.ts` | 当前是哪个用户、哪块屏（内容按屏存储，细节看文件开头的注释） |
| `assets/` | 字体、节假日数据、打包好的英语词库 |

关于数据，有几点要知道：账号之间完全隔开，屏幕、照片、留言谁也看不到谁的，第一个注册的是管理员。每块屏的内容（待办、倒数日、日程订阅、照片选择、天气城市等）归这块屏自己，存成 `d:<MAC>:<key>`。"多屏同步"是把几块屏的某个布局绑成一组，改一处整组都变，组的信息存在 `u:<用户ID>:sync:<布局>`。新屏连上来会显示一个 6 位配对码；如果后台只有一个账号，就直接归它了。

## 设备接口

| 接口 | 用途 |
|---|---|
| `POST /api/device/{mac}/token` | 设备注册，拿 token |
| `POST /api/device/{mac}/claim-token` | 设备上报配网时生成的配对码 |
| `POST /api/device/{mac}/heartbeat` | 上报电压和信号 |
| `GET /api/config/{mac}` | 是否保持常亮（实时模式） |
| `GET /api/render?...` | 取一帧画面（2bpp 或 1 位 BMP）。响应头带 `X-Refresh-Minutes`、`X-Mode-Id` 和 `ETag`，请求带了相同的 `If-None-Match` 就回 304 |
| `GET /api/holidays/{year}` | 给离线日历用的节假日，每行 `YYYYMMDD 1`（休）或 `YYYYMMDD 2`（班），包括前一年 12 月；还没公布时返回 404 |
| `POST /api/v1/register`、`GET /api/v1/frame` | v1 协议，一次请求一帧，内容没变返回 304 |
| `GET /healthz` | 健康检查 |

前五个是为了兼容 InkSight 固件，现在的固件用的也是这一套。

## 字体

正文用的是文泉驿点阵宋体（12 和 16 像素）和 Fusion Pixel；大字用霞鹜文楷、思源黑体、Inter 和 Barlow Condensed，由 `scripts/make-fonts.py` 按固定像素字号转成点阵。霞鹜文楷还单独生成了一份日文、韩文的补充字形（`*-extra`），加载时自动合并。各字体的许可证在 `assets/fonts/` 里。
