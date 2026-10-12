#!/bin/zsh
# Rasterize brand SVGs with headless Chrome (no extra deps).
# Usage: brand/render.sh  ->  brand/dist/app-icon-1024.png, brand/dist/preview.png
set -euo pipefail
DIR=${0:A:h}/dist
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shot() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --window-size=$3,$4 --screenshot="$2" "file://$1" >/dev/null 2>&1; }
shot "$DIR/app-icon.svg" "$DIR/app-icon-1024.png" 1024 1024
cat > "$DIR/preview.html" <<'HTML'
<html><body style="margin:0;font:600 28px -apple-system,'PingFang SC';display:grid;grid-template-columns:repeat(2,600px)">
<div style="background:#f5f5f7;display:flex;align-items:center;justify-content:center;gap:28px;height:420px">
  <img src="app-icon.svg" width="256"><img src="app-icon.svg" width="64"><img src="app-icon.svg" width="32"><img src="app-icon.svg" width="16"></div>
<div style="background:#1c1c1e;display:flex;align-items:center;justify-content:center;gap:28px;height:420px">
  <img src="app-icon.svg" width="256"><img src="app-icon.svg" width="64"><img src="app-icon.svg" width="32"></div>
<div style="background:#fffaf6;display:flex;align-items:center;justify-content:center;gap:14px;height:220px;color:#141414">
  <img src="mark-ink.svg" height="44"><span>Cloudborne <span style="font-weight:400;color:#8a8a8e">云起</span></span></div>
<div style="background:#0b1020;display:flex;align-items:center;justify-content:center;gap:14px;height:220px;color:#fff">
  <img src="mark-white.svg" height="44"><span>Cloudborne <span style="font-weight:400;color:#9aa0b4">云起</span></span></div>
</body></html>
HTML
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,640 --screenshot="$DIR/preview.png" "file://$DIR/preview.html" >/dev/null 2>&1
echo "rendered to $DIR"
