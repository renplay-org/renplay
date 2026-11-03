#!/usr/bin/env bash
# Rebuilds runtime/vendor/fake-indexeddb.js: an in-memory IndexedDB (fake-indexeddb, Apache-2.0)
# that renplay-html.js installs in sandboxed game frames. Bump VERSION to update.
set -euo pipefail
VERSION=6.2.7
DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install -s "fake-indexeddb@$VERSION" esbuild@0.25
cat > entry.js <<'JS'
import { IDBFactory, IDBKeyRange, IDBDatabase, IDBTransaction, IDBObjectStore, IDBIndex, IDBCursor, IDBCursorWithValue, IDBRequest, IDBOpenDBRequest, IDBVersionChangeEvent } from 'fake-indexeddb'
window.__renplayIDB = { IDBFactory, IDBKeyRange, IDBDatabase, IDBTransaction, IDBObjectStore, IDBIndex, IDBCursor, IDBCursorWithValue, IDBRequest, IDBOpenDBRequest, IDBVersionChangeEvent }
JS
npx esbuild entry.js --bundle --minify --format=iife --target=es2019 --outfile=out.js
{ printf '/* fake-indexeddb %s (Apache-2.0, https://github.com/dumbmatter/fakeIndexedDB), bundled by runtime/vendor/build.sh. An in-memory IndexedDB for sandboxed game frames, which have none of their own. */\n' "$VERSION"; cat out.js; } > "$DIR/fake-indexeddb.js"
cp node_modules/fake-indexeddb/LICENSE "$DIR/LICENSE-fake-indexeddb"
