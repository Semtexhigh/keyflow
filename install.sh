#!/bin/bash
# ---------------------------------------------------------------------------
#  Keyflow installer for macOS
#
#  Runs on a factory-fresh Mac: only bash 3.2, curl, tar, wc, xattr, open and
#  osascript are used -- all of which ship with macOS. No Python, no Homebrew.
#
#  One-liner:
#    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Semtexhigh/keyflow/main/install.sh)"
#
#  Options (environment variables):
#    KEYFLOW_DEST=/Applications   install somewhere other than ~/Applications
#    KEYFLOW_PLAIN=1              no animation, plain text output
#    KEYFLOW_NO_OPEN=1            install but do not launch
# ---------------------------------------------------------------------------

set -u

REPO="Semtexhigh/keyflow"
APP="Keyflow"
DEST="${KEYFLOW_DEST:-$HOME/Applications}"
case "$(uname -m)" in
  arm64|aarch64) ASSET="Keyflow_aarch64.app.tar.gz"; ARCH_LABEL="Apple silicon" ;;
  *)             ASSET="Keyflow_x64.app.tar.gz";     ARCH_LABEL="Intel" ;;
esac
URL="${KEYFLOW_URL:-https://github.com/$REPO/releases/latest/download/$ASSET}"

if [ "$(uname -s)" != "Darwin" ] && [ -z "${KEYFLOW_TEST:-}" ]; then
  echo "Keyflow for desktop installs on macOS only." >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/keyflow.XXXXXX")" || { echo "Could not create a temp folder." >&2; exit 1; }
FILE="$TMP/$ASSET"
E=$'\033'
CPID=""
FANCY=0
VERSION=""
TOTAL=0

# ---------------------------------------------------------------- helpers --
fmt_mb() {            # bytes -> "5.0 MB" into $REPLY
  local t=$(( $1 * 10 / 1048576 ))
  REPLY="$((t / 10)).$((t % 10)) MB"
}
fmt_time() {          # seconds -> m:ss into $REPLY
  local s=$1
  REPLY="$((s / 60)):$(printf '%02d' $((s % 60)))"
}
fsize() {             # file size in bytes, works with BSD and GNU wc
  local n
  [ -f "$1" ] || { REPLY=0; return; }
  n=$(wc -c <"$1" 2>/dev/null) || n=0
  REPLY=$(( ${n:-0} + 0 ))
}
short_dest() {
  case "$DEST" in "$HOME"*) REPLY="~${DEST#$HOME}" ;; *) REPLY="$DEST" ;; esac
}

