#!/usr/bin/env python3
"""Container contract tests, shared by CI and local Docker (Python standard library only).

Usage: python3 tests/contract.py renplay:contract [users|smoke|upgrade|all] [--downloads]
The fixture engine is deliberately data-only: this tests native install/HTTP paths,
not Ren'Py execution in a browser. No game or engine downloads are needed.
"""
import base64
import io
import json
import re
import struct
import subprocess
import sys
import time
import urllib.request
import uuid
import zipfile
import zlib

IMAGE = sys.argv[1]
SUITE = sys.argv[2] if len(sys.argv) > 2 else 'all'
if SUITE not in ('users', 'smoke', 'upgrade', 'all'):
    raise SystemExit('Suite must be users, smoke, upgrade or all')
# The newest release: what people upgrade from, and go back to if a new version goes wrong.
RELEASED = 'ghcr.io/renplay-org/renplay:latest'
PREFIX = 'renplay-contract-' + uuid.uuid4().hex[:10]
DOWNLOADS = '--downloads' in sys.argv


def docker(*args, data=None):
    return subprocess.check_output(['docker', *args], input=data).decode().strip()


def zip_bytes(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, body in entries.items():
            archive.writestr(name, body)
    return out.getvalue()


def js(container, code, data=None):
    return docker('exec', '-i', container, 'node', '--input-type=module', '-e', code, data=data)


class Library:
    def __init__(self, suffix, uid=1000, gid=1000):
        self.name = PREFIX + '-' + suffix
        self.volumes = [self.name + '-data', self.name + '-games']
        if DOWNLOADS:
            self.volumes.append(self.name + '-downloads')
        self.container = None
        for volume in self.volumes:
            docker('volume', 'create', volume)
        docker('run', '--rm', '--user', '0:0', '-v', self.volumes[0] + ':/data',
               '-v', self.volumes[1] + ':/games',
               *(['-v', self.volumes[2] + ':/downloads'] if DOWNLOADS else []),
               '--entrypoint', 'sh', IMAGE, '-c', f'chown {uid}:{gid} /data /games' + (' /downloads' if DOWNLOADS else ''))

    def start(self, image=IMAGE, options=()):
        self.container = self.name
        docker('run', '-d', '--name', self.name, '--read-only', '--tmpfs', '/tmp:rw,mode=1777',
               '-p', '127.0.0.1::8080', '-v', self.volumes[0] + ':/data',
               '-v', self.volumes[1] + ':/games', '-e', 'RENPLAY_AUTH=off',
               '-e', 'RENPLAY_CATALOG_URLS=http://127.0.0.1:9/catalog',
               '-e', 'RENPLAY_ENGINES_URL=http://127.0.0.1:9/engines',
               *(['-v', self.volumes[2] + ':/downloads'] if DOWNLOADS else []),
               *options, image)
        port = docker('port', self.name, '8080/tcp').rsplit(':', 1)[1]
        self.url = 'http://127.0.0.1:' + port
        for _ in range(120):
            try:
                self.request('/api/health')
                return
            except Exception:
                time.sleep(.5)
        raise RuntimeError('Container did not become healthy')

    def request(self, path, body=None, method=None):
        headers = {}
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        elif body is not None:
            headers['Content-Type'] = 'application/octet-stream'
        req = urllib.request.Request(self.url + path, data=body, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=15) as response:
            data = response.read()
            assert response.status == 200
            return json.loads(data) if 'application/json' in response.headers.get('Content-Type', '') else data

    def stop(self):
        if self.container:
            docker('rm', '-f', self.container)
            self.container = None

    def close(self):
        if self.container and sys.exc_info()[0] is not None:
            print(docker('logs', self.container))
        self.stop()
        for volume in self.volumes:
            docker('volume', 'rm', volume)


def users():
    modes = [('default', 1000, 1000, []), ('arbitrary', 568, 568, ['--user', '568:568']),
             ('unraid', 99, 100, ['--user', '0:0', '-e', 'PUID=99', '-e', 'PGID=100']),
             ('root-default', 1000, 1000, ['--user', '0:0'])]
    for name, uid, gid, options in modes:
        lib = Library(name, uid, gid)
        try:
            lib.start(options=options)
            # Ask the app to write, then check the actual file owner, not docker exec's user.
            lib.request('/api/uploads', {'name': 'ownership.zip', 'size': 1})
            result = json.loads(js(lib.name, """
                import { statSync, readdirSync } from 'node:fs';
                const path = '/games/_renplay/uploads/' + readdirSync('/games/_renplay/uploads').find(x => x.endsWith('.json'));
                const db = statSync('/data/library.db'), upload = statSync(path);
                console.log(JSON.stringify([db.uid, db.gid, upload.uid, upload.gid]));
            """))
            assert result == [uid, gid, uid, gid], result
            # A write through the app's UID to /data succeeds, including when PID 1 dropped root.
            js(lib.name, """
                import { readFileSync, writeFileSync, statSync } from 'node:fs';
                import { setuid, setgid, getuid } from 'node:process';
                const status = readFileSync('/proc/1/status', 'utf8');
                const uid = Number(status.match(/^Uid:\\s+(\\d+)/m)[1]);
                const gid = Number(status.match(/^Gid:\\s+(\\d+)/m)[1]);
                if (!uid) throw Error('Entrypoint stayed root');
                if (getuid() === 0) { setgid(gid); setuid(uid); }
                writeFileSync('/data/contract-write', 'ok');
                if (statSync('/data/contract-write').uid !== uid) throw Error('Wrong owner');
            """)
            for _ in range(80):
                health = docker('inspect', '--format', '{{.State.Health.Status}}', lib.name)
                if health == 'healthy':
                    break
                time.sleep(.5)
            assert health == 'healthy', health
            print('PASS user mode:', name)
        finally:
            lib.close()
    refused = subprocess.run(['docker', 'run', '--rm', '--read-only', '--user', '0:0',
                              '-e', 'PUID=0', IMAGE], capture_output=True)
    assert refused.returncode != 0 and b'PUID must be' in refused.stderr, refused.stderr
    print('PASS refuses PUID=0')


def smoke():
    lib = Library('smoke')
    try:
        lib.start()
        system = lib.request('/api/system')
        assert system['paths']['archives'] == ('/downloads' if DOWNLOADS else '/games/_archives'), system
        assert system['keepDownloads'] is True
        engine_zip = base64.b64encode(zip_bytes({'renpy/__init__.py': '', 'main.py': ''})).decode()
        js(lib.name, """
            import { mkdirSync, writeFileSync } from 'node:fs';
            const dir = '/games/_renplay/engines/8.5.3/';
            mkdirSync(dir, { recursive: true });
            writeFileSync(dir + '.ready', '{}');
            writeFileSync(dir + 'index.html', '<!doctype html><html><head><title>Fixture</title></head><body><script>window.gameZipURL = "game.zip";</script><script src="renpy-pre.js"></script><script src="renpy.js"></script></body></html>');
            writeFileSync(dir + 'renpy.zip', Buffer.from(""" + json.dumps(engine_zip) + """, 'base64'));
        """)
        # PNG forces native sharp/libvips through the same conversion as a real game.
        def png_chunk(kind, data):
            return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
        pixels = b''.join(b'\x00' + bytes([y, 100, 150]) * 64 for y in range(64))
        png = (b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('!2I5B', 64, 64, 8, 2, 0, 0, 0))
               + png_chunk(b'IDAT', zlib.compress(pixels, 0)) + png_chunk(b'IEND', b''))
        fixture = zip_bytes({'Fixture/game/script.rpy': 'label start:\n    "Hello."\n    return\n',
                             'Fixture/game/options.rpy': 'define config.name = "Contract Fixture"\ndefine config.save_directory = "Contract-123"\n',
                             'Fixture/game/images/pixel.png': png,
                             'Fixture/renpy/vc_version.py': 'version = "8.5.3"\n'})
        upload = lib.request('/api/uploads', {'name': 'Contract-1.0-pc.zip', 'size': len(fixture)})['id']
        lib.request('/api/uploads/' + upload + '?offset=0', fixture, 'PUT')
        path = lib.request('/api/uploads/' + upload + '/complete', {}, 'POST')['path']
        job = lib.request('/api/imports', {'source': {'kind': 'archive', 'path': path}, 'engine': '8.5.3'})['jobId']
        for _ in range(120):
            jobs = lib.request('/api/jobs')['jobs']
            row = next(j for j in jobs if j['id'] == job)
            if row['status'] in ('done', 'failed', 'cancelled'):
                break
            time.sleep(.5)
        assert row['status'] == 'done', row
        game = lib.request('/api/games')['games'][0]
        assert game['status'] == 'installed' and game['engine'] == '8.5.3', game
        page = lib.request(game['playUrl'])
        assert b'renplay' in page.lower(), page
        # The page's runtime, which nginx asks the server for.
        runtime = re.search(rb'src="(/renplay/runtime\.js\?v=[0-9a-f]+)"', page)
        assert runtime, page
        assert b'renplay:fullscreen-state' in lib.request(runtime.group(1).decode()), 'The runtime lacks its shared part'
        assert lib.request(game['playUrl'] + 'build.json')['images']['converted'] == 1
        image = lib.request(game['playUrl'] + 'game/images/pixel.png')
        assert image[:4] == b'RIFF' and image[8:12] == b'WEBP', 'Native WebP conversion failed'
        packed = lib.request(game['playUrl'] + 'game.zip')
        with zipfile.ZipFile(io.BytesIO(packed)) as archive:
            assert 'game/script.rpy' in archive.namelist()
        # Default retention preserves the completed upload, also across filesystems.
        assert game['canReinstall'] is True
        assert len(lib.request('/api/archives')['archives']) == 1
        lib.request('/api/games/' + game['id'] + '/download', method='DELETE')
        assert lib.request('/api/games/' + game['id'])['game']['canReinstall'] is False
        assert lib.request('/api/games/' + game['id'])['game']['status'] == 'installed'
        assert lib.request('/api/archives')['archives'] == []
        print('PASS native install, page and game.zip:', docker('image', 'inspect', '--format', '{{.Architecture}}', IMAGE))
    finally:
        lib.close()


