/** Adresse IPv4 d'un réseau local de restaurant (10/8, 172.16/12, 192.168/16) : jamais une adresse publique ni la machine elle-même. */
export function isPrivateIpv4(ip: string) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
