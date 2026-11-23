#!/bin/sh
# The three host firewall rules of docs/operations/environment-bringup.md step A3.6, added only when absent.
# Run at boot by liwan-firewall.service and by bringup.py. `--check` adds nothing: it lists the absent rules and exits 1.
# Every rule is attempted on its own; the exit status is 1 when any rule is absent (`--check`) or could not be added.
set -u

mode=${1:-apply}
case "$mode" in
    apply|--check) ;;
    *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

failed=0

ensure() {
    chain=$1
    shift
    if iptables -w 5 -C "$chain" "$@" 2>/dev/null; then
        return 0
    fi
    if [ "$mode" = "--check" ]; then
        echo "absent: $chain $*"
        failed=1
        return 0
    fi
    if ! iptables -w 5 -I "$chain" "$@"; then
        echo "failed: $chain $*" >&2
        failed=1
    fi
}

ensure DOCKER-USER -i liwan-dbhost -m conntrack --ctstate NEW -j DROP
ensure INPUT -i liwan-dbhost -m conntrack --ctstate NEW -j DROP
ensure INPUT -s 172.29.40.0/24 -d 172.29.40.1 -p tcp --dport 4188 -m conntrack --ctstate NEW -j ACCEPT

exit "$failed"
