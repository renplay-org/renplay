#!/bin/sh
# Disposable local directory. No shared LDAP system or real accounts are used.
set -eu
name="renplay-31-lldap-test-$$"
cleanup() { docker rm -fv "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker run -d --name "$name" -p 127.0.0.1:17170:17170 -p 127.0.0.1:13890:3890 \
  -e LLDAP_JWT_SECRET=renplay-test-jwt-secret-long-enough \
  -e LLDAP_KEY_SEED=renplay-test-key-seed \
  -e LLDAP_LDAP_BASE_DN=dc=example,dc=org \
  -e LLDAP_LDAP_USER_PASS='directory password' lldap/lldap:stable >/dev/null
ready=false
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:17170/health >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then docker logs "$name"; exit 1; fi
RENPLAY_TEST_LLDAP="$name" npx vitest run src/__tests__/ldap.test.ts
