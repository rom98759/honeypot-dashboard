import { useAppConfig } from "../api/config";

export const PROXIED_LABEL = "IPv6 (IP inconnue)";

/** Docker's userland proxy relays IPv6 clients from the honeypot network gateway, hiding their address. */
export function useIsProxiedIp(): (ip: string | null | undefined) => boolean {
  const proxied = useAppConfig().data?.proxied_source_ip;
  return (ip) => Boolean(proxied && ip === proxied);
}

export function IpAddress({ ip }: { ip: string }) {
  const isProxied = useIsProxiedIp();
  if (!isProxied(ip)) return <>{ip}</>;
  return (
    <span title={`Client IPv6 relayé par le proxy Docker : Cowrie ne voit que la passerelle ${ip}.`}>
      {PROXIED_LABEL}
    </span>
  );
}
