#!/bin/sh
# Builds the demo's games as normal PC downloads, from the official Ren'Py SDK:
# The Question, without its music. The Ren'Py Tutorial cannot be distributed outside Ren'Py.
#
#   sh deploy/demo/build-games.sh <Ren'Py version> <out dir>
set -eu
VERSION=$1
OUT=$(cd "$2" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
BASE="https://www.renpy.org/dl/${VERSION}"
SDK="renpy-${VERSION}-sdk.tar.bz2"
curl -fsSL "${BASE}/checksums.txt" -o "$WORK/checksums.txt"
curl -fsSL "${BASE}/${SDK}" -o "$WORK/$SDK"
want=$(grep -E "^[0-9a-f]{64} ${SDK}\$" "$WORK/checksums.txt" | cut -d' ' -f1)
if command -v sha256sum >/dev/null; then got=$(sha256sum "$WORK/$SDK" | cut -d' ' -f1); else got=$(shasum -a 256 "$WORK/$SDK" | cut -d' ' -f1); fi
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "The SDK's sha256 does not match renpy.org's" >&2; exit 1; }
tar -xjf "$WORK/$SDK" -C "$WORK"
cp -R "$WORK/renpy-${VERSION}-sdk/the_question" "$WORK/the_question"
python3 -I "$HERE/patch-the-question.py" "$WORK/the_question"
"$WORK/renpy-${VERSION}-sdk/renpy.sh" "$WORK/renpy-${VERSION}-sdk/launcher" distribute "$WORK/the_question" --package pc --destination "$OUT"
rm -rf "$WORK"
ls -l "$OUT"
