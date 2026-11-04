#!/bin/sh
# Renders icecast.xml from environment variables and starts Icecast. It refuses to
# start on a weak or missing value, and it never prints a password.
set -eu

MINIMUM_PASSWORD_LENGTH=32
TEMPLATE_PATH=/etc/icecast/icecast.xml.template
CONFIG_PATH=/var/lib/icecast/icecast.xml
EX_CONFIG=78

fail() {
  printf 'icecast-entrypoint: %s\n' "$1" >&2
  exit "$EX_CONFIG"
}

read_variable() {
  eval "printf '%s' \"\${$1:-}\""
}

require_value() {
  if [ -z "$(read_variable "$1")" ]; then
    fail "$1 is missing or empty."
  fi
}

check_password() {
  require_value "$1"
  password_value=$(read_variable "$1")

  case "$password_value" in
    hackme | hackmemore)
      fail "$1 equals a default from the Icecast sample config."
      ;;
    placeholder-*)
      fail "$1 is still a placeholder value."
      ;;
    *[[:space:][:cntrl:]]*)
      fail "$1 holds a space or a control character."
      ;;
  esac

  if [ "${#password_value}" -lt "$MINIMUM_PASSWORD_LENGTH" ]; then
    fail "$1 has ${#password_value} characters. It needs at least $MINIMUM_PASSWORD_LENGTH."
  fi
}

for variable_name in ICECAST_HOSTNAME ICECAST_ADMIN ICECAST_LOCATION ICECAST_MOUNT \
  ICECAST_CLIENT_CAP; do
  require_value "$variable_name"
done

check_password ICECAST_SOURCE_PASSWORD
check_password ICECAST_ADMIN_PASSWORD
check_password ICECAST_RELAY_PASSWORD

case "$ICECAST_HOSTNAME" in
  *[!A-Za-z0-9.-]*)
    fail "ICECAST_HOSTNAME must be a host name with letters, digits, dots, and dashes."
    ;;
esac

case "$ICECAST_MOUNT" in
  /*) ;;
  *) fail "ICECAST_MOUNT must start with a slash." ;;
esac
case "$ICECAST_MOUNT" in
  *[!A-Za-z0-9._/-]* | *..* | *//* | */)
    fail "ICECAST_MOUNT must be a path of letters, digits, dots, dashes, and underscores."
    ;;
esac

case "$ICECAST_CLIENT_CAP" in
  0* | *[!0-9]*)
    fail "ICECAST_CLIENT_CAP must be a positive whole number."
    ;;
esac
if [ "${#ICECAST_CLIENT_CAP}" -gt 5 ]; then
  fail "ICECAST_CLIENT_CAP is too large."
fi

for variable_name in ICECAST_ADMIN ICECAST_LOCATION; do
  case "$(read_variable "$variable_name")" in
    *[[:cntrl:]]*)
      fail "$variable_name holds a control character."
      ;;
  esac
done

# The status page and the admin page count against the clients limit, so a full
# mount must leave room for them.
ICECAST_CLIENT_LIMIT=$((ICECAST_CLIENT_CAP + 10))
export ICECAST_CLIENT_LIMIT

# The Debian package installs icecast2. The source build installs icecast.
icecast_binary=$(command -v icecast || command -v icecast2 || true)
if [ -z "$icecast_binary" ]; then
  fail "No icecast binary is on the PATH."
fi

ICECAST_SHARE_DIRECTORY=
for share_directory in /usr/local/share/icecast /usr/share/icecast2 /usr/share/icecast; do
  if [ -f "$share_directory/web/status-json.xsl" ]; then
    ICECAST_SHARE_DIRECTORY=$share_directory
    break
  fi
done
if [ -z "$ICECAST_SHARE_DIRECTORY" ]; then
  fail "No Icecast web root with status-json.xsl exists."
fi
export ICECAST_SHARE_DIRECTORY

# awk reads each value from its environment, so no password reaches an argument
# list, and a sed metacharacter in a value cannot change the output.
umask 077
awk '
  function xml_escape(value) {
    gsub(/&/, "\\&amp;", value)
    gsub(/</, "\\&lt;", value)
    gsub(/>/, "\\&gt;", value)
    gsub(/"/, "\\&quot;", value)
    gsub(/\047/, "\\&apos;", value)
    return value
  }
  {
    remaining = $0
    rendered = ""
    while (match(remaining, /@[A-Z_]+@/)) {
      name = substr(remaining, RSTART + 1, RLENGTH - 2)
      if (!(name in ENVIRON)) {
        exit 3
      }
      rendered = rendered substr(remaining, 1, RSTART - 1) xml_escape(ENVIRON[name])
      remaining = substr(remaining, RSTART + RLENGTH)
    }
    print rendered remaining
  }
' "$TEMPLATE_PATH" >"$CONFIG_PATH" || fail "The template names a variable that is not set."

unset ICECAST_SOURCE_PASSWORD ICECAST_ADMIN_PASSWORD ICECAST_RELAY_PASSWORD password_value

printf 'icecast-entrypoint: starting %s for mount %s with a cap of %s listeners.\n' \
  "$icecast_binary" "$ICECAST_MOUNT" "$ICECAST_CLIENT_CAP" >&2

exec "$icecast_binary" -c "$CONFIG_PATH"
