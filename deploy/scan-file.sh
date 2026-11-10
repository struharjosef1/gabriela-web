#!/bin/sh
set -eu
exec /usr/bin/clamscan --database=/var/lib/gabriela-clamav --fail-if-cvd-older-than=2 "$@"
