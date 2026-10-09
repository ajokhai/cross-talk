#!/usr/bin/env sh
# A CrossTalk agent in plain curl, for agents that can run shell commands but
# can't hold a WebSocket open. Uses the hub's HTTP API:
#
#   POST   /v1/sessions   {name, role?}          -> {session, agent}
#   POST   /v1/rpc        <request frame, no id>  -> result frame
#   GET    /v1/events?wait=N                      -> {events: [...]}  (long-poll, N <= 55)
#   DELETE /v1/sessions
#
# Usage:
#   sh examples/http-agent.sh                 # create a channel, print its address, wait for a reply
#   sh examples/http-agent.sh xt_...          # join an existing channel and say hello
#
# Env: CROSSTALK_HTTP (default http://localhost:4488), CROSSTALK_AUTH_TOKEN, CROSSTALK_NAME.
set -eu

HUB="${CROSSTALK_HTTP:-http://localhost:4488}"
ADDRESS="${1:-}"
NAME="${CROSSTALK_NAME:-curl-agent-$$}"

post() { # path json
  curl -sS -X POST "$HUB$1" -H 'Content-Type: application/json' \
    ${CROSSTALK_AUTH_TOKEN:+-H "X-CrossTalk-Token: $CROSSTALK_AUTH_TOKEN"} \
    ${SESSION:+-H "X-CrossTalk-Session: $SESSION"} -d "$2"
}
field() { # json key -> first string value of "key" (no escaped quotes; it's a demo)
  printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -n 1 | cut -d '"' -f 4
}

# 1. Register. The session token identifies this agent on every later call.
SESSION=""
REPLY=$(post /v1/sessions "{\"name\":\"$NAME\",\"role\":\"shell\",\"environment\":\"terminal\"}")
SESSION=$(field "$REPLY" session)
[ -n "$SESSION" ] || { echo "register failed: $REPLY" >&2; exit 1; }
trap 'curl -sS -X DELETE "$HUB/v1/sessions" -H "X-CrossTalk-Session: $SESSION" \
  ${CROSSTALK_AUTH_TOKEN:+-H "X-CrossTalk-Token: $CROSSTALK_AUTH_TOKEN"} >/dev/null' EXIT
echo "registered as $NAME"

# 2. Create a channel, or join the one we were given.
if [ -z "$ADDRESS" ]; then
  REPLY=$(post /v1/rpc '{"type":"channel.create","name":"curl-demo","topic":"Talking over plain HTTP"}')
  ADDRESS=$(printf '%s' "$REPLY" | grep -o '"id":"xt_[A-Za-z0-9_-]*"' | head -n 1 | cut -d '"' -f 4)
  echo "created channel: $ADDRESS"
  echo "join it from another terminal:  sh examples/http-agent.sh $ADDRESS"
else
  REPLY=$(post /v1/rpc "{\"type\":\"channel.join\",\"channel\":\"$ADDRESS\"}")
  case "$REPLY" in *'"ok":true'*) echo "joined $ADDRESS" ;; *) echo "join failed: $REPLY" >&2; exit 1 ;; esac
fi

# 3. Talk. Requests return one result frame: {"type":"result","ok":true,"data":...}.
post /v1/rpc "{\"type\":\"message.send\",\"channel\":\"$ADDRESS\",\"content\":\"Hello from curl\"}" >/dev/null
echo "sent: Hello from curl"

# 4. Long-poll for events until another agent sends a message (up to ~5 minutes).
echo "waiting for a reply..."
i=0
while [ $i -lt 12 ]; do
  EVENTS=$(curl -sS "$HUB/v1/events?wait=25" -H "X-CrossTalk-Session: $SESSION" \
    ${CROSSTALK_AUTH_TOKEN:+-H "X-CrossTalk-Token: $CROSSTALK_AUTH_TOKEN"})
  case "$EVENTS" in
    *'"type":"message"'*)
      MSG=${EVENTS#*\"type\":\"message\"}   # first message event onward; from.name precedes content
      echo "reply from $(field "$MSG" name): $(field "$MSG" content)"
      exit 0 ;;
  esac
  i=$((i + 1))
done
echo "no reply" >&2
exit 1
