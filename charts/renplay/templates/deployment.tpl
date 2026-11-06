{{- if or (lt (int .Values.replicaCount) 0) (gt (int .Values.replicaCount) 1) -}}
{{- fail "Renplay uses one SQLite writer. replicaCount must be 0 or 1." -}}
{{- end -}}
{{- if ne .Values.strategy.type "Recreate" -}}
{{- fail "Renplay requires strategy.type Recreate." -}}
{{- end -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "renplay.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "renplay.labels" . | nindent 4 }}
  {{- with .Values.deploymentAnnotations }}
  annotations:
    {{- tpl (toYaml .) $ | nindent 4 }}
  {{- end }}
spec:
  replicas: {{ .Values.replicaCount }}
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "renplay.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "renplay.labels" . | nindent 8 }}
        {{- with .Values.podLabels }}
        {{- tpl (toYaml .) $ | nindent 8 }}
        {{- end }}
      {{- with .Values.podAnnotations }}
      annotations:
        {{- tpl (toYaml .) $ | nindent 8 }}
      {{- end }}
    spec:
      enableServiceLinks: false
      serviceAccountName: {{ include "renplay.serviceAccountName" . }}
      automountServiceAccountToken: {{ .Values.serviceAccount.automount }}
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- tpl (toYaml .) $ | nindent 8 }}
      {{- end }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}
      containers:
        - name: renplay
          image: {{ include "renplay.image" . | quote }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          env:
            - name: DATA_DIR
              value: /data
            - name: GAMES_DIR
              value: /games
            - name: RENPLAY_DIR
              value: /games/_renplay
            {{- if .Values.persistence.downloads.enabled }}
            # Explicit for compatibility with images before automatic detection.
            - name: ARCHIVES_DIR
              value: /downloads
            {{- end }}
            {{- range $name, $secret := .Values.secret }}
            {{- if $secret.existingSecret }}
            - name: {{ if eq $name "oidcClientSecret" }}RENPLAY_OIDC_CLIENT_SECRET_FILE{{ else }}RENPLAY_LDAP_BIND_PASSWORD_FILE{{ end }}
              value: /run/secrets/{{ $name }}/value
            {{- end }}
            {{- end }}
            {{- with .Values.config.extraEnv }}
            {{- tpl (toYaml .) $ | nindent 12 }}
            {{- end }}
          {{- with .Values.config.envFrom }}
          envFrom:
            {{- tpl (toYaml .) $ | nindent 12 }}
          {{- end }}
          livenessProbe:
            {{- toYaml .Values.livenessProbe | nindent 12 }}
          readinessProbe:
            {{- toYaml .Values.readinessProbe | nindent 12 }}
          startupProbe:
            {{- toYaml .Values.startupProbe | nindent 12 }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          volumeMounts:
            - name: data
              mountPath: /data
            - name: games
              mountPath: /games
            {{- if .Values.persistence.downloads.enabled }}
            - name: downloads
              mountPath: /downloads
            {{- end }}
            - name: tmp
              mountPath: /tmp
            {{- range $name, $secret := .Values.secret }}
            {{- if $secret.existingSecret }}
            - name: {{ $name | kebabcase }}
              mountPath: /run/secrets/{{ $name }}
              readOnly: true
            {{- end }}
            {{- end }}
      volumes:
        {{- range $name, $storage := .Values.persistence }}
        {{- if or (ne $name "downloads") $storage.enabled }}
        {{- $nfs := $storage.nfs | default dict }}
        {{- if and $storage.existingClaim $nfs.server }}
        {{- fail (printf "persistence.%s: choose existingClaim or NFS, not both" $name) }}
        {{- end }}
        - name: {{ $name }}
          {{- if $nfs.server }}
          nfs:
            server: {{ $nfs.server | quote }}
            path: {{ required (printf "persistence.%s.nfs.path is required" $name) $nfs.path | quote }}
          {{- else }}
          persistentVolumeClaim:
            claimName: {{ $storage.existingClaim | default (printf "%s-%s" (include "renplay.fullname" $) $name) | quote }}
          {{- end }}
        {{- end }}
        {{- end }}
        - name: tmp
          emptyDir: {}
        {{- range $name, $secret := .Values.secret }}
        {{- if $secret.existingSecret }}
        - name: {{ $name | kebabcase }}
          secret:
            secretName: {{ tpl $secret.existingSecret $ | quote }}
            defaultMode: 0440
            items:
              - key: {{ $secret.key | quote }}
                path: value
        {{- end }}
        {{- end }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- tpl (toYaml .) $ | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- tpl (toYaml .) $ | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- tpl (toYaml .) $ | nindent 8 }}
      {{- end }}
