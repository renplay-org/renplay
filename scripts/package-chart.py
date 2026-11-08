#!/usr/bin/env python3
"""Stamp packaged-chart metadata from the released app and its changelog.

Only run in a release checkout. Requires PyYAML.
"""
from pathlib import Path
import sys
import yaml

version, digest = sys.argv[1:]
if not digest.startswith('sha256:') or len(digest) != 71:
    raise SystemExit('A published sha256 image digest is required')
chart_path = Path('charts/renplay/Chart.yaml')
chart = yaml.safe_load(chart_path.read_text())
chart['version'] = chart['appVersion'] = version
annotations = chart['annotations']
annotations['artifacthub.io/images'] = yaml.safe_dump([
    {'name': 'renplay', 'image': 'ghcr.io/renplay-org/renplay@' + digest}
])
lines = Path('CHANGELOG.md').read_text().splitlines()
collecting = False
changes = []
for line in lines:
    if line.startswith('## [' + version + '] - '):
        collecting = True
        continue
    if collecting and line.startswith('## ['):
        break
    if collecting and line.startswith('- '):
        changes.append({'kind': 'changed', 'description': line[2:]})
    elif collecting and changes and line.startswith('  '):
        changes[-1]['description'] += ' ' + line.strip()
if not changes:
    raise SystemExit('Release needs a nonempty CHANGELOG section for ' + version)
annotations['artifacthub.io/changes'] = yaml.safe_dump(changes, sort_keys=False)
chart_path.write_text(yaml.safe_dump(chart, sort_keys=False))
values_path = Path('charts/renplay/values.yaml')
values = yaml.safe_load(values_path.read_text())
values['image']['digest'] = digest
values_path.write_text(yaml.safe_dump(values, sort_keys=False))
