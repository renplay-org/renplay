{{- if .Values.httpRoute.enabled }}
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: {{ include "renplay.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "renplay.labels" . | nindent 4 }}
    {{- with .Values.httpRoute.labels }}
    {{- tpl (toYaml .) $ | nindent 4 }}
    {{- end }}
  {{- with .Values.httpRoute.annotations }}
  annotations:
    {{- tpl (toYaml .) $ | nindent 4 }}
  {{- end }}
spec:
  parentRefs:
    {{- tpl (toYaml (required "httpRoute.parentRefs is required" .Values.httpRoute.parentRefs)) $ | nindent 4 }}
  {{- with .Values.httpRoute.hostnames }}
  hostnames:
    {{- tpl (toYaml .) $ | nindent 4 }}
  {{- end }}
  rules:
    - backendRefs:
        - name: {{ include "renplay.fullname" . }}
          port: {{ .Values.service.port }}
      matches:
        {{- toYaml .Values.httpRoute.matches | nindent 8 }}
      {{- with .Values.httpRoute.filters }}
      filters:
        {{- tpl (toYaml .) $ | nindent 8 }}
      {{- end }}
{{- end }}
