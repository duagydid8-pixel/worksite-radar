// OOXML Agile Encryption 복호화 (Web Crypto API + @e965/xlsx 내장 CFB)
// Excel 2010+ 비밀번호 파일 해독

import * as XLSXe from "@e965/xlsx";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CFB = (XLSXe as any).CFB as {
  parse: (data: Uint8Array) => { FileIndex: { name: string; content: unknown }[] };
  find: (cfb: unknown, name: string) => { content: unknown } | null;
};

function concatU8(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function b64ToU8(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function strToUtf16Le(s: string): Uint8Array {
  const buf = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    buf[i * 2]     = s.charCodeAt(i) & 0xff;
    buf[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return buf;
}

function fixLen(h: Uint8Array, len: number): Uint8Array {
  if (h.length === len) return h;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = h[i % h.length];
  return out;
}

function toU8(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(content)) {
    return new Uint8Array((content as Buffer).buffer, (content as Buffer).byteOffset, (content as Buffer).length);
  }
  return new Uint8Array(content as ArrayBuffer);
}

// AES-CBC 복호화 (PKCS7 없음) — fake block 트릭
async function aesCbcDecryptNoPad(key: Uint8Array, iv: Uint8Array, cipher: Uint8Array): Promise<Uint8Array> {
  const lastBlock = cipher.slice(cipher.length - 16);
  const fakeInput = new Uint8Array(16);
  for (let i = 0; i < 16; i++) fakeInput[i] = lastBlock[i] ^ 0x10;

  const encK = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const fakeEnc = await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, encK, fakeInput);
  const fakeBlock = new Uint8Array(fakeEnc).slice(0, 16);

  const extended = concatU8(cipher, fakeBlock);
  const decK = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);
  const result = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, decK, extended);
  return new Uint8Array(result);
}

// ECMA-376 키 파생 (반복 해시)
async function deriveKey(
  alg: string, salt: Uint8Array, password: string,
  spinCount: number, blockKey: Uint8Array, keyBytes: number
): Promise<Uint8Array> {
  let h = new Uint8Array(await crypto.subtle.digest(alg, concatU8(salt, strToUtf16Le(password))));
  for (let i = 0; i < spinCount; i++) {
    const ib = new Uint8Array(4);
    new DataView(ib.buffer).setUint32(0, i, true);
    h = new Uint8Array(await crypto.subtle.digest(alg, concatU8(h, ib)));
  }
  const hf = new Uint8Array(await crypto.subtle.digest(alg, concatU8(h, blockKey)));
  return fixLen(hf, keyBytes);
}

function toHashAlg(raw: string): string {
  // "SHA1"→"SHA-1", "SHA256"→"SHA-256", "SHA512"→"SHA-512"
  const cleaned = raw.replace(/^SHA-?/i, "");
  return "SHA-" + cleaned;
}

function isCFB(data: Uint8Array): boolean {
  return data[0] === 0xD0 && data[1] === 0xCF && data[2] === 0x11 && data[3] === 0xE0;
}

