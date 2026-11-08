#!/bin/sh
# Copies the public files into dist/ for Cloudflare (wrangler.jsonc).
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir dist
cp -R index.html catalog js site.css logo.svg logo.png img _redirects _headers LICENSE NOTICE dist/
