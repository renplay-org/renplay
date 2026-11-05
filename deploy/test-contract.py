#!/usr/bin/env python3
"""Container contract tests, shared by CI and local Docker (Python standard library only).

Usage: python3 deploy/test-contract.py renplay:contract [users|smoke|upgrade|all]
The fixture engine is deliberately data-only: this tests native install/HTTP paths,
not Ren'Py execution in a browser. No game or engine downloads are needed.
"""
import base64
import io
import json
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
OLD = 'ghcr.io/renplay-org/renplay:2.11.1'
PREFIX = 'renplay-contract-' + uuid.uuid4().hex[:10]


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
        self.container = None
        for volume in self.volumes:
            docker('volume', 'create', volume)
        docker('run', '--rm', '--user', '0:0', '-v', self.volumes[0] + ':/data',
               '-v', self.volumes[1] + ':/games', '--entrypoint', 'sh', IMAGE,
               '-c', f'chown {uid}:{gid} /data /games')

    def start(self, image=IMAGE, options=()):
        self.container = self.name
        docker('run', '-d', '--name', self.name, '--read-only', '--tmpfs', '/tmp:rw,mode=1777',
               '-p', '127.0.0.1::8080', '-v', self.volumes[0] + ':/data',
               '-v', self.volumes[1] + ':/games', '-e', 'RENPLAY_AUTH=off',
               '-e', 'RENPLAY_CATALOG_URLS=http://127.0.0.1:9/catalog',
               '-e', 'RENPLAY_ENGINES_URL=http://127.0.0.1:9/engines',
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
        assert lib.request(game['playUrl'] + 'build.json')['images']['converted'] == 1
        image = lib.request(game['playUrl'] + 'game/images/pixel.png')
        assert image[:4] == b'RIFF' and image[8:12] == b'WEBP', 'Native WebP conversion failed'
        packed = lib.request(game['playUrl'] + 'game.zip')
        with zipfile.ZipFile(io.BytesIO(packed)) as archive:
            assert 'game/script.rpy' in archive.namelist()
        # The completed upload is removed, not kept as an unknown drop-folder download.
        assert lib.request('/api/archives')['archives'] == []
        print('PASS native install, page and game.zip:', docker('image', 'inspect', '--format', '{{.Architecture}}', IMAGE))
    finally:
        lib.close()


def upgrade():
    lib = Library('upgrade')
    try:
        docker('pull', OLD)
        lib.start(OLD)
        # Seed only metadata; no engine or game download. Write saves through the old API.
        js(lib.name, """
            const { Db } = await import('/app/server/dist/db.js');
            const db = Db.open('/data');
            db.insertGame({id:'upgrade-fixture', title:'Upgrade Fixture', save_dir:'Upgrade-123', favorite_at:'2026-01-01T00:00:00.000Z', play_time:42});
            db.close();
        """)
        path = '/api/saves/upgrade-fixture/file?path=Upgrade-123/1-1-LT1.save'
        lib.request(path, b'first save', 'PUT')
        lib.request(path, b'second save', 'PUT')
        original_history = lib.request('/api/saves/upgrade-fixture/history')['versions']
        assert len(original_history) == 1, original_history
        def save_tree():
            return json.loads(js(lib.name, """
                import { readdirSync, readFileSync } from 'node:fs';
                const files = {};
                function walk(dir) {
                    for (const entry of readdirSync(dir, {withFileTypes:true})) {
                        const path = dir + '/' + entry.name;
                        if (entry.isDirectory()) walk(path);
                        else files[path] = readFileSync(path).toString('base64');
                    }
                }
                walk('/data/saves'); walk('/data/save-history');
                console.log(JSON.stringify(files));
            """))
        original_tree = save_tree()
        assert any(path.startswith('/data/save-history/') for path in original_tree)
        lib.stop()
        lib.start()
        def verify():
            game = lib.request('/api/games/upgrade-fixture')['game']
            assert game['title'] == 'Upgrade Fixture' and game['playTime'] == 42 and game['favoriteAt'], game
            assert lib.request('/api/saves/upgrade-fixture/raw?path=Upgrade-123/1-1-LT1.save') == b'second save'
            assert lib.request('/api/saves/upgrade-fixture/history')['versions'] == original_history
            assert save_tree() == original_tree, 'Save or history bytes changed'
        verify()
        js(lib.name, """
            import { readFileSync, lstatSync } from 'node:fs';
            import { DatabaseSync } from 'node:sqlite';
            if (!lstatSync('/data/saves').isSymbolicLink()) throw Error('Missing rollback link');
            if (readFileSync('/data/users/1/saves/Upgrade-123/1-1-LT1.save', 'utf8') !== 'second save') throw Error('Owner save missing');
            const db = new DatabaseSync('/data/library.db');
            if (!db.prepare('SELECT 1 FROM users WHERE id=1').get()) throw Error('Accounts not migrated');
            db.close();
            readFileSync('/data/backups/pre-3.0/library.db');
        """)
        lib.stop()
        lib.start(OLD)
        verify()
        lib.stop()
        lib.start()
        verify()
        print('PASS upgrade, downgrade and re-upgrade from 2.11.1')
    finally:
        lib.close()


if __name__ == '__main__':
    for name, test in [('users', users), ('smoke', smoke), ('upgrade', upgrade)]:
        if SUITE in (name, 'all'):
            test()
