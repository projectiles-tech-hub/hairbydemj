#!/usr/bin/env bash
# Emails ALERT_EMAIL: alert.sh <production|staging> "Subject" "Message"
# Used by hairbydemj-alert@.service when a service fails for good.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -ge 2 ] || die 'usage: alert.sh <production|staging> "Subject" "Message"'
use_instance "$1"
alert "$2" "${3:-}"