export async function decryptExcelPassword(buffer: ArrayBuffer, password: string): Promise<ArrayBuffer> {
  const data = new Uint8Array(buffer);
  const hex4 = Array.from(data.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log("[xlsxDecrypt] 파일 첫 4바이트:", hex4);

  if (!isCFB(data)) {
    console.log("[xlsxDecrypt] CFB 아님 → 그대로 반환 (ZIP/xlsx)");
    return buffer;
  }

  console.log("[xlsxDecrypt] CFB 감지됨 → 파싱 시작");
  const cfb = CFB.parse(data);
  console.log("[xlsxDecrypt] CFB 스트림 목록:", cfb.FileIndex.map((e: { name: string }) => e.name).join(", "));

  // 대소문자 무시하여 EncryptionInfo 탐색
  const encInfoEntry = cfb.FileIndex.find((e: { name: string }) =>
    e.name.toLowerCase() === "encryptioninfo"
  );
  console.log("[xlsxDecrypt] EncryptionInfo 찾음:", !!encInfoEntry);
  if (!encInfoEntry) {
    console.log("[xlsxDecrypt] EncryptionInfo 없음 → CFB 버퍼 그대로 반환");
    return buffer;
  }

  const raw = toU8(encInfoEntry.content);
  console.log("[xlsxDecrypt] EncryptionInfo 앞 8바이트:",
    Array.from(raw.slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join(" "));

  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const vMajor = dv.getUint16(0, true);
  const vMinor = dv.getUint16(2, true);
  console.log("[xlsxDecrypt] 암호화 버전:", vMajor, ".", vMinor);

  if (vMajor !== 4 || vMinor !== 4) {
    throw new Error(`지원하지 않는 암호화 버전 ${vMajor}.${vMinor} (Agile 4.4만 지원)`);
  }

  const xml = new TextDecoder().decode(raw.slice(8));
  console.log("[xlsxDecrypt] XML 앞 200자:", xml.slice(0, 200));

  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const kdEl = doc.querySelector("keyData");
  const ekEl =
    doc.querySelector("encryptedKey") ??
    doc.getElementsByTagNameNS(
      "http://schemas.microsoft.com/office/2006/keyEncryptor/password",
      "encryptedKey"
    )[0];

  console.log("[xlsxDecrypt] keyData:", !!kdEl, "encryptedKey:", !!ekEl);
  if (!kdEl || !ekEl) throw new Error("암호화 XML 파싱 실패");

  const hashAlgRaw = kdEl.getAttribute("hashAlgorithm") ?? "SHA1";
  const kd = {
    salt:      b64ToU8(kdEl.getAttribute("saltValue")!),
    blockSize: parseInt(kdEl.getAttribute("blockSize")!),
    keyBits:   parseInt(kdEl.getAttribute("keyBits")!),
    hashAlg:   toHashAlg(hashAlgRaw),
  };
  const ekHashAlgRaw = ekEl.getAttribute("hashAlgorithm") ?? "SHA1";
  const ek = {
    salt:              b64ToU8(ekEl.getAttribute("saltValue")!),
    spinCount:         parseInt(ekEl.getAttribute("spinCount")!),
    keyBits:           parseInt(ekEl.getAttribute("keyBits")!),
    hashAlg:           toHashAlg(ekHashAlgRaw),
    encryptedKeyValue: b64ToU8(ekEl.getAttribute("encryptedKeyValue")!),
  };
  console.log(`[xlsxDecrypt] kd: hashAlg=${kd.hashAlg} keyBits=${kd.keyBits} blockSize=${kd.blockSize} saltLen=${kd.salt.length}`);
  console.log(`[xlsxDecrypt] ek: hashAlg=${ek.hashAlg} keyBits=${ek.keyBits} spinCount=${ek.spinCount} saltLen=${ek.salt.length} encKeyLen=${ek.encryptedKeyValue.length}`);

  const BLOCK_KEY_VALUE = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);
  const BLOCK_KEY_VH_INPUT = new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
  const BLOCK_KEY_VH       = new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);

  const derivedKey = await deriveKey(ek.hashAlg, ek.salt, password, ek.spinCount, BLOCK_KEY_VALUE, ek.keyBits / 8);
  console.log("[xlsxDecrypt] derivedKey(앞4바이트):", Array.from(derivedKey.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join(" "));

  // 비밀번호 검증 (encryptedVerifierHash 비교)
  const encVhInput = ekEl.getAttribute("encryptedVerifierHashInput");
  const encVh      = ekEl.getAttribute("encryptedVerifierHash");
  if (encVhInput && encVh) {
    try {
      const vhInputKey = await deriveKey(ek.hashAlg, ek.salt, password, ek.spinCount, BLOCK_KEY_VH_INPUT, ek.keyBits / 8);
      const vhKey      = await deriveKey(ek.hashAlg, ek.salt, password, ek.spinCount, BLOCK_KEY_VH,       ek.keyBits / 8);
      const decVhInput = await aesCbcDecryptNoPad(vhInputKey, ek.salt, b64ToU8(encVhInput));
      const decVh      = await aesCbcDecryptNoPad(vhKey,      ek.salt, b64ToU8(encVh));
      const computedHash = new Uint8Array(await crypto.subtle.digest(ek.hashAlg, decVhInput));
      const storedHash   = decVh.slice(0, computedHash.length);
      const ok = computedHash.every((b, i) => b === storedHash[i]);
      console.log(`[xlsxDecrypt] 비밀번호 검증: ${ok ? "✅ 성공 (키 파생 정상)" : "❌ 실패 (비밀번호/파생 오류)"}`);
      if (!ok) {
        console.log("[xlsxDecrypt] computed:", Array.from(computedHash.slice(0,8)).map(b=>b.toString(16).padStart(2,"0")).join(" "));
        console.log("[xlsxDecrypt] stored:  ", Array.from(storedHash.slice(0,8)).map(b=>b.toString(16).padStart(2,"0")).join(" "));
      }
    } catch(ve) {
      console.warn("[xlsxDecrypt] 비밀번호 검증 중 오류:", (ve as Error).message);
    }
  }

  const secretKeyFull = await aesCbcDecryptNoPad(derivedKey, ek.salt, ek.encryptedKeyValue);
  const secretKey = secretKeyFull.slice(0, kd.keyBits / 8);
  console.log("[xlsxDecrypt] secretKey(앞4바이트):", Array.from(secretKey.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join(" "));

  const encPkgEntry = cfb.FileIndex.find((e: { name: string }) =>
    e.name.toLowerCase() === "encryptedpackage"
  );
  if (!encPkgEntry) throw new Error("EncryptedPackage 없음");
  const encPkg = toU8(encPkgEntry.content);
  console.log("[xlsxDecrypt] EncryptedPackage 크기:", encPkg.length, "타입:", (encPkgEntry.content as object).constructor?.name ?? typeof encPkgEntry.content);
  console.log("[xlsxDecrypt] encPkg 앞 16바이트:", Array.from(encPkg.slice(0,16)).map(b=>b.toString(16).padStart(2,"0")).join(" "));

  const pkgDv = new DataView(encPkg.buffer, encPkg.byteOffset, encPkg.byteLength);
  const lo = pkgDv.getUint32(0, true);
  const hi = pkgDv.getUint32(4, true);
  const pkgSize = lo + hi * 0x100000000;
  console.log("[xlsxDecrypt] 원본 크기(pkgSize):", pkgSize, "(lo=", lo, "hi=", hi, ")");
  const encData = encPkg.slice(8);
  console.log("[xlsxDecrypt] encData 앞 16바이트:", Array.from(encData.slice(0,16)).map(b=>b.toString(16).padStart(2,"0")).join(" "));

  // 세그먼트 0 IV 미리 계산해서 로그
  {
    const sn0 = new Uint8Array(4);
    const iv0Hash = new Uint8Array(await crypto.subtle.digest(kd.hashAlg, concatU8(kd.salt, sn0)));
    const iv0 = iv0Hash.slice(0, kd.blockSize);
    console.log("[xlsxDecrypt] 세그먼트0 IV:", Array.from(iv0).map(b=>b.toString(16).padStart(2,"0")).join(" "));
  }

  const SEG = 4096;
  const parts: Uint8Array[] = [];
  for (let s = 0; s * SEG < encData.length; s++) {
    let chunk = encData.slice(s * SEG, (s + 1) * SEG);
    if (chunk.length % kd.blockSize !== 0) {
      const padded = new Uint8Array(Math.ceil(chunk.length / kd.blockSize) * kd.blockSize);
      padded.set(chunk);
      chunk = padded;
    }
    const sn = new Uint8Array(4);
    new DataView(sn.buffer).setUint32(0, s, true);
    const ivHash = new Uint8Array(await crypto.subtle.digest(kd.hashAlg, concatU8(kd.salt, sn)));
    const iv = ivHash.slice(0, kd.blockSize);
    const dec = await aesCbcDecryptNoPad(secretKey, iv, chunk);
    if (s === 0) console.log("[xlsxDecrypt] 세그먼트0 복호화 앞8:", Array.from(dec.slice(0,8)).map(b=>b.toString(16).padStart(2,"0")).join(" "));
    parts.push(dec);
  }

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }

  const result = out.slice(0, pkgSize);
  console.log("[xlsxDecrypt] 복호화 결과 첫 4바이트:",
    Array.from(result.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join(" "));
  return result.buffer;
}
