#ifndef PORTAL_HTML_H
#define PORTAL_HTML_H

// WiFi setup page served by the captive portal (192.168.4.1). One flow: pick a WiFi
// network, enter the InkBoard server address, connect; then the pairing code for the
// admin page. Endpoints: see portal.cpp.
const char PORTAL_HTML[] PROGMEM = R"rawliteral(<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>墨水屏联网设置</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--fg:#1c1c1e;--mute:#8a8a8e;--bg:#f4f3ef;--card:#fff;--line:#e7e5df;--soft:#f0eee8;--acc:#c0392b;--ok:#2e7d32}
body{font:15px/1.55 -apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:var(--fg);background:var(--bg);padding:16px;min-height:100vh}
.wrap{max-width:420px;margin:0 auto}
.top{display:flex;align-items:center;gap:10px;margin:4px 2px 16px}
.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--acc),#e8a33d);color:#fff;display:grid;place-items:center;font-weight:700}
.top h1{font-size:18px;line-height:1.2}.top small{display:block;color:var(--mute);font-size:12px;font-weight:400}
.tag{margin-left:auto;font:12px ui-monospace,Consolas,monospace;color:var(--mute);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:3px 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:12px}
h2{font-size:14px;color:var(--mute);font-weight:600;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}
h2 a{font-weight:400;color:var(--acc);cursor:pointer;font-size:13px}
.hide{display:none!important}
ul{list-style:none}
.net{display:flex;align-items:center;gap:10px;padding:11px 4px;border-top:1px solid var(--line);cursor:pointer}
.net:first-child{border-top:0}.net.on{color:var(--acc);font-weight:600}
.net .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bars{display:flex;align-items:flex-end;gap:2px;height:14px}.bars i{width:3px;background:var(--line);border-radius:1px}.bars i.a{background:var(--fg)}
.lock{width:12px;height:12px;color:var(--mute)}
.more{display:block;text-align:center;color:var(--mute);font-size:13px;padding:8px;cursor:pointer}
label{display:block;font-size:13px;color:var(--mute);margin:12px 0 5px}
input{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);outline:none;-webkit-appearance:none}
input:focus{border-color:var(--acc)}
.pw{position:relative}.pw input{padding-right:52px}
.pw span{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--mute);cursor:pointer}
.hint{font-size:12px;color:var(--mute);margin-top:5px}
button{font:inherit;border:0;border-radius:12px;padding:13px;width:100%;font-weight:600;cursor:pointer;background:var(--acc);color:#fff}
button:disabled{opacity:.55}
button.sec{background:var(--soft);color:var(--fg);font-weight:500}
button.sm{width:auto;padding:6px 12px;font-size:13px;border-radius:8px}
.saved{display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--line)}.saved:first-child{border-top:0}
.saved .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.x{background:none;color:var(--mute);width:auto;padding:4px 8px;font-size:18px;line-height:1}
.st{min-height:20px;font-size:13px;text-align:center;margin:10px 0 0;color:var(--mute)}.st.e{color:var(--acc)}.st.s{color:var(--ok)}
.done{text-align:center}
.ok{width:54px;height:54px;border-radius:50%;background:var(--ok);color:#fff;display:grid;place-items:center;font-size:28px;margin:6px auto 10px}
.code{font:700 34px/1.2 ui-monospace,Consolas,monospace;letter-spacing:6px;margin:6px 0 2px}
ol{text-align:left;margin:14px 0 4px 20px;font-size:14px}ol li{margin:4px 0}
.foot{text-align:center;font-size:12px;color:var(--mute);margin-top:6px}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--fg);border-radius:50%;animation:r .7s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes r{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap">
<div class="top"><div class="logo">墨</div><h1>墨水屏联网<small>InkBoard</small></h1><span class="tag" id="tag">--:--</span></div>

<div id="setup">
<div class="card">
<h2>选择 WiFi <a onclick="scan()">刷新</a></h2>
<ul id="nets"><li class="st"><span class="spin"></span>正在搜索附近的网络…</li></ul>
<span class="more hide" id="moreBtn" onclick="showAll=true;drawNets()">显示全部</span>
<div id="manual" class="hide"><label>网络名称</label><input id="ssid" placeholder="WiFi 名称" autocomplete="off"></div>
<span class="more" id="manBtn" onclick="manualMode()">手动输入网络名称</span>
<div id="pwBox" class="hide"><label>密码</label><div class="pw"><input id="pw" type="password" placeholder="WiFi 密码"><span onclick="tp()" id="tpb">显示</span></div></div>
</div>

<div class="card">
<h2>服务器地址</h2>
<input id="srv" placeholder="http://192.168.1.10:8080" inputmode="url" autocomplete="off">
<div class="hint">运行 InkBoard 的电脑或 NAS 的地址（含端口）。</div>
</div>

<button id="go" onclick="go()">连接</button>
<div class="st" id="st"></div>

<div class="card" style="margin-top:12px">
<h2>已保存的网络 <span id="cnt" style="font-weight:400">0/5</span></h2>
<ul id="saved"><li class="hint">还没有。连接成功的网络会保存在这里，开机时按顺序尝试。</li></ul>
<button class="sec" style="margin-top:10px" id="addOnly" onclick="addOnly()">只保存上面填写的网络（不连接）</button>
<div class="hint">用于现在不在范围内的网络，比如办公室或手机热点。</div>
</div>

<div class="card">
<h2>不联网</h2>
<button class="sec" id="calOnly" onclick="calOnly()">只当日历用</button>
<div class="hint" style="margin-top:8px">不连 WiFi，屏幕只显示日历，每天零点后自动翻页。时间已按这台手机对好。以后要联网：按 RESET 后按住 BOOT，重新设置。</div>
</div>
</div>

<div id="calDone" class="card done hide">
<div class="ok">✓</div>
<b style="font-size:17px">已切换为日历模式</b>
<p class="hint" style="margin-top:8px">屏幕马上显示今天的日历，可以关闭这个页面了。</p>
</div>

<div id="done" class="card done hide">
<div class="ok">✓</div>
<b style="font-size:17px">已连接 <span id="dName"></span></b>
<div id="pairBox" class="hide" style="margin-top:14px"><div class="hint">配对码</div><div class="code" id="code"></div></div>
<ol>
<li>手机或电脑切回家里的 WiFi。</li>
<li>打开 <b id="dSrv"></b>，在「概览 → 添加设备」里输入配对码。<br><span class="hint">后台只有一个账号时会自动绑定，不用输入。</span></li>
<li>墨水屏重启后会显示内容（或配对码）。</li>
</ol>
<p class="st" id="cd"></p>
<div style="display:flex;gap:8px;margin-top:8px"><button onclick="restart()">立即重启</button><button class="sec" onclick="again()">重新设置</button></div>
</div>

<div class="foot" id="foot"></div>
</div>

<script>
var $=function(i){return document.getElementById(i)};
var nets=[],sel=null,manual=false,showAll=false,timer=null,savedMax=5;
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
function msg(t,k){var s=$('st');s.textContent=t||'';s.className='st'+(k?' '+k:'')}
function post(url,data){var f=new FormData();for(var k in data)f.append(k,data[k]);return fetch(url,{method:'POST',body:f}).then(function(r){return r.json()})}

function scan(){
$('nets').innerHTML='<li class="st"><span class="spin"></span>正在搜索附近的网络…</li>';
fetch('/scan').then(function(r){return r.json()}).then(function(d){nets=d.networks||[];drawNets()})
.catch(function(){$('nets').innerHTML='<li class="st e">搜索失败，可以手动输入网络名称</li>'});
}
function bars(rssi){var l=rssi>-55?4:rssi>-67?3:rssi>-75?2:1,h='';for(var i=1;i<=4;i++)h+='<i class="'+(i<=l?'a':'')+'" style="height:'+(i*3+2)+'px"></i>';return'<span class="bars">'+h+'</span>'}
var LOCK='<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';
function drawNets(){
var ul=$('nets');ul.innerHTML='';
if(!nets.length){ul.innerHTML='<li class="st">附近没有找到网络，可以手动输入</li>';return}
var list=showAll?nets:nets.slice(0,6);
list.forEach(function(n){
var li=document.createElement('li');li.className='net'+(sel&&sel.ssid===n.ssid&&!manual?' on':'');
li.innerHTML='<span class="n">'+esc(n.ssid)+'</span>'+(n.secure?LOCK:'')+bars(n.rssi);
li.onclick=function(){pick(n)};ul.appendChild(li);
});
$('moreBtn').classList.toggle('hide',showAll||nets.length<=6);
}
function pick(n){
manual=false;sel=n;$('manual').classList.add('hide');$('manBtn').classList.remove('hide');
$('pwBox').classList.toggle('hide',!n.secure);$('pw').value='';drawNets();msg('');
if(n.secure)$('pw').focus();
}
function manualMode(){
manual=true;sel=null;drawNets();$('manual').classList.remove('hide');$('manBtn').classList.add('hide');
$('pwBox').classList.remove('hide');$('ssid').focus();
}
function tp(){var i=$('pw');i.type=i.type==='password'?'text':'password';$('tpb').textContent=i.type==='password'?'显示':'隐藏'}

function form(){
var ssid=manual?$('ssid').value.trim():(sel?sel.ssid:'');
var pass=$('pw').value,secure=manual||(sel&&sel.secure);
if(!ssid){msg('请选择或输入 WiFi','e');return null}
if(secure&&pass.length&&pass.length<8){msg('WiFi 密码至少 8 位','e');return null}
return{ssid:ssid,pass:secure?pass:''};
}
function server(){
var s=$('srv').value.trim().replace(/\/+$/,'');
if(s&&!/^https?:\/\//.test(s))s='http://'+s;
if(!/^https?:\/\/[^\/\s]+/.test(s)){msg('请填写服务器地址，例如 http://192.168.1.10:8080','e');return null}
$('srv').value=s;return s;
}
function busy(b,on,text){b.disabled=on;if(text)b.textContent=text}

function go(){
var f=form();if(!f)return;var s=server();if(!s)return;
if(!manual&&sel&&sel.secure&&!f.pass){msg('请输入 WiFi 密码','e');return}
busy($('go'),true,'正在连接…');msg('正在连接 '+f.ssid+'，大约需要 15 秒');
post('/save_wifi',{ssid:f.ssid,pass:f.pass,server:s}).then(function(d){
busy($('go'),false,'连接');
if(d.ok)success(f.ssid,s,d.pair_code);else msg(d.msg||'连接失败','e');
}).catch(function(){busy($('go'),false,'连接');msg('请求失败，请重试','e')});
}
function connectSaved(name,btn){
var s=server();if(!s)return;
btn.disabled=true;msg('正在连接 '+name+'…');
post('/connect_saved',{ssid:name,server:s}).then(function(d){
btn.disabled=false;if(d.list)drawSaved(d.list);
if(d.ok)success(name,s,d.pair_code);
else msg(d.msg==='SAVED_CONNECT_FAILED'?'连接失败，密码可能已经改了，请重新输入密码连接':d.msg==='NOT_FOUND'?'没有这个已保存的网络':(d.msg||'连接失败'),'e');
}).catch(function(){btn.disabled=false;msg('请求失败，请重试','e')});
}
function addOnly(){
var f=form();if(!f)return;
busy($('addOnly'),true);
post('/add_wifi',{ssid:f.ssid,pass:f.pass}).then(function(d){
busy($('addOnly'),false);
if(d.ok){drawSaved(d.list);msg('已保存 '+f.ssid,'s')}else msg(d.msg==='FULL'?'最多保存 '+savedMax+' 个网络':(d.msg||'保存失败'),'e');
}).catch(function(){busy($('addOnly'),false);msg('请求失败，请重试','e')});
}
function drawSaved(d){
if(d&&typeof d.max==='number')savedMax=d.max;
var names=(d&&d.networks)||[],ul=$('saved');
$('cnt').textContent=names.length+'/'+savedMax;
$('addOnly').disabled=names.length>=savedMax;
if(!names.length){ul.innerHTML='<li class="hint">还没有。连接成功的网络会保存在这里，开机时按顺序尝试。</li>';return}
ul.innerHTML='';
names.forEach(function(name){
var li=document.createElement('li');li.className='saved';
li.innerHTML='<span class="n">'+esc(name)+'</span>';
var c=document.createElement('button');c.className='sec sm';c.textContent='连接';c.onclick=function(){connectSaved(name,c)};
var x=document.createElement('button');x.className='x';x.innerHTML='&times;';x.title='删除';
x.onclick=function(){post('/delete_wifi',{ssid:name}).then(function(d){drawSaved(d.list||d)}).catch(function(){msg('请求失败，请重试','e')})};
li.appendChild(c);li.appendChild(x);ul.appendChild(li);
});
}

function success(name,srv,code){
$('setup').classList.add('hide');$('done').classList.remove('hide');
$('dName').textContent=name;$('dSrv').textContent=srv;
if(code){$('code').textContent=code;$('pairBox').classList.remove('hide')}
var n=15;$('cd').textContent=n+' 秒后自动重启';
timer=setInterval(function(){n--;$('cd').textContent=n>0?n+' 秒后自动重启':'正在重启…';if(n<=0){clearInterval(timer);restart()}},1000);
}
function restart(){if(timer)clearInterval(timer);$('cd').textContent='正在重启，可以关闭这个页面了';fetch('/restart',{method:'POST'}).catch(function(){})}
function calOnly(){
busy($('calOnly'),true,'正在切换…');
post('/calendar_only',{}).then(function(){$('setup').classList.add('hide');$('calDone').classList.remove('hide')})
.catch(function(){busy($('calOnly'),false,'只当日历用');msg('请求失败，请重试','e')});
}
function again(){
if(timer)clearInterval(timer);fetch('/reset_portal',{method:'POST'}).catch(function(){});
$('done').classList.add('hide');$('setup').classList.remove('hide');$('pairBox').classList.add('hide');$('pw').value='';msg('');
fetch('/wifi_list').then(function(r){return r.json()}).then(drawSaved).catch(function(){});
}

fetch('/info').then(function(r){return r.json()}).then(function(d){
if(d.mac){$('tag').textContent=d.mac.slice(-5);$('foot').textContent='MAC '+d.mac+(d.battery?' · 电池 '+d.battery:'')}
if(d.server_url&&!/inksight\.site/i.test(d.server_url))$('srv').value=d.server_url;
}).catch(function(){});
fetch('/wifi_list').then(function(r){return r.json()}).then(drawSaved).catch(function(){});
post('/settime',{t:Date.now()}).catch(function(){});  // the phone's clock: the calendar works without internet
scan();
</script>
</body>
</html>)rawliteral";

#endif
