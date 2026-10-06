#!/usr/bin/env python3
"""Minimal InkSight-compatible test server for hardware bring-up.

Implements just the endpoints the current firmware calls, and answers
/api/render with a freshly generated test frame (time, request counter,
battery, RSSI, colour swatches), so every refresh is visibly different.

Python 3.8+ standard library only:
    python tools/mock_server.py --port 8080

Point the device (config portal -> server URL) at http://<this-PC-LAN-IP>:8080

Browser controls while it runs:
    http://localhost:8080/            status page (devices, last requests)
    http://localhost:8080/mock/fail?on=1   make /api/render return 500 (offline-cache test)
    http://localhost:8080/mock/fail?on=0   back to normal
    http://localhost:8080/mock/refresh?min=15   X-Refresh-Minutes sent to devices (10..1440)
"""

import argparse
import datetime as dt
import json
import secrets
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# 2bpp colour codes used by the firmware: 00 black, 01 white, 10 yellow, 11 red
K, W_, Y, R = 0, 1, 2, 3

# Classic 5x7 font, column-major, bit 0 = top row (same glyphs as src/selftest_398.cpp)
FONT = {
    " ": (0x00, 0x00, 0x00, 0x00, 0x00), ".": (0x00, 0x60, 0x60, 0x00, 0x00),
    ",": (0x00, 0x50, 0x30, 0x00, 0x00), "-": (0x08, 0x08, 0x08, 0x08, 0x08),
    ":": (0x00, 0x36, 0x36, 0x00, 0x00), "/": (0x20, 0x10, 0x08, 0x04, 0x02),
    "%": (0x23, 0x13, 0x08, 0x64, 0x62), "=": (0x14, 0x14, 0x14, 0x14, 0x14),
    "#": (0x14, 0x7F, 0x14, 0x7F, 0x14), "_": (0x40, 0x40, 0x40, 0x40, 0x40),
    ">": (0x00, 0x41, 0x22, 0x14, 0x08),
    "0": (0x3E, 0x51, 0x49, 0x45, 0x3E), "1": (0x00, 0x42, 0x7F, 0x40, 0x00),
    "2": (0x42, 0x61, 0x51, 0x49, 0x46), "3": (0x22, 0x41, 0x49, 0x49, 0x36),
    "4": (0x18, 0x14, 0x12, 0x7F, 0x10), "5": (0x27, 0x45, 0x45, 0x45, 0x39),
    "6": (0x3C, 0x4A, 0x49, 0x49, 0x30), "7": (0x01, 0x71, 0x09, 0x05, 0x03),
    "8": (0x36, 0x49, 0x49, 0x49, 0x36), "9": (0x06, 0x49, 0x49, 0x29, 0x1E),
    "A": (0x7E, 0x11, 0x11, 0x11, 0x7E), "B": (0x7F, 0x49, 0x49, 0x49, 0x36),
    "C": (0x3E, 0x41, 0x41, 0x41, 0x22), "D": (0x7F, 0x41, 0x41, 0x22, 0x1C),
    "E": (0x7F, 0x49, 0x49, 0x49, 0x41), "F": (0x7F, 0x09, 0x09, 0x09, 0x01),
    "G": (0x3E, 0x41, 0x49, 0x49, 0x7A), "H": (0x7F, 0x08, 0x08, 0x08, 0x7F),
    "I": (0x00, 0x41, 0x7F, 0x41, 0x00), "J": (0x20, 0x40, 0x41, 0x3F, 0x01),
    "K": (0x7F, 0x08, 0x14, 0x22, 0x41), "L": (0x7F, 0x40, 0x40, 0x40, 0x40),
    "M": (0x7F, 0x02, 0x0C, 0x02, 0x7F), "N": (0x7F, 0x04, 0x08, 0x10, 0x7F),
    "O": (0x3E, 0x41, 0x41, 0x41, 0x3E), "P": (0x7F, 0x09, 0x09, 0x09, 0x06),
    "Q": (0x3E, 0x41, 0x51, 0x21, 0x5E), "R": (0x7F, 0x09, 0x19, 0x29, 0x46),
    "S": (0x26, 0x49, 0x49, 0x49, 0x32), "T": (0x01, 0x01, 0x7F, 0x01, 0x01),
    "U": (0x3F, 0x40, 0x40, 0x40, 0x3F), "V": (0x1F, 0x20, 0x40, 0x20, 0x1F),
    "W": (0x3F, 0x40, 0x38, 0x40, 0x3F), "X": (0x63, 0x14, 0x08, 0x14, 0x63),
    "Y": (0x07, 0x08, 0x70, 0x08, 0x07), "Z": (0x61, 0x51, 0x49, 0x45, 0x43),
}


