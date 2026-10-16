#!/usr/bin/env bash
# Sourced after verified checkout. Diagnostics never select or replay deployment work.
deployment_evidence_start() {
  STOR24_DIAGNOSTIC_SHA=unknown
  [[ ${1-} =~ ^[a-f0-9]{40}$ ]] && STOR24_DIAGNOSTIC_SHA=$1
  STOR24_DIAGNOSTIC_PHASE=setup
  trap 'deployment_evidence_exit "$?"' EXIT
  deployment_phase setup
}

deployment_phase() {
  local phase=unknown status=null utc=unknown snapshot= container=unknown image=unknown
  local state=unknown health=unknown oom=unknown tag=unknown local_http=unknown
  case ${1-} in
    setup|pre-build|post-build|pre-migrate|post-migrate|pre-cutover|post-cutover|healthy|final)
      phase=$1 ;;
  esac
  [[ ${2-} =~ ^[0-9]{1,3}$ ]] && status=$2
  STOR24_DIAGNOSTIC_PHASE=${STOR24_DIAGNOSTIC_PHASE:-unknown}
  # On EXIT retain the last entered phase, even for a failed command in an && list.
  local last_phase=$STOR24_DIAGNOSTIC_PHASE
  [[ $phase == final ]] || STOR24_DIAGNOSTIC_PHASE=$phase
  utc=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || utc=unknown
  [[ $utc =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || utc=unknown
  case $phase in
    setup|pre-cutover|post-cutover|healthy|final)
      # Fixed template, fixed target, bounded runtime/output; never print raw inspect output.
      if snapshot=$(timeout 3 docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.OOMKilled}}|{{.Config.Image}}' stor24-crm-app-1 2>/dev/null | head -c 512); then
        if [[ $snapshot =~ ^([a-f0-9]{64})\|(sha256:[a-f0-9]{64})\|(created|running|paused|restarting|removing|exited|dead)\|(healthy|unhealthy|starting)?\|(true|false)\|(stor24-crm:[a-f0-9]{7,40})$ ]]; then
          container=${BASH_REMATCH[1]}; image=${BASH_REMATCH[2]}; state=${BASH_REMATCH[3]}
          health=${BASH_REMATCH[4]:-unknown}; oom=${BASH_REMATCH[5]}; tag=${BASH_REMATCH[6]}
        fi
      fi
      if local_http=$(timeout 3 curl --silent --max-time 2 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:3014/api/health 2>/dev/null | head -c 4); then
        [[ $local_http =~ ^[0-9]{3}$ ]] || local_http=unknown
      else
        local_http=unknown
      fi
      ;;
  esac
  printf 'STOR24_DEPLOY_PHASE {"utc":"%s","sha":"%s","phase":"%s","lastPhase":"%s","exitStatus":%s,"container":"%s","image":"%s","tag":"%s","state":"%s","health":"%s","oom":"%s","localHttp":"%s"}\n' \
    "$utc" "${STOR24_DIAGNOSTIC_SHA:-unknown}" "$phase" "$last_phase" "$status" \
    "$container" "$image" "$tag" "$state" "$health" "$oom" "$local_http" 2>/dev/null || :
  return 0
}

deployment_evidence_exit() {
  local status=$1
  trap - EXIT
  deployment_phase final "$status"
  exit "$status"
}
