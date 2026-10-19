import JSZip from "jszip";
import { isMediaMessage, parseKakaoChat, type KakaoParseResult } from "./kakaoChat";

const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp|heic)$/i;
const IMAGE_TIME_RE = /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[-_ T.]?(\d{2})[-_.:]?(\d{2})/;

export interface KakaoZipResult extends KakaoParseResult {
  imageCount: number;
  unmatchedImages: string[];
}


/**
 * 카톡 "대화 내보내기 (파일 포함)" zip에서 대화 텍스트와 사진을 함께 읽는다.
 * 사진 파일명의 날짜·시각(분 단위)과 "사진" 메시지의 시각을 맞춰 연결한다.
 */
export async function parseKakaoZip(file: File | Blob): Promise<KakaoZipResult> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const txt = entries.filter((f) => /\.txt$/i.test(f.name)).sort((a, b) => b.name.length - a.name.length)[0];
  if (!txt) throw new Error("zip 안에서 대화 .txt 파일을 찾지 못했습니다.");
  const result = parseKakaoChat(await txt.async("string"));

  const buckets = new Map<string, typeof result.messages>();
  for (const m of result.messages) {
    if (!isMediaMessage(m.text) || !/^사진|동영상/.test(m.text.trim())) continue;
    const key = `${m.date} ${m.time}`;
    const arr = buckets.get(key);
    if (arr) arr.push(m);
    else buckets.set(key, [m]);
  }

  const images = entries.filter((f) => IMAGE_RE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  const used = new Set<string>();
  const unmatched: string[] = [];
  for (const img of images) {
    const base = img.name.split("/").pop() ?? img.name;
    const t = base.match(IMAGE_TIME_RE);
    const key = t ? `${t[1]}-${t[2]}-${t[3]} ${t[4]}:${t[5]}` : "";
    const targets = key ? buckets.get(key) : undefined;
    const blob = await img.async("blob");
    const url = URL.createObjectURL(blob);
    const target = targets?.find((m) => (m.images?.length ?? 0) < photoCount(m.text)) ?? targets?.[0];
    if (target) {
      (target.images ??= []).push(url);
      used.add(img.name);
    } else {
      unmatched.push(url);
    }
  }
  return { ...result, imageCount: images.length, unmatchedImages: unmatched };
}

function photoCount(text: string): number {
  const m = text.match(/(\d+)\s*장/);
  return m ? +m[1] : 1;
}

