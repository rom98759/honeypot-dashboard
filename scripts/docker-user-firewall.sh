#!/bin/bash
# Reconstruit la chain DOCKER-USER (vidée par Docker a chaque redemarrage du
# daemon) : restriction Cloudflare-only sur 80/443, blocage du port 81 (admin
# NPM), et blocage de toute sortie du honeypot. Lance par le service systemd
# docker-user-firewall.service, apres docker.service et ufw.service.
#
# Les regles Cloudflare-only et le blocage du port 81 sont scopees a
# "-i eth0" (interface WAN reelle du VPS) : elles ne doivent filtrer que le
# trafic ENTRANT depuis Internet vers un port publie par un container, pas
# le trafic SORTANT d'un container vers Internet (ex: pip install, apt-get).
# Sans ce -i, le DROP matchait par port de destination seul et bloquait
# aussi bien l'entrant non-Cloudflare que tout trafic client sortant d'un
# container vers un service externe en 80/443/81.
set -e

IPT="iptables -w"
IPT6="ip6tables -w"

WAN_IFACE="eth0"

CF_V4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13"
CF_V6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29"

# Resolution dynamique du bridge honeypot (le nom change si le stack est recree)
HONEYPOT_BRIDGE=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  NET_ID=$(docker network inspect honeypot_honeypot-net -f '{{.Id}}' 2>/dev/null || true)
  if [ -n "$NET_ID" ]; then
    HONEYPOT_BRIDGE="br-${NET_ID:0:12}"
    break
  fi
  sleep 2
done

$IPT -F DOCKER-USER 2>/dev/null || $IPT -N DOCKER-USER
$IPT6 -F DOCKER-USER 2>/dev/null || $IPT6 -N DOCKER-USER

$IPT -A DOCKER-USER -i lo -j RETURN

if [ -n "$HONEYPOT_BRIDGE" ]; then
  $IPT -A DOCKER-USER -i "$HONEYPOT_BRIDGE" -m conntrack --ctstate NEW -m comment --comment "honeypot: no egress" -j DROP
  logger -t docker-user-firewall "honeypot egress-block applique sur $HONEYPOT_BRIDGE"
else
  logger -t docker-user-firewall "ATTENTION: reseau honeypot_honeypot-net introuvable, regle egress honeypot NON appliquee"
fi

for r in $CF_V4; do
  $IPT -A DOCKER-USER -i "$WAN_IFACE" -s "$r" -p tcp -m multiport --dports 80,443 -j RETURN
done
$IPT -A DOCKER-USER -i "$WAN_IFACE" -p tcp -m multiport --dports 80,443 -j DROP
$IPT -A DOCKER-USER -i "$WAN_IFACE" -p tcp -m tcp --dport 81 -j DROP
$IPT -A DOCKER-USER -j RETURN

for r in $CF_V6; do
  $IPT6 -A DOCKER-USER -i "$WAN_IFACE" -s "$r" -p tcp -m multiport --dports 80,443 -j RETURN
done
$IPT6 -A DOCKER-USER -i "$WAN_IFACE" -p tcp -m multiport --dports 80,443 -j DROP
$IPT6 -A DOCKER-USER -i "$WAN_IFACE" -p tcp -m tcp --dport 81 -j DROP
$IPT6 -A DOCKER-USER -j RETURN

logger -t docker-user-firewall "DOCKER-USER (v4+v6) reconstruite avec succes"
