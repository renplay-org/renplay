{{- range $name, $storage := .Values.persistence }}
{{- $nfs := $storage.nfs | default dict }}
{{- if and (or (ne $name "downloads") $storage.enabled) (not $storage.existingClaim) (not $nfs.server) }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "renplay.fullname" $ }}-{{ $name }}
  namespace: {{ $.Release.Namespace }}
  labels:
    {{- include "renplay.labels" $ | nindent 4 }}
  {{- with $storage.annotations }}
  annotations:
    {{- tpl (toYaml .) $ | nindent 4 }}
  {{- end }}
spec:
  accessModes:
    {{- toYaml $storage.accessModes | nindent 4 }}
  resources:
    requests:
      storage: {{ $storage.size | quote }}
  {{- if eq $storage.storageClass "-" }}
  storageClassName: ""
  {{- else if $storage.storageClass }}
  storageClassName: {{ $storage.storageClass | quote }}
  {{- end }}
{{- end }}
{{- end }}