class Canvas:
    """W x H grid of 2bpp colour codes."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = bytearray([W_]) * (w * h)

    def rect(self, x0, y0, x1, y1, c):
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(self.w, x1), min(self.h, y1)
        for y in range(y0, y1):
            self.px[y * self.w + x0:y * self.w + x1] = bytes([c]) * (x1 - x0)

    def frame(self, x0, y0, x1, y1, c):
        self.rect(x0, y0, x1, y0 + 1, c)
        self.rect(x0, y1 - 1, x1, y1, c)
        self.rect(x0, y0, x0 + 1, y1, c)
        self.rect(x1 - 1, y0, x1, y1, c)

    def text(self, x, y, s, scale=1, c=K):
        for ch in s.upper():
            cols = FONT.get(ch, FONT[" "])
            for cx, bits in enumerate(cols):
                for cy in range(7):
                    if bits & (1 << cy):
                        self.rect(x + cx * scale, y + cy * scale,
                                  x + (cx + 1) * scale, y + (cy + 1) * scale, c)
            x += 6 * scale
        return x

    def pack_2bpp(self):
        out = bytearray(self.w * self.h // 4)
        p = self.px
        for i in range(0, len(p), 4):
            out[i >> 2] = (p[i] << 6) | (p[i + 1] << 4) | (p[i + 2] << 2) | p[i + 3]
        return bytes(out)

    def to_bmp_1bpp(self):
        """1-bit BMP (bottom-up), white = 1. Non-white colours become black."""
        row_bytes = (self.w + 7) // 8
        stride = (row_bytes + 3) & ~3
        pixels = bytearray()
        for y in range(self.h - 1, -1, -1):
            row = bytearray(stride)
            for x in range(self.w):
                if self.px[y * self.w + x] == W_:
                    row[x >> 3] |= 0x80 >> (x & 7)
            pixels += row
        header_size = 14 + 40 + 8
        file_header = b"BM" + struct.pack("<IHHI", header_size + len(pixels), 0, 0, header_size)
        info = struct.pack("<IiiHHIIiiII", 40, self.w, self.h, 1, 1, 0, len(pixels), 2835, 2835, 2, 2)
        palette = bytes([0, 0, 0, 0, 255, 255, 255, 0])
        return file_header + info + palette + bytes(pixels)


STATE = {
    "fail": False,
    "refresh_min": 10,
    "counter": 0,
    "devices": {},   # mac -> dict
    "log": [],       # recent request lines
}
LOCK = threading.Lock()


def log(line):
    stamp = dt.datetime.now().strftime("%H:%M:%S")
    entry = f"{stamp} {line}"
    print(entry, flush=True)
    with LOCK:
        STATE["log"].append(entry)
        del STATE["log"][:-200]


def render_frame(w, h, colors, q):
    """Build the test frame for a w x h panel. colors: 2=BW, 3=BWR, 4=BWRY."""
    c = Canvas(w, h)
    accent = R if colors >= 3 else K
    yellow = Y if colors >= 4 else (R if colors == 3 else K)
    big = 6 if w >= 600 else 4
    mid = 3 if w >= 600 else 2

    with LOCK:
        STATE["counter"] += 1
        n = STATE["counter"]
    now = dt.datetime.now()

    c.frame(0, 0, w, h, K)
    c.rect(0, 0, w, 14 * mid // 2 + 10, K)
    c.text(8, 6, "INKSIGHT MOCK SERVER", mid // 2 + 1, W_)

    y = 14 * mid // 2 + 24
    c.text(12, y, now.strftime("%H:%M:%S"), big, K)
    y += 7 * big + 14
    c.text(12, y, now.strftime("%Y/%m/%d"), mid, accent)
    y += 7 * mid + 14

    lines = [
        f"REQUEST #{n}  PANEL {w}X{h}  COLORS={colors}  BPP={q.get('bpp', '?')}",
        f"MAC {q.get('mac', '?')}",
        f"BATTERY {q.get('v', '?')} V   RSSI {q.get('rssi', '?')} DBM",
        f"REFRESH_MIN {q.get('refresh_min', '?')}   NEXT={q.get('next', '0')}",
    ]
    for line in lines:
        c.text(12, y, line, 1 if w < 600 else 2, K)
        y += (7 if w < 600 else 14) + 6

    # colour swatches along the bottom
    sw_h = max(24, h // 10)
    sw_y = h - sw_h - 8
    yellow_label = "YELLOW" if colors >= 4 else ("YELLOW->RED" if colors == 3 else "YELLOW->BLACK")
    names = [("BLACK", K), ("RED", accent), (yellow_label, yellow), ("WHITE", W_)]
    sw_w = (w - 16 - 3 * 6) // 4
    for i, (name, col) in enumerate(names):
        x0 = 8 + i * (sw_w + 6)
        c.rect(x0, sw_y, x0 + sw_w, sw_y + sw_h, col)
        c.frame(x0, sw_y, x0 + sw_w, sw_y + sw_h, K)
        label_col = W_ if col in (K, R) else K
        c.text(x0 + 4, sw_y + 4, name, 1, label_col)

    # counter-driven marker so even same-minute frames differ visibly
    mx = 12 + (n % 10) * ((w - 40) // 10)
    c.rect(mx, sw_y - 14, mx + 16, sw_y - 6, accent)
    return c


class Handler(BaseHTTPRequestHandler):
    server_version = "InkSightMock/1.0"

    def log_message(self, fmt, *args):  # silence default access log; we log ourselves
        pass

    # ── helpers ──
    def _send(self, code, body=b"", ctype="application/json", headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode())

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _mac_from_path(self, parts):
        # /api/device/{mac}/...  or /api/config/{mac}
        return parts[2] if len(parts) > 2 else "?"

    def _touch(self, mac, **kw):
        with LOCK:
            d = STATE["devices"].setdefault(mac, {"mac": mac, "requests": 0})
            d["requests"] += 1
            d["last_seen"] = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            d["ip"] = self.client_address[0]
            d.update({k: v for k, v in kw.items() if v is not None})

    # ── routes ──
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        parts = [p for p in u.path.split("/") if p]

        if u.path == "/":
            return self._status_page()
        if u.path == "/mock/fail":
            STATE["fail"] = q.get("on", "1") == "1"
            log(f"[MOCK] render failure mode = {STATE['fail']}")
            return self._json(200, {"fail": STATE["fail"]})
        if u.path == "/mock/refresh":
            STATE["refresh_min"] = max(10, min(1440, int(q.get("min", "10"))))
            log(f"[MOCK] X-Refresh-Minutes = {STATE['refresh_min']}")
            return self._json(200, {"refresh_min": STATE["refresh_min"]})

        if u.path == "/api/render":
            mac = q.get("mac", "?")
            w, h = int(q.get("w", 400)), int(q.get("h", 300))
            colors, bpp = int(q.get("colors", 2)), int(q.get("bpp", 1))
            self._touch(mac, battery_v=q.get("v"), rssi=q.get("rssi"), panel=f"{w}x{h}",
                        colors=colors, token_sent=bool(self.headers.get("X-Device-Token")),
                        boot=q.get("boot"))
            if STATE["fail"]:
                log(f"GET /api/render mac={mac} boot={q.get('boot', '-')} -> 500 (failure mode on)")
                return self._json(500, {"error": "mock failure mode"})
            canvas = render_frame(w, h, colors, q)
            if bpp >= 2 and colors >= 3:
                body, kind = canvas.pack_2bpp(), "raw 2bpp"
            else:
                body, kind = canvas.to_bmp_1bpp(), "1-bit BMP"
            log(f"GET /api/render mac={mac} {w}x{h} colors={colors} bpp={bpp} v={q.get('v')} "
                f"rssi={q.get('rssi')} next={q.get('next', '0')} boot={q.get('boot', '-')} -> 200 {kind} {len(body)} bytes")
            return self._send(200, body, "application/octet-stream", {
                "X-Refresh-Minutes": str(STATE["refresh_min"]),
                "X-Mode-Id": "MOCK",
            })

        if len(parts) >= 4 and parts[:2] == ["api", "device"] and parts[3] == "state":
            mac = self._mac_from_path(parts)
            self._touch(mac)
            log(f"GET /api/device/{mac}/state")
            return self._json(200, {"runtime_mode": "interval", "pending_refresh": False,
                                    "pending_mode": ""})
        if len(parts) == 3 and parts[:2] == ["api", "config"]:
            mac = self._mac_from_path(parts)
            self._touch(mac)
            log(f"GET /api/config/{mac}")
            return self._json(200, {"is_focus_listening": False, "is_always_active": False})

        log(f"GET {self.path} -> 404 (not implemented in mock)")
        return self._json(404, {"error": "not implemented in mock"})

    def do_POST(self):
        u = urlparse(self.path)
        parts = [p for p in u.path.split("/") if p]
        body = self._body()

        if len(parts) >= 4 and parts[:2] == ["api", "device"]:
            mac, action = parts[2], parts[3]
            if action == "token":
                token = secrets.token_hex(16)
                self._touch(mac, token=token[:8] + "...")
                log(f"POST /api/device/{mac}/token -> new token")
                return self._json(200, {"token": token})
            if action == "claim-token":
                # Firmware keeps re-sending its pending pair code on every WiFi connect
                # (3 attempts) until the server echoes the same pair_code back.
                try:
                    code = str(json.loads(body or b"{}").get("pair_code", ""))
                except ValueError:
                    code = ""
                self._touch(mac, pair_code=code)
                log(f"POST /api/device/{mac}/claim-token pair_code={code} -> echoed")
                return self._json(200, {"ok": True, "pair_code": code})
            if action == "heartbeat":
                try:
                    hb = json.loads(body or b"{}")
                except ValueError:
                    hb = {}
                self._touch(mac, battery_v=hb.get("battery_voltage"), rssi=hb.get("wifi_rssi"))
                log(f"POST /api/device/{mac}/heartbeat {hb}")
                return self._json(200, {"ok": True})
            log(f"POST {u.path} ({len(body)} bytes) -> 200 (accepted, ignored)")
            return self._json(200, {"ok": True})

        if u.path == "/api/config":
            log(f"POST /api/config ({len(body)} bytes) -> 200 (accepted, ignored)")
            return self._json(200, {"ok": True})

        log(f"POST {self.path} -> 404 (not implemented in mock)")
        return self._json(404, {"error": "not implemented in mock"})

    def _status_page(self):
        with LOCK:
            devices = list(STATE["devices"].values())
            lines = list(STATE["log"])[-60:]
            fail, refresh = STATE["fail"], STATE["refresh_min"]
        rows = "".join(
            f"<tr><td>{d.get('mac')}</td><td>{d.get('ip','')}</td><td>{d.get('panel','')}</td>"
            f"<td>{d.get('battery_v','')}</td><td>{d.get('rssi','')}</td>"
            f"<td>{d.get('requests')}</td><td>{d.get('last_seen','')}</td><td>{d.get('boot','')}</td></tr>" for d in devices)
        html = f"""<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>InkSight mock</title>
