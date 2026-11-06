{{- if .Values.service.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "renplay.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "renplay.labels" . | nindent 4 }}
  {{- with .Values.service.annotations }}
  annotations:
    {{- tpl (toYaml .) $ | nindent 4 }}
  {{- end }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
  selector:
    {{- include "renplay.selectorLabels" . | nindent 4 }}
{{- else if or .Values.ingress.enabled .Values.httpRoute.enabled .Values.tests.enabled }}
{{- fail "Ingress, HTTPRoute and helm test require service.enabled=true" }}
{{- end }}
