# 대시보드 전체 리디자인 설계 문서

**날짜:** 2026-04-10  
**범위:** 전체 레이아웃, 사이드바, 홈 화면 신설, 컬러 시스템 변경

---

## 1. 목표

전체 사이트를 모던 파스텔 대시보드 스타일로 변경하고, 공개/관리자 전용 메뉴를 명확히 분리한다.  
홈 화면을 신설하여 근태 통계 요약을 제공한다.

---

## 2. 컬러 시스템

### CSS 변수 변경 (`src/index.css`)

| 변수 | 현재 | 변경 후 | 설명 |
|------|------|---------|------|
| `--background` | 210 20% 97% | `240 10% 95%` | 메인 배경 #F0F2F5 |
| `--primary` | 161 69% 37% (green) | `220 80% 68%` | 파스텔 블루 |
| `--primary-foreground` | white | white | 유지 |

### 그라데이션 토큰 (Tailwind 확장)
- `from-pastel-blue`: `#a8c8f8`
- `via-pastel-purple`: `#c8b4f8`
- `to-pastel-pink`: `#f8b4d0`
- 웰컴 배너, 활성 사이드바 아이템에 사용

---

## 3. 레이아웃 구조

```
┌─────────────────────────────────────────────┐
│  Sidebar (220px, white)  │  Main (#F0F2F5)  │
│  ┌──────────────────┐    │  ┌─────────────┐ │
│  │ Logo + 사이트명   │    │  │  TopBar     │ │
│  ├──────────────────┤    │  ├─────────────┤ │
│  │ 🏠 홈            │    │  │  Content    │ │
│  │ 📊 근태보고       │    │  │  (각 탭)    │ │
│  │ 📅 연차관리       │    │  └─────────────┘ │
│  │ 🏢 조직도         │    │                  │
│  │ ── 관리자 전용 ── │    │                  │
│  │ 👥 기술인 명단    │    │                  │
│  │ 📋 XERP & PMIS   │    │                  │
│  ├──────────────────┤    │                  │
│  │ 🔑 관리자 로그인  │    │                  │
│  └──────────────────┘    │                  │
└─────────────────────────────────────────────┘
```

---

## 4. 사이드바 (`src/pages/Index.tsx`)

### 상단 로고 영역
- `/public/logo.png` 사용 (현재와 동일)
- 사이트명: "Worksite" + 부제 "현장 관리 시스템"
- 파스텔 그라데이션 아이콘 배경

### 공개 메뉴 (비로그인도 접근 가능)
```
🏠 홈
📊 근태보고
📅 연차관리
🏢 조직도
```

### 관리자 전용 섹션
- `── 관리자 전용 ──` 구분선 + 라벨
- **비로그인:** 항목 표시되지만 흐린 색상(opacity 0.4) + 자물쇠 아이콘, 클릭 시 toast
- **로그인 후:** 정상 색상, 자물쇠 없음

```
👥 기술인 및 관리자 명단
📋 XERP & PMIS
```

### 하단 로그인/로그아웃 버튼
- 비로그인: `🔑 관리자 로그인` 버튼 → 기존 `AdminLoginDialog` 호출
- 로그인 후: `로그아웃` 버튼 (현재 `AdminLoginButton` 대체)

### ActiveTab 타입 확장
```typescript
type ActiveTab = "홈" | "신규자명단" | "근태보고" | "연차관리" | "조직도" | "XERP&PMIS";
```
- 기본값: `"홈"`

---

## 5. 홈 화면 (`src/components/HomePage.tsx` 신설)

### Props
```typescript
interface HomePageProps {
  data: ParsedData | null;
  lastUploadedAt: string | null;
}
```

### 구성 요소

#### 5-1. 상단 TopBar (Index.tsx 공통 영역으로 추출)
- 검색바: 이름 검색 입력 (현재 `searchQuery` state와 연결)
- 오늘 날짜: `new Date()` 포맷 (YYYY년 MM월 DD일 (요일))

#### 5-2. 웰컴 배너
- 파스텔 블루→퍼플→핑크 그라데이션 카드
- "안녕하세요! 👋" 제목
- "오늘도 현장 관리 시스템에 오신 것을 환영합니다." 부제
- 우측 이모지 장식 (🏗️)
- 장식용 반투명 원형 orb 2개

#### 5-3. 통계 카드 (4개)
데이터 소스: 가장 최근 업로드된 `ParsedData` (Index.tsx의 `data` state)

| 카드 | 값 계산 방법 | 아이콘 | 색상 |
|------|------------|--------|------|
| 총 인원수 | `data.employees.length` | 👷 | 파스텔 블루 |
| 오늘 출근자 | 선택된 날짜의 `dailyRecords`에 punchIn 있는 직원 수 | ✅ | 파스텔 그린 |
| 결근자 | 같은 날짜 punchIn 없고 연차도 아닌 직원 수 | ❌ | 파스텔 레드 |
| 연차자 | `annualLeaveMap`에서 선택된 날짜 기준 연차인 직원 수 | 🌿 | 파스텔 퍼플 |

- `data`가 null이면 카드에 `—` 표시
- 부제: "최근 업로드: {lastUploadedAt}" 또는 "데이터 없음"

#### 5-4. 최근 근태 테이블
- `data.employees` 최대 10명 표시
- 컬럼: 이름, 팀, 직급, 출근, 퇴근, 상태
- 상태 뱃지: 정상(green), 지각(blue), 결근(red), 연차(gray)
- `data`가 null이면 "업로드된 데이터가 없습니다" 표시

---

## 6. 공통 스타일 변경

### 카드 스타일 (기존 컴포넌트 유지, wrapper만 변경)
- 흰색 배경 `bg-white`
- `rounded-2xl`
- `shadow-sm` → `shadow-[0_2px_12px_rgba(0,0,0,0.06)]`

### 활성 사이드바 아이템
```css
background: linear-gradient(135deg, #a8c8f8, #c8b4f8);
color: #2d3a8a;
box-shadow: 0 2px 8px rgba(168,200,248,0.4);
```

---

## 7. 파일 변경 목록

| 파일 | 작업 |
|------|------|
| `src/index.css` | CSS 변수 컬러 변경 |
| `src/pages/Index.tsx` | ActiveTab 확장, 사이드바 재작성, 홈 탭 추가 |
| `src/components/HomePage.tsx` | 신규 생성 |

> 기존 기능 컴포넌트(NewEmployeeList, AttendanceTable, AnnualLeavePanel, OrgChart, XerpPmisTable)는 **수정 없음** — Index.tsx의 탭 전환으로만 렌더링.

---

## 8. 검증 방법

1. `npm run dev` 실행
2. 사이드바 로고/메뉴 구조 확인
3. 홈 탭 진입 → 배너, 통계 카드, 테이블 확인
4. `data` 없을 때 통계 카드 `—` 표시 확인
5. 비로그인 상태: 관리자 메뉴 흐림 + 클릭 시 toast
6. 관리자 로그인 후: 메뉴 활성화, 로그아웃 버튼 표시
7. `npm run build` TypeScript 오류 없음
8. `git push` 완료