<style>body{{font:14px system-ui;margin:16px}}td,th{{border:1px solid #ccc;padding:4px 8px}}
table{{border-collapse:collapse}}pre{{background:#f4f4f4;padding:8px}}</style>
<h2>InkSight mock server</h2>
<p>render failure mode: <b>{fail}</b> (<a href="/mock/fail?on=1">on</a> / <a href="/mock/fail?on=0">off</a>)
 &nbsp; X-Refresh-Minutes: <b>{refresh}</b></p>
<table><tr><th>MAC</th><th>IP</th><th>panel</th><th>battery V</th><th>RSSI</th><th>requests</th><th>last seen</th><th>last boot (debug fw)</th></tr>{rows}</table>
<h3>recent requests</h3><pre>{chr(10).join(reversed(lines))}</pre>"""
        self._send(200, html.encode(), "text/html; charset=utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--dump", metavar="WxHxCOLORS",
                    help="write one test frame to mock_frame.bin and exit, e.g. 768x552x4")
    args = ap.parse_args()

    if args.dump:
        w, h, colors = (int(v) for v in args.dump.lower().split("x"))
        data = render_frame(w, h, colors, {"mac": "AA:BB:CC:DD:EE:FF", "v": "3.95", "rssi": "-60",
                                            "bpp": "2", "refresh_min": "10"}).pack_2bpp()
        with open("mock_frame.bin", "wb") as f:
            f.write(data)
        print(f"wrote mock_frame.bin ({len(data)} bytes)")
        return

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"InkSight mock server on http://{args.host}:{args.port}  (status page: http://localhost:{args.port}/)")
    print("Set the device server URL to http://<this PC's LAN IP>:%d" % args.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
