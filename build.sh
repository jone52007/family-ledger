#!/bin/sh
# 打包 src/app.js（含 Firebase SDK）成 app.js，並更新 service worker 版本
npx esbuild src/app.js --bundle --minify --format=esm --target=es2020 --outfile=app.js
V=$(date +%Y%m%d%H%M%S); sed -i "s/family-ledger-[0-9_A-Z]*\"/family-ledger-$V\"/" sw.js
