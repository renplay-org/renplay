{{- if .Values.tests.enabled }}
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "renplay.fullname" . }}-test-connection
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "renplay.labels" . | nindent 4 }}
  annotations:
    helm.sh/hook: test
    helm.sh/hook-delete-policy: before-hook-creation
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  {{- with .Values.imagePullSecrets }}
  imagePullSecrets:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  securityContext:
    {{- toYaml .Values.podSecurityContext | nindent 4 }}
  containers:
    - name: connection
      image: {{ if .Values.tests.image.repository }}{{ printf "%s:%s" .Values.tests.image.repository (.Values.tests.image.tag | default .Chart.AppVersion) | quote }}{{ else }}{{ include "renplay.image" . | quote }}{{ end }}
      imagePullPolicy: {{ .Values.tests.image.pullPolicy }}
      securityContext:
        {{- toYaml .Values.securityContext | nindent 8 }}
      command: [curl]
      args:
        - -fsS
        - http://{{ include "renplay.fullname" . }}:{{ .Values.service.port }}/api/health
{{- end }}