def upgrade():
    """From the newest release to this image, back to the release, and up again: saves, their
    history and everything people set stay as they were."""
    lib = Library('upgrade')
    try:
        docker('pull', RELEASED)
        lib.start(RELEASED)
        js(lib.name, """
            const { Db } = await import('/app/server/dist/db.js');
            const db = Db.open('/data');
            db.insertGame({id:'story', title:'Story', status:'installed', save_dir:'Story-1'});
            db.close();
        """)
        lib.request('/api/games/story/favorite', {'on': True}, 'PUT')
        lib.request('/api/games/story/status', {'status': 'finished'}, 'PUT')
        lib.request('/api/games/story/play-time', {'seconds': 30}, 'POST')
        lib.request('/api/games/story/rating', {'rating': 4}, 'PUT')
        path = '/api/saves/story/file?path=Story-1/1-1-LT1.save'
        lib.request(path, b'first save', 'PUT')
        lib.request(path, b'second save', 'PUT')
        lib.request('/api/saves/story/meta?file=1-1-LT1.save', {'title': 'Before the storm', 'note': 'Lake next time.', 'pinned': True}, 'PUT')
        history = lib.request('/api/saves/story/history')['versions']
        assert len(history) == 1, history
        before = lib.request('/api/games/story')['game']

        def save_tree():
            return json.loads(js(lib.name, """
                import { readdirSync, readFileSync } from 'node:fs';
                const files = {};
                function walk(dir) {
                    for (const entry of readdirSync(dir, {withFileTypes:true})) {
                        const path = dir + '/' + entry.name;
                        if (entry.isDirectory()) walk(path);
                        else if (entry.isFile() && /\\/(saves|save-history)\\//.test(path)) files[path] = readFileSync(path).toString('base64');
                    }
                }
                walk('/data/users');
                console.log(JSON.stringify(files));
            """))

        def verify(save):
            game = lib.request('/api/games/story')['game']
            for key in ('favoriteAt', 'finishedAt', 'playTime', 'playStatus', 'rating'):
                assert game[key] == before[key], (key, game[key], before[key])
            assert lib.request('/api/saves/story/raw?path=Story-1/1-1-LT1.save') == save
            slot = [s for s in lib.request('/api/saves/story')['slots'] if s['file'] == '1-1-LT1.save']
            assert slot and slot[0]['title'] == 'Before the storm' and slot[0]['note'] == 'Lake next time.' and slot[0]['pinnedAt'], slot

        tree = save_tree()
        assert len(tree) >= 2, tree
        lib.stop()

        lib.start()
        verify(b'second save')
        assert lib.request('/api/saves/story/history')['versions'] == history
        assert save_tree() == tree, 'Save or history bytes changed on the upgrade'
        lib.request(path, b'third save', 'PUT')
        lib.stop()

        lib.start(RELEASED)
        verify(b'third save')
        lib.request(path, b'fourth save', 'PUT')
        lib.stop()

        lib.start()
        verify(b'fourth save')
        assert len(lib.request('/api/saves/story/history')['versions']) == 3
        print('PASS upgrade from the newest release, back to it and up again')
    finally:
        lib.close()


if __name__ == '__main__':
    for name, test in [('users', users), ('smoke', smoke), ('upgrade', upgrade)]:
        if SUITE in (name, 'all'):
            test()
