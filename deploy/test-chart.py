#!/usr/bin/env python3
"""Render chart variants and enforce Renplay's container installation contract.

Requires Helm and PyYAML. Does not contact a cluster or registry.
"""
import json
from pathlib import Path
import subprocess
import yaml

CHART = 'charts/renplay'


def render(*options):
    output = subprocess.check_output(['helm', 'template', 'renplay', CHART, *options], text=True)
    docs = [doc for doc in yaml.safe_load_all(output) if doc]
    deployment = next(doc for doc in docs if doc['kind'] == 'Deployment')
    pod = deployment['spec']['template']['spec']
    app = pod['containers'][0]
    assert deployment['spec']['replicas'] == 1
    assert deployment['spec']['strategy'] == {'type': 'Recreate'}
    assert pod['securityContext']['runAsNonRoot'] is True
    assert pod['securityContext']['runAsUser'] > 0
    assert pod['securityContext']['fsGroup'] > 0
    assert pod['automountServiceAccountToken'] is False
    assert app['securityContext']['readOnlyRootFilesystem'] is True
    assert app['securityContext']['allowPrivilegeEscalation'] is False
    assert app['securityContext']['capabilities']['drop'] == ['ALL']
    assert app['ports'][0]['containerPort'] == 8080
    for probe in ('startupProbe', 'livenessProbe', 'readinessProbe'):
        assert app[probe]['httpGet'] == {'path': '/api/health', 'port': 'http'}
    mounts = {mount['mountPath']: mount['name'] for mount in app['volumeMounts']}
    assert all(path in mounts for path in ('/data', '/games', '/tmp'))
    volumes = {volume['name']: volume for volume in pod['volumes']}
    assert volumes[mounts['/tmp']]['emptyDir'] == {}
    assert 'persistentVolumeClaim' in volumes[mounts['/data']]
    for claim in (doc for doc in docs if doc['kind'] == 'PersistentVolumeClaim'):
        assert claim['metadata']['annotations']['helm.sh/resource-policy'] == 'keep'
    return docs, app, volumes


docs, app, volumes = render()
assert len([doc for doc in docs if doc['kind'] == 'PersistentVolumeClaim']) == 2
assert 'downloads' not in volumes
version = json.loads(Path('server/package.json').read_text())['version']
chart = yaml.safe_load(Path(CHART, 'Chart.yaml').read_text())
assert chart['version'] == chart['appVersion'] == version
assert app['image'] == 'ghcr.io/renplay-org/renplay:' + version

_, _, volumes = render('--set', 'persistence.games.nfs.server=nas.example.com',
                       '--set', 'persistence.games.nfs.path=/exports/games')
assert volumes['games']['nfs'] == {'server': 'nas.example.com', 'path': '/exports/games'}

_, _, volumes = render('--set', 'persistence.data.existingClaim=data',
                       '--set', 'persistence.games.existingClaim=games',
                       '--set', 'persistence.downloads.enabled=true',
                       '--set', 'persistence.downloads.existingClaim=downloads')
for name in ('data', 'games', 'downloads'):
    assert volumes[name]['persistentVolumeClaim']['claimName'] == name

docs, app, volumes = render('--set', 'persistence.downloads.enabled=true')
assert len([doc for doc in docs if doc['kind'] == 'PersistentVolumeClaim']) == 3
assert volumes['downloads']['persistentVolumeClaim']['claimName'] == 'renplay-downloads'

_, app, volumes = render('--set', 'persistence.downloads.enabled=true',
                        '--set', 'persistence.downloads.nfs.server=nas.example.com',
                        '--set', 'persistence.downloads.nfs.path=/exports/downloads')
assert volumes['downloads']['nfs']['path'] == '/exports/downloads'
assert {'name': 'ARCHIVES_DIR', 'value': '/downloads'} in app['env']

for option, kind in [('ingress', 'Ingress'), ('httpRoute', 'HTTPRoute')]:
    options = ['--set', option + '.enabled=true']
    if option == 'httpRoute':
        options += ['--set', 'httpRoute.parentRefs[0].name=gateway']
    docs, _, _ = render(*options)
    assert any(doc['kind'] == kind for doc in docs)

_, app, volumes = render('--set', 'secret.oidcClientSecret.existingSecret=oidc',
                        '--set', 'secret.ldapBindPassword.existingSecret=ldap')
for name, variable in [('oidcClientSecret', 'RENPLAY_OIDC_CLIENT_SECRET_FILE'),
                       ('ldapBindPassword', 'RENPLAY_LDAP_BIND_PASSWORD_FILE')]:
    assert {'name': variable, 'value': '/run/secrets/' + name + '/value'} in app['env']
assert volumes['oidc-client-secret']['secret']['secretName'] == 'oidc'
assert volumes['ldap-bind-password']['secret']['secretName'] == 'ldap'

_, app, _ = render('--set', 'image.repository=docker.io/renplay/renplay',
                   '--set', 'image.digest=sha256:' + 'a' * 64)
assert app['image'] == 'docker.io/renplay/renplay@sha256:' + 'a' * 64

docs, app, _ = render('--set', 'service.enabled=false', '--set', 'tests.enabled=false',
                      '--set', 'config.envFrom[0].secretRef.name=environment')
assert not any(doc['kind'] == 'Service' for doc in docs)
assert app['envFrom'] == [{'secretRef': {'name': 'environment'}}]

for setting in ('replicaCount=2', 'strategy.type=RollingUpdate',
                'persistence.data.nfs.server=nas',
                'podSecurityContext.runAsUser=0',
                'persistence.games.existingClaim=games,persistence.games.nfs.server=nas'):
    result = subprocess.run(['helm', 'template', 'renplay', CHART, '--set', setting],
                            capture_output=True)
    assert result.returncode != 0, setting
print('PASS chart defaults, NFS, existing claims, downloads, routes, secrets, image and safety guards')
