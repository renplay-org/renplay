#!/bin/sh
# Builds the website into dist/ (renplay.org) and dist-adult/ (adult.renplay.org), with Renplay's license.
# The game pages come from the catalog's safe-for-work index: set CATALOG_INDEX_FILE to build from a file.
set -e
cd "$(dirname "$0")"
node build.mjs
