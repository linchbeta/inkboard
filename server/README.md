# InkBoard 后端

自托管的墨水屏后端：给 ESP32 墨水屏（3.98" 四色屏 / 4.2" 三色屏）生成画面，并提供网页后台管理屏幕、内容和账号。
TypeScript + Hono + Node 自带的 SQLite，不依赖外部数据库。

- 完整的使用说明（从刷固件到日常使用）：[`../docs/使用说明.md`](../docs/使用说明.md)
- 固件编译上传：[`../firmware/README.md`](../firmware/README.md)
- 设计文档：[`../docs/项目梳理与新后端设计.md`](../docs/项目梳理与新后端设计.md)

## 运行

### 在 NAS 上（Docker，推荐长期使用）

把部署包（`inkboard-docker-<日期>.zip`，或整个 `server` 文件夹）复制到 NAS 解压，在该目录执行：

```bash
docker compose up -d --build
```

第一次构建要下载 Node 镜像和依赖，几分钟；之后启动只要几秒。

- 后台：`http://<NAS 的 IP>:8080/`，第一次打开会要求创建管理员账号
- 墨水屏配网时的"服务器地址"也填 `http://<NAS 的 IP>:8080`
- 数据都在 `./data/`（数据库 `inkboard.db`：账号、设备、内容、照片），备份这个文件夹即可；升级、重建容器都不会丢
- 端口被占用：改 `docker-compose.yml` 里 `ports` 左边的数字（如 `"8090:8080"`），设备地址跟着改
- 时区在 `docker-compose.yml` 里（默认 `Asia/Shanghai`），影响日期和刷新时间
- 国内网络下载慢：把 `docker-compose.yml` 里 `NODE_IMAGE`、`NPM_REGISTRY` 两行前的 `#` 去掉（用 DaoCloud 镜像和 npmmirror）
- 常用命令：`docker compose logs -f`（日志）、`docker compose restart`、`docker compose down`（停止）
- 更新：用新的部署包覆盖代码文件（保留 `data` 文件夹），再执行一次 `docker compose up -d --build`
- 镜像里只有编译后的代码、生产依赖、字体和节假日数据；开发机上对比用的微软字体不会打进镜像（`.dockerignore`）

在开发机上打部署包（只包含仓库里提交过的文件）：

```powershell
git archive --format=zip -o ..\release\inkboard-docker-20261006.zip HEAD
```

### 在 Windows 电脑上

需要 Node.js 22.5 或更高（推荐 24）。在 `server` 目录（PowerShell）：

```powershell
npm install
npm run build; npm start
```

开发时用 `npm run dev`（改代码自动重启）。电脑要和墨水屏在同一个局域网，并允许 Node 通过 Windows 防火墙（第一次运行时会弹出提示，勾选"专用网络"）。

### 公网 / HTTPS

后端只监听 HTTP。对外用反向代理加 HTTPS，例如 Caddy：

```
board.example.com {
    reverse_proxy 192.168.1.10:8080
}
```

设备侧：配网时服务器地址填 `https://board.example.com`。固件信任 38 个常用公共根证书（Let's Encrypt、谷歌 GTS、亚马逊、DigiCert、Sectigo、GlobalSign 等，
`firmware/src/cert_bundle.cpp`），自签名证书不行；代理不要压缩 `/api/render` 的回复或改写 `ETag`，否则设备拿不到 304（不影响正确性，只是每次都下载）。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | 端口 |
| `DATA_DIR` | `./data` | 数据库所在目录 |
| `TZ` | 系统时区 | 例如 `Asia/Shanghai` |

## 开发

```powershell
npm run dev     # 开发服务器，http://localhost:8080
npm test        # 测试（node:test）
npx tsc --noEmit -p .   # 类型检查
```

### 代码结构

| 目录 | 内容 |
|---|---|
| `src/server.ts`、`src/app.ts` | 入口、路由装配 |
| `src/api/` | 设备协议：`compat.ts`（现有 InkSight 固件）、`v1.ts` |
| `src/deviceFrame.ts` | 某块屏现在显示什么：播放列表 → 布局 → 画面 |
| `src/screens/` | 各个布局（日历、天气、待办、诗词……），每个导出一个 `Screen` |
| `src/data/` | 数据：设备设置与播放、各屏内容与同步、留言、照片、天气、节假日、账号 |
| `src/render/` | 画布、点阵字体、抖动、输出格式（2bpp / BMP / PNG 预览） |
| `src/admin/` | 网页后台 |
| `src/scope.ts` | 当前用户 / 当前屏幕（每块屏的内容按屏存储，见文件头注释） |
| `assets/fonts/` | 点阵字体和大字号字体（许可证见 `assets/fonts/LICENSES/`、`NOTICE-display-fonts.md`） |
| `scripts/` | 字体生成脚本 |

### 数据模型要点

- 账号之间完全隔离：屏幕、照片、留言互相看不到。第一个账号是管理员。
- 每块屏的内容（待办、倒数日、日程链接、诗词、照片选择、天气城市……）属于这块屏；"多屏同步"把几块屏的
  某个布局绑成一组，改一处全组更新。存储键：`d:<MAC>:<key>`；同步组：`u:<用户>:sync:<布局>`。
- 新屏连上后显示 6 位配对码；只有一个账号时自动归这个账号。

## 设备接口

| 接口 | 用途 |
|---|---|
| `POST /api/device/{mac}/token` | 兼容：注册设备，返回 token |
| `POST /api/device/{mac}/claim-token` | 兼容：设备上报配网时生成的配对码 |
| `POST /api/device/{mac}/heartbeat` | 兼容：电压、信号 |
| `GET /api/config/{mac}` | 兼容：是否常亮（实时模式） |
| `GET /api/render?...` | 兼容：返回一帧（2bpp 或 1-bit BMP），带 `X-Refresh-Minutes`、`X-Mode-Id`、`ETag`；`If-None-Match` 相同时返回 304 |
| `GET /api/holidays/{year}` | 设备离线日历用的节假日：`YYYYMMDD 1`（休）/ `YYYYMMDD 2`（班），含前一年 12 月；未公布时 404 |
| `POST /api/v1/register`、`GET /api/v1/frame` | v1 协议：一次请求一帧，内容不变返回 304 |
| `GET /healthz` | 健康检查 |

## 字体

点阵正文：文泉驿点阵宋体 12/16px、Fusion Pixel；大字号：霞鹜文楷、思源黑体 Medium、Inter、Barlow Condensed，
由 `scripts/make-fonts.py` 栅格化成固定像素字号（霞鹜文楷另有日文、韩文补充字形 `*-extra`，取自完整版，加载时自动合并）。许可证与说明见 `assets/fonts/`。