cleanup() {
  local rc=$?
  [ -n "$CPID" ] && kill "$CPID" 2>/dev/null
  rm -rf "$TMP"
  if [ "$FANCY" = 1 ]; then
    if [ "$rc" = 130 ]; then
      printf '%s[%d;%dH%s[0m%s[38;5;203m  Cancelled.%s[0m%s[K\n' "$E" $((Y0 + 19)) "$X0" "$E" "$E" "$E" "$E"
      printf '%s[J' "$E"
    fi
    printf '%s[0m%s[?25h' "$E" "$E"
    stty echo 2>/dev/null </dev/tty
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

# ------------------------------------------------------------- the work ----
resolve_release() {   # HEAD request: size + version tag, written to $TMP/head
  curl -sIL --connect-timeout 15 "$URL" 2>/dev/null | tr -d '\r' >"$TMP/head"
}
parse_release() {
  TOTAL=$(awk 'tolower($1)=="content-length:"{v=$2} END{print v+0}' "$TMP/head")
  VERSION=$(awk 'tolower($1)=="location:" && $2 ~ /releases\/download\//{
                   n=split($2,p,"/"); for(i=1;i<n;i++) if(p[i]=="download"){print p[i+1]; exit} }' "$TMP/head")
  LAST_STATUS=$(awk '$1 ~ /^HTTP\//{s=$2} END{print s+0}' "$TMP/head")
}
start_download() {
  curl -fsL --retry 2 --connect-timeout 15 -o "$FILE" \
       -w '%{size_download} %{speed_download} %{time_total}\n' \
       "$URL" >"$TMP/curl.out" 2>"$TMP/curl.err" &
  CPID=$!
}
unpack()  { mkdir -p "$TMP/x" && tar -xzf "$FILE" -C "$TMP/x" 2>"$TMP/tar.err"; }
find_app() {
  REPLY=""
  if [ -d "$TMP/x/$APP.app" ]; then REPLY="$TMP/x/$APP.app"; return; fi
  local d
  for d in "$TMP"/x/*.app "$TMP"/x/*/*.app; do
    [ -d "$d" ] && { REPLY="$d"; return; }
  done
}
install_app() {       # quit a running copy, replace, clear quarantine
  if pgrep -ix "$APP" >/dev/null 2>&1; then
    osascript -e "tell application \"$APP\" to quit" >/dev/null 2>&1
    local n=0
    while pgrep -ix "$APP" >/dev/null 2>&1 && [ $n -lt 25 ]; do sleep 0.2; n=$((n + 1)); done
  fi
  mkdir -p "$DEST" || return 1
  rm -rf "$DEST/$APP.app" || return 1
  mv "$1" "$DEST/$APP.app" || return 1
  xattr -dr com.apple.quarantine "$DEST/$APP.app" 2>/dev/null
  return 0
}
launch_app() {
  [ -n "${KEYFLOW_NO_OPEN:-}" ] && return 0
  open "$DEST/$APP.app" 2>/dev/null
}

# =========================================================== plain mode ====
plain_bar() {
  local w=40 f=$(( $1 * 40 / 100 )) s="" i
  for ((i = 0; i < w; i++)); do if ((i < f)); then s+="#"; else s+="-"; fi; done
  printf '\r  [%s] %3d%%' "$s" "$1"
}
run_plain() {
  local pct act
  echo
  echo "  Keyflow installer ($ARCH_LABEL)"
  echo
  printf '  Resolving latest release... '
  resolve_release; parse_release
  if [ "${LAST_STATUS:-0}" != 200 ]; then echo "failed"; echo "  Could not reach $URL" >&2; exit 1; fi
  fmt_mb "$TOTAL"; echo "${VERSION:-latest} ($REPLY)"
  echo "  Downloading..."
  start_download
  while kill -0 "$CPID" 2>/dev/null; do
    fsize "$FILE"; act=$REPLY
    if ((TOTAL > 0)); then pct=$((act * 100 / TOTAL)); ((pct > 100)) && pct=100; plain_bar "$pct"; fi
    sleep 0.2
  done
  wait "$CPID"; local rc=$?; CPID=""
  if [ $rc != 0 ]; then echo; echo "  Download failed: $(cat "$TMP/curl.err")" >&2; exit 1; fi
  plain_bar 100; echo
  printf '  Unpacking... ';  unpack || { echo "failed"; exit 1; }; echo "done"
  find_app; [ -n "$REPLY" ] || { echo "  The download did not contain $APP.app" >&2; exit 1; }
  printf '  Installing... '; install_app "$REPLY" || { echo "failed"; exit 1; }; echo "done"
  launch_app
  short_dest
  echo
  echo "  Keyflow ${VERSION} is installed in $REPLY/$APP.app"
  echo
}

# =========================================================== fancy mode ====
G=(ｱ ｲ ｳ ｴ ｵ ｶ ｷ ｸ ｹ ｺ ｻ ｼ ｽ ｾ ｿ ﾀ ﾁ ﾂ ﾃ ﾄ ﾅ ﾆ ﾇ ﾈ ﾉ ﾊ ﾋ ﾌ ﾍ ﾎ ﾏ ﾐ ﾑ ﾒ ﾓ ﾔ ﾕ ﾖ ﾗ ﾘ ﾙ ﾚ ﾛ ﾜ ﾝ 0 1 2 3 4 5 7 8 9 Z : . = + '*' '<' '>' '|' ¦)
NG=${#G[@]}
SP=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
PB=("" ▏ ▎ ▍ ▌ ▋ ▊ ▉)
BARC=(22 22 28 28 34 34 35 40 41 46 47 48 84 120 121 157 158 194 195)
NB=${#BARC[@]}
PIEC=(22 28 34 40 46 47 48 84 120 121 157 194 195 231)
NP=${#PIEC[@]}

# KEYFLOW wordmark, 3 rows of half-blocks
WM1="█ ▄▀  █▀▀▀  █   █  █▀▀▀  █     █▀▀█  █   █"
WM2="█▀▄   █▀▀    ▀█▀   █▀▀   █     █  █  █ █ █"
WM3="▀  ▀  ▀▀▀▀    ▀    ▀     ▀▀▀▀  ▀▀▀▀   ▀ ▀ "
WMW=42

FRAME=0
OUT=""
mv_to() { OUT+="$E[$1;$2H"; }

# -------------------------------------------------------------- rain -------
# Each column has a falling head; trail cells are recoloured behind it and the
# tail is erased. Only changed cells are written, so it stays light.
rain_init() {        # $1 height  $2 max extra trail  $3 sparsity
  RH=$1; RT=$2; RSP=$3; RSTOP=0
  local i
  for ((i = 0; i < W; i++)); do
    RHD[i]=$(( -(RANDOM % (RH * RSP + 1)) ))
    RL[i]=$(( 3 + RANDOM % RT ))
    RS[i]=$(( 1 + RANDOM % 3 ))
  done
}
rain_cell() {        # $1 top  $2 y  $3 col  $4 colour  (glyph random)
  ((${2} < 0 || ${2} >= RH)) && return
  OUT+="$E[$(( $1 + $2 ));$3H$E[38;5;$4m${G[RANDOM % NG]}"
}
rain_step() {        # $1 absolute top row
  local top=$1 i h l col alive=0
  for ((i = 0; i < W; i++)); do
    h=${RHD[i]}; l=${RL[i]}
    if (( h - l >= RH )); then
      ((RSTOP)) && continue
      RHD[i]=$(( -(RANDOM % (RH * RSP + 1)) )); RL[i]=$(( 3 + RANDOM % RT )); RS[i]=$(( 1 + RANDOM % 3 ))
      continue
    fi
    alive=1
    (( (FRAME + i) % RS[i] )) && continue
    col=$((X0 + i))
    rain_cell "$top" "$h" "$col" 231
    rain_cell "$top" $((h - 1)) "$col" 46
    rain_cell "$top" $((h - 3)) "$col" 34
    ((l > 5)) && rain_cell "$top" $((h - 5)) "$col" 28
    ((l > 7)) && rain_cell "$top" $((h - 7)) "$col" 22
    if (( h - l >= 0 && h - l < RH )); then OUT+="$E[$((top + h - l));${col}H "; fi
    RHD[i]=$((h + 1))
  done
  RALIVE=$alive
}
rain_clear() {       # $1 top
  local y
  for ((y = 0; y < RH; y++)); do OUT+="$E[$(( $1 + y ));${X0}H$E[0m$(printf '%*s' "$W" '')"; done
}

# -------------------------------------------------------------- pie --------
# A donut chart, 7 rows x 15 cols. Each cell's angle (clockwise from 12
# o'clock) is computed once; -1 = outside, -2 = the hole.
pie_init() {
  PANG=( $(awk 'BEGIN{ pi=atan2(0,-1)
    for(y=0;y<7;y++) for(x=0;x<15;x++){
      dx=x-7; dy=(y-3)*2.1; d=sqrt(dx*dx+dy*dy)
      if(d>7.4) a=-1; else if(d<3.6) a=-2; else { a=int(atan2(dx,-dy)*180/pi); if(a<0) a+=360 }
      printf "%d ", a }}') )
  LAST_PIE=-1
}
draw_pie() {         # uses PCT (or spinner when TOTAL is unknown)
  local key=$PCT
  ((TOTAL == 0 && PHASE == 2)) && key=$((1000 + FRAME % 24))
  ((key == LAST_PIE)) && return
  LAST_PIE=$key
  local y x a idx=0 deg=$((PCT * 360 / 100)) rot=$(( (FRAME % 24) * 15 )) on s
  for ((y = 0; y < 7; y++)); do
    s="$E[$((Y0 + 8 + y));$((X0 + 2))H"
    for ((x = 0; x < 15; x++)); do
      a=${PANG[idx]}; idx=$((idx + 1))
      if ((a < 0)); then s+=" "; continue; fi
      if ((key >= 1000)); then on=$(( (a - rot + 360) % 360 < 100 )); else on=$((a < deg)); fi
      if ((on)); then s+="$E[38;5;${PIEC[a * NP / 360]}m█"; else s+="$E[38;5;236m█"; fi
    done
    OUT+="$s"
  done
  if ((key >= 1000)); then s=" ·· "; else printf -v s '%3d%%' "$PCT"; fi
  OUT+="$E[$((Y0 + 11));$((X0 + 7))H$E[1;38;5;231m$s$E[0m"
}

# -------------------------------------------------------------- steps ------
STEP_T=("Resolving latest release" "Downloading" "Unpacking app bundle" "Verifying bundle" "Installing to ~/Applications" "Launching Keyflow")
STEP_X=("" "" "" "" "" "")
ST=(0 0 0 0 0 0)
STATLINE=""
draw_steps() {
  local i ic tc t n
  for ((i = 0; i < 6; i++)); do
    case ${ST[i]} in
      0) ic="$E[38;5;239m○"; tc="$E[38;5;242m" ;;
      1) ic="$E[38;5;46m${SP[FRAME % 10]}"; tc="$E[1;38;5;231m" ;;
      2) ic="$E[38;5;46m✓"; tc="$E[38;5;250m" ;;
      3) ic="$E[38;5;196m✗"; tc="$E[1;38;5;203m" ;;
    esac
    t="${STEP_T[i]}${STEP_X[i]}"
    ((${#t} > SW)) && t="${t:0:$((SW - 1))}…"
    n=${#STEP_T[i]}; ((n > ${#t})) && n=${#t}
    OUT+="$E[$((Y0 + 8 + i));$((X0 + 21))H$ic  $tc${t:0:$n}$E[0m$E[38;5;244m${t:$n}$E[0m$E[K"
  done
  OUT+="$E[$((Y0 + 14));$((X0 + 24))H$E[38;5;244m$STATLINE$E[0m$E[K"
}

# -------------------------------------------------------------- bar --------
LAST_BAR=-1
draw_bar() {
  local f8
  if ((TOTAL > 0)); then f8=$(( SHOWN * BW * 8 / TOTAL )); else f8=0; fi
  ((f8 > BW * 8)) && f8=$((BW * 8))
  local key=$f8
  ((TOTAL == 0 && PHASE == 2)) && key=$((100000 + FRAME))
  ((key == LAST_BAR)) && return
  LAST_BAR=$key
  local full=$((f8 / 8)) part=$((f8 % 8)) i s="$E[$((Y0 + 16));$((X0 + 2))H" c
  if ((key >= 100000)); then           # size unknown: a sweeping glow
    local p=$(( FRAME % (BW + 10) - 5 ))
    for ((i = 0; i < BW; i++)); do
      if ((i >= p - 4 && i <= p + 4)); then s+="$E[38;5;46m█"; else s+="$E[38;5;236m━"; fi
    done
    OUT+="$s$E[0m"; return
  fi
  for ((i = 0; i < full; i++)); do
    if ((i == full - 1 && full < BW)); then c=231; else c=${BARC[i * NB / BW]}; fi
    s+="$E[38;5;${c}m█"
  done
  if ((full < BW)); then
    i=$full
    if ((part > 0)); then s+="$E[38;5;231m${PB[part]}"; i=$((i + 1)); fi
    s+="$E[38;5;236m"
    for (( ; i < BW; i++)); do s+="━"; done
  fi
  printf -v c '%4d%%' "$PCT"
  OUT+="$s$E[0m $E[1;38;5;231m$c$E[0m$E[K"
}
draw_caption() {
  local a b
  OUT+="$E[$((Y0 + 17));$((X0 + 2))H$E[38;5;244m$CAPTION$E[0m$E[K"
}

frame() {
  OUT=""
  draw_pie
  draw_steps
  draw_bar
  draw_caption
  rain_step $((Y0 + 19))
  printf '%s' "$OUT"
  FRAME=$((FRAME + 1))
}
run_bg() {           # $1 step index, rest = function to run in background; min 12 frames
  local idx=$1; shift
  ST[idx]=1
  "$@" &
  local pid=$! n=0
  while kill -0 "$pid" 2>/dev/null || ((n < 12)); do frame; sleep 0.03; n=$((n + 1)); done
  wait "$pid"
  BG_RC=$?
  return $BG_RC
}
fail() {             # $1 step  $2 message
  ST[$1]=3
  STATLINE=""
  frame
  OUT=""; RSTOP=1; rain_clear $((Y0 + 19)); printf '%s' "$OUT"
  printf '%s[%d;%dH%s[38;5;196m✗%s[0m  %s[1;38;5;231m%s%s[0m%s[K\n' "$E" $((Y0 + 19)) $((X0 + 2)) "$E" "$E" "$E" "$2" "$E" "$E"
  printf '%s[%d;%dH%s[38;5;244m   Plain command: curl -L %s | tar xz%s[0m%s[K\n' "$E" $((Y0 + 20)) $((X0 + 2)) "$E" "$URL" "$E" "$E"
  printf '%s[%d;1H' "$E" $((Y0 + 22))
  exit 1
}

run_fancy() {
  FANCY=1
  exec 3>&2 2>>"$TMP/stderr.log"   # stray warnings must never scroll the dashboard
  stty -echo 2>/dev/null </dev/tty
  printf '%s[?25l%s[2J%s[H' "$E" "$E" "$E"

  # ---- intro: full-screen rain that clears into the wordmark
  rain_init 22 12 1
  local k
  for ((k = 0; k < 34; k++)); do OUT=""; rain_step "$Y0"; printf '%s' "$OUT"; FRAME=$((FRAME + 1)); sleep 0.025; done
  printf '%s[0m%s[2J' "$E" "$E"

  local wx=$(( X0 + (W - WMW) / 2 ))
  local tag="P A S S W O R D   V A U L T"
  printf '%s[%d;%dH%s[38;5;244m%s%s[0m' "$E" $((Y0 + 1)) $(( X0 + (W - ${#tag}) / 2 )) "$E" "$tag" "$E"
  for ((k = 0; k <= WMW; k += 2)); do        # left-to-right decode of the wordmark
    OUT=""
    local r line
    for r in 1 2 3; do
      eval "line=\$WM$r"
      OUT+="$E[$((Y0 + 1 + r));${wx}H$E[1;38;5;231m$line$E[K"
      if ((k < WMW)); then
        OUT+="$E[$((Y0 + 1 + r));$((wx + k))H$E[38;5;46m${G[RANDOM % NG]}${G[RANDOM % NG]}$E[38;5;28m${G[RANDOM % NG]}$E[K"
      fi
    done
    printf '%s' "$OUT"; sleep 0.018
  done
  printf '%s[0m' "$E"

  # static chrome
  local sub="desktop installer  ·  $ARCH_LABEL  ·  macOS $(sw_vers -productVersion 2>/dev/null || echo)"
  printf '%s[%d;%dH%s[38;5;242m%s%s[0m' "$E" $((Y0 + 5)) $(( X0 + (W - ${#sub}) / 2 + 1 )) "$E" "$sub" "$E"
  local rule; rule=$(printf '%*s' "$W" '' | sed 's/ /─/g')
  printf '%s[%d;%dH%s[38;5;236m%s%s[0m' "$E" $((Y0 + 6)) "$X0" "$E" "$rule" "$E"

  pie_init
  rain_init 4 4 4
  short_dest; STEP_T[4]="Installing to $REPLY"
  PCT=0; SHOWN=0; PHASE=1; CAPTION=""

  # ---- 1. resolve
  run_bg 0 resolve_release
  parse_release
  if [ "${LAST_STATUS:-0}" != 200 ]; then
    if [ "${LAST_STATUS:-0}" = 404 ]; then fail 0 "No $ASSET in the latest release."; fi
    fail 0 "Could not reach GitHub. Check the connection and try again."
  fi
  ST[0]=2; STEP_X[0]="  ${VERSION:-latest}"
  fmt_mb "$TOTAL"; ((TOTAL > 0)) && STEP_X[1]="  $REPLY"
  if [ -n "$VERSION" ]; then
    local vt="KEYFLOW ${VERSION}"
    printf '%s[%d;%dH%s[38;5;46m%s%s[0m' "$E" $((Y0 + 7)) $(( X0 + (W - ${#vt}) / 2 )) "$E" "$vt" "$E"
  fi

  # ---- 2. download
  PHASE=2; ST[1]=1
  start_download
  local act=0 alive gap inc cap f0=$FRAME t0=$SECONDS msf=45 elapsed_ms spd eta rc
  while :; do
    alive=0; kill -0 "$CPID" 2>/dev/null && alive=1
    fsize "$FILE"; act=$REPLY
    if ((TOTAL > 0)); then
      gap=$((act - SHOWN)); inc=$((gap / 5)); cap=$((TOTAL / 34))
      ((inc > cap)) && inc=$cap
      ((inc < 1 || gap < 4096)) && inc=$gap
      SHOWN=$((SHOWN + inc))
      PCT=$((SHOWN * 100 / TOTAL)); ((PCT > 100)) && PCT=100
    fi
    # frame clock: calibrated against the shell's whole-second timer
    if (( SECONDS - t0 >= 1 && FRAME > f0 )); then msf=$(( (SECONDS - t0) * 1000 / (FRAME - f0) )); fi
    elapsed_ms=$(( (FRAME - f0) * msf )); ((elapsed_ms < 1)) && elapsed_ms=1
    if ((alive)); then
      spd=$(( act * 1000 / elapsed_ms ))
      fmt_mb "$spd"; STATLINE="$REPLY/s"
      if ((TOTAL > 0 && spd > 0)); then eta=$(( (TOTAL - act) / spd )); fmt_time "$eta"; STATLINE+="   ·   $REPLY left"; fi
    fi
    fmt_mb "$SHOWN"; CAPTION="$REPLY"
    if ((TOTAL > 0)); then fmt_mb "$TOTAL"; CAPTION+=" of $REPLY"; fi
    fmt_time $(( elapsed_ms / 1000 )); CAPTION="$(printf '%-24s' "$CAPTION")$REPLY elapsed"
    frame
    ((alive == 0 && (TOTAL == 0 || SHOWN >= act))) && break
    sleep 0.03
  done
  wait "$CPID"; rc=$?; CPID=""
  if [ $rc != 0 ]; then
    local why; why=$(sed 's/^curl: ([0-9]*) //' "$TMP/curl.err" | head -1)
    fail 1 "Download failed${why:+: $why}"
  fi
  # real figures from curl
  local sz rs tt; read sz rs tt <"$TMP/curl.out"
  SPEED=${rs%%.*}; TT=$tt; TOTAL=${sz:-$act}; SHOWN=$TOTAL; PCT=100
  fmt_mb "$TOTAL"; STEP_X[1]="  $REPLY"
  fmt_mb "${SPEED:-0}"; STATLINE="$REPLY/s average"
  fmt_mb "$TOTAL"; CAPTION="$(printf '%-24s' "$REPLY received")${TT%%.*}.$(printf '%.1s' "${TT#*.}") s"
  ST[1]=2; PHASE=3; frame

  # ---- 3. unpack
  run_bg 2 unpack || fail 2 "Could not unpack the download."
  ST[2]=2

  # ---- 4. verify
  find_app
  local appdir=$REPLY
  run_bg 3 test -n "$appdir" -a -d "$appdir/Contents/MacOS" || fail 3 "The download did not contain a valid $APP.app."
  local kb; kb=$(du -sk "$appdir" 2>/dev/null | awk '{print $1}')
  fmt_mb $(( ${kb:-0} * 1024 )); STEP_X[3]="  $REPLY on disk"
  ST[3]=2

  # ---- 5. install
  run_bg 4 install_app "$appdir" || fail 4 "Could not write to $DEST."
  ST[4]=2

  # ---- 6. launch
  run_bg 5 launch_app
  ST[5]=2
  STATLINE=""
  frame

  # ---- outro: let the rain fall out, then the summary
  RSTOP=1; RALIVE=1; k=0
  while ((RALIVE && k < 40)); do OUT=""; rain_step $((Y0 + 19)); printf '%s' "$OUT"; FRAME=$((FRAME + 1)); k=$((k + 1)); sleep 0.03; done
  OUT=""; rain_clear $((Y0 + 19)); printf '%s' "$OUT"

  short_dest
  local opened="installed and open"; [ -n "${KEYFLOW_NO_OPEN:-}" ] && opened="installed"
  printf '%s[%d;%dH%s[38;5;46m✓%s[0m  %s[1;38;5;231mKeyflow %s is %s.%s[0m%s[K' \
         "$E" $((Y0 + 19)) $((X0 + 2)) "$E" "$E" "$E" "${VERSION}" "$opened" "$E" "$E"
  local where="$REPLY/$APP.app"; ((${#where} > W - 6)) && where="…${where: -$((W - 7))}"
  printf '%s[%d;%dH%s[38;5;244m   %s%s[0m%s[K' "$E" $((Y0 + 20)) $((X0 + 2)) "$E" "$where" "$E" "$E"
  printf '%s[%d;1H%s[J' "$E" $((Y0 + 22)) "$E"
}

# ================================================================ start ====
COLS=80; ROWS=24
if sz=$(stty size 2>/dev/null </dev/tty); then ROWS=${sz% *}; COLS=${sz#* }; fi
if [ -t 1 ] && [ "${TERM:-dumb}" != dumb ] && [ -z "${KEYFLOW_PLAIN:-}" ] && [ "$COLS" -ge 66 ] && [ "$ROWS" -ge 23 ]; then
  W=76; ((COLS < 80)) && W=$((COLS - 4))
  BW=$((W - 9)); SW=$((W - 25))
  X0=$(( (COLS - W) / 2 + 1 ))
  Y0=$(( (ROWS - 23) / 2 )); ((Y0 > 4)) && Y0=4; ((Y0 < 1)) && Y0=1
  run_fancy
else
  run_plain
fi
