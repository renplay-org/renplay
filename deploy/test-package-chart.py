#!/usr/bin/env python3
"""Test release metadata preparation against a temporary fixture, never the registry."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import yaml

SCRIPT = Path(__file__).with_name('package-chart.py').resolve()


class PackageChartTest(unittest.TestCase):
    def test_release_metadata_uses_changelog_and_image_digest(self):
        with tempfile.TemporaryDirectory(prefix='renplay-chart-package-') as root:
            root = Path(root)
            chart = root / 'charts/renplay'
            chart.mkdir(parents=True)
            (chart / 'Chart.yaml').write_text('version: 0.0.0\nappVersion: 0.0.0\nannotations: {}\n')
            (chart / 'values.yaml').write_text('image:\n  digest: ""\n')
            (root / 'CHANGELOG.md').write_text(
                '## [Unreleased]\n- Not released.\n\n## [3.2.0] - 2026-11-06\n'
                '### Added\n- Downloads can use a separate mount.\n'
                '  Existing files stay where they are.\n\n## [3.1.0] - 2026-11-05\n- Old entry.\n')
            digest = 'sha256:' + 'a' * 64
            subprocess.run([sys.executable, SCRIPT, '3.2.0', digest], cwd=root, check=True)
            metadata = yaml.safe_load((chart / 'Chart.yaml').read_text())
            self.assertEqual(metadata['version'], '3.2.0')
            self.assertEqual(metadata['appVersion'], '3.2.0')
            self.assertEqual(yaml.safe_load(metadata['annotations']['artifacthub.io/changes']), [
                {'kind': 'changed', 'description': 'Downloads can use a separate mount. Existing files stay where they are.'}
            ])
            images = yaml.safe_load(metadata['annotations']['artifacthub.io/images'])
            self.assertEqual(images[0]['image'], 'ghcr.io/renplay-org/renplay@' + digest)
            self.assertEqual(yaml.safe_load((chart / 'values.yaml').read_text())['image']['digest'], digest)
            refused = subprocess.run([sys.executable, SCRIPT, '9.9.9', digest], cwd=root, capture_output=True)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn(b'nonempty CHANGELOG', refused.stderr)


if __name__ == '__main__':
    unittest.main()
