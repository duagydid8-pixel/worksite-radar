import selfsigned from "selfsigned";
import { networkInterfaces } from "node:os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(SCRIPT_DIR, ".network-certs");
const CERT_FILE = path.join(CERT_DIR, "cert.pem");
const KEY_FILE = path.join(CERT_DIR, "key.pem");
const IPS_FILE = path.join(CERT_DIR, "ips.json");

export function getLocalIPs() {
  const nets = networkInterfaces();
  const ips = [];
  for (const ifaces of Object.values(nets ?? {})) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

export async function getNetworkCerts() {
  const ips = getLocalIPs();
  const ipsKey = JSON.stringify([...ips].sort());

  if (existsSync(CERT_FILE) && existsSync(KEY_FILE) && existsSync(IPS_FILE)) {
    try {
      if (readFileSync(IPS_FILE, "utf8") === ipsKey) {
        return {
          cert: readFileSync(CERT_FILE, "utf8"),
          key: readFileSync(KEY_FILE, "utf8"),
          ips,
        };
      }
    } catch {}
  }

  mkdirSync(CERT_DIR, { recursive: true });

  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];

  const pems = await selfsigned.generate(
    [{ name: "commonName", value: "worksite-radar-local" }],
    { algorithm: "sha256", days: 365, keySize: 2048, extensions: [{ name: "subjectAltName", altNames }] },
  );

  writeFileSync(CERT_FILE, pems.cert, "utf8");
  writeFileSync(KEY_FILE, pems.private, "utf8");
  writeFileSync(IPS_FILE, ipsKey, "utf8");

  return { cert: pems.cert, key: pems.private, ips };
}
