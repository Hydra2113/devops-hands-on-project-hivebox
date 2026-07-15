{{/* Common labels applied to every object this chart creates. */}}
{{- define "hivebox.labels" -}}
app: {{ .Chart.Name }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels: stable subset only — selectors are immutable. */}}
{{- define "hivebox.selectorLabels" -}}
app: {{ .Chart.Name }}
{{- end }}
