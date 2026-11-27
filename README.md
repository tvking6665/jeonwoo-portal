# 전우정밀 생산 이력 공유 포털

프레스 부품 제조사 **전우정밀**의 생산 이력을 관련 팀과 공유하는 정적 웹 앱입니다.
생산계획 · 생산실적 · 유출불량 히스토리 · 제품 월별판매량 · 소재 월별구매량을 한 곳에서 보고, 관리자는 글을 작성·수정·삭제할 수 있습니다.

- **빌드 없음** — `index.html` 을 열면 바로 동작하는 순수 HTML/CSS/JS
- **엑셀 업로드 + 자동 그래프** — `최종현재수정.xlsx` 같은 생산계획/실적 파일을 올리면 설비별 계획·실적·달성률 차트와 설비별 요약표가 바로 갱신됩니다
- **상단 트리 메뉴** — `전체` · `생산관리`(생산계획/생산실적) · `품질관리`(유출불량) · `영업·자재`(제품 월별판매량/소재 월별구매량)
- **두 가지 권한** — 팀 열람(읽기 전용) / 관리자(작성·수정·삭제)
- **두 가지 저장소** — Supabase(팀 공유) 또는 브라우저 localStorage(데모), 자동 전환
- **반응형** — 데스크톱·태블릿·모바일(390px), 모바일에서는 접이식 트리 메뉴, 이미지 라이트박스 포함

---

## 1. 파일 구성

```
jeonwoo-portal/
├── index.html          화면 구조 (게이트 · 목록 · 상세 · 작성 모달)
├── styles.css          디자인 (라이트 테마, 반응형)
├── app.js              데이터 계층 + 렌더링 + 이벤트
├── analytics.js        엑셀 파서 + 설비별 차트 · 요약표 + 월별 추이
├── config.js           ★ 비밀번호 / Supabase 설정 (여기만 고치면 됩니다)
├── README.md
└── assets/
    ├── seed-data.js               기본(샘플) 분석 데이터 — 실제 10월 생산요약 값
    ├── vendor/xlsx.full.min.js    SheetJS 0.18.5 (엑셀 파싱)
    ├── vendor/chart.umd.min.js    Chart.js 4.4.6 (차트)
    ├── favicon.svg
    ├── hero-bg.jpg               메인 히어로 배경 (jwjm.com 메인 비주얼, 고정 배경)
    ├── sample-plan.svg           샘플: 주간 생산계획 간트
    ├── sample-result.svg         샘플: 계획 대비 실적 차트
    ├── sample-defect-crack.svg   샘플: 비전 검사 크랙 캡처
    └── sample-defect-dim.svg     샘플: 치수 측정 리포트
```

---

## 2. 로컬에서 미리보기

`file://` 로도 대부분 동작하지만, 브라우저 정책상 로컬 서버 사용을 권장합니다.

```bash
cd jeonwoo-portal
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

| 구분 | 비밀번호 | 권한 |
| --- | --- | --- |
| 팀 열람 | `jwjm1234` | 목록·검색·필터·상세·이미지 확대 (읽기 전용) |
| 관리자 | `admin1234!` | 위 권한 + 작성·수정·삭제 |

비밀번호는 `config.js` 의 `auth.teamPassword`, `auth.adminPassword` 에서 바꿉니다.

---

## 3. 배포 (정적 호스팅)

빌드 단계가 없으므로 폴더를 그대로 올리면 됩니다.

**Vercel**
1. 프로젝트 폴더를 GitHub 에 푸시하거나 `vercel` CLI 실행
2. Framework Preset: **Other**, Build Command: 없음, Output Directory: `.` (또는 `jeonwoo-portal`)

**Netlify**
- app.netlify.com → *Add new site* → *Deploy manually* → `jeonwoo-portal` 폴더를 드래그 앤 드롭

**Cloudflare Pages**
- *Create a project* → *Direct upload* → 폴더 업로드 (빌드 명령 없음)

**GitHub Pages**
- 저장소 Settings → Pages → Branch: `main`, Folder: `/ (root)`
- `https://<계정>.github.io/<저장소>/` 로 접속 (예: https://tvking6665.github.io/jeonwoo-portal/)

> 하위 경로에 배포해도 모든 자산 경로가 상대 경로라 그대로 동작합니다.

---

## 4. Supabase 연결 (팀 공유 저장소)

`config.js` 의 `supabase.url` 과 `supabase.anonKey` 가 **둘 다 채워지면 자동으로 Supabase 모드**로 전환됩니다.
비어 있으면 데모 모드(localStorage)로 동작하며, 샘플 게시글 6건이 자동으로 생성됩니다.

### 4-1. 프로젝트 만들기
1. https://supabase.com → *New project* (리전: Northeast Asia – Seoul 권장)
2. *Project Settings → API* 에서 **Project URL** 과 **anon public key** 복사

### 4-2. 테이블 만들기
Supabase 대시보드 → **SQL Editor** 에서 아래를 실행합니다.

```sql
create table if not exists public.posts (
  id          text primary key,
  category    text not null check (category in ('plan', 'result', 'defect', 'product', 'material')),
  title       text not null,
  content     text default '',
  fields      jsonb default '{}'::jsonb,
  images      jsonb default '[]'::jsonb,
  author      text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);

alter table public.posts enable row level security;

-- 내부 공유용: 읽기/쓰기 모두 허용 (아래 5번 보안 주의 참고)
create policy "posts_select" on public.posts for select using (true);
create policy "posts_insert" on public.posts for insert with check (true);
create policy "posts_update" on public.posts for update using (true);
create policy "posts_delete" on public.posts for delete using (true);
```

### 4-3. 이미지 버킷 만들기
**Storage → New bucket** → 이름 `post-images`, **Public bucket 체크**.
또는 SQL Editor 에서:

```sql
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

create policy "post_images_read" on storage.objects
  for select using (bucket_id = 'post-images');

create policy "post_images_insert" on storage.objects
  for insert to anon with check (bucket_id = 'post-images');
```

### 4-4. 설정 입력
`config.js`:

```js
supabase: {
  url: "https://abcdefgh.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  table: "posts",
  bucket: "post-images",
},
```

저장 후 새로고침하면 상단의 **데모 모드** 안내가 사라지고, 작성한 글이 모든 기기에서 공유됩니다.
(이미지 파일은 Storage 에, 게시글은 `posts` 테이블에 저장됩니다.)

---

## 5. 보안 주의 (꼭 읽어 주세요)

이 앱은 **사내 관계자용 간이 포털**입니다. 다음을 이해하고 사용해 주세요.

- `config.js` 는 정적 파일이라 **누구나 소스를 볼 수 있습니다.** 팀 비밀번호와 관리자 비밀번호는
  "실수로 들어오는 것을 막는 잠금장치"이지, 계정 인증이 아닙니다.
- Supabase `anon key` 는 공개되어도 되는 키지만, 위 SQL 처럼 **쓰기 정책을 열어 두면**
  사이트 주소를 아는 사람은 API 로도 글을 쓸 수 있습니다.
- 더 강한 통제가 필요하면 ① Supabase Auth 로 관리자 로그인을 옮기고
  ② 쓰기 정책을 `to authenticated` 로 제한하고
  ③ `config.js` 의 비밀번호 대신 세션을 사용하도록 확장하세요.
- 외부에 완전 공개하지 말고, 필요하면 Vercel/Cloudflare 의 **Password Protection** 이나
  사내망/VPN 뒤에 두는 것을 권장합니다.

---

## 6. 데이터 구조

```json
{
  "id": "p-...",
  "category": "plan | result | defect | product | material",
  "title": "11월 4주차 프레스 1·2라인 생산계획",
  "content": "본문 (줄바꿈 유지)",
  "fields": { "period": "2026-11-23 ~ 11-27", "line": "1·2호 프레스 라인" },
  "images": [ { "url": "assets/sample-plan.svg", "caption": "주간 계획 간트" } ],
  "author": "김현준",
  "createdAt": "2026-11-23T08:05:00+09:00",
  "updatedAt": "2026-11-23T08:05:00+09:00"
}
```

카테고리별 입력 항목은 `app.js` 상단의 `CATEGORIES` 에서 정의합니다.
항목을 추가·삭제하려면 `fields` 배열만 수정하면 목록 카드·상세·작성 폼에 모두 반영됩니다.

| 카테고리 | 주요 항목 |
| --- | --- |
| 생산계획 `plan` | 계획 기간, 생산 라인, 품번/품명, 계획 수량, 담당 |
| 생산실적 `result` | 실적 기간, 생산 라인, 품번/품명, 실적 수량, 달성률(%), 특이사항 |
| 유출불량 `defect` | 발생일, 고객사, 품번/품명, 수량, 불량 유형, 등급(A/B/C), 원인, 대책 |
| 제품 월별판매량 `product` | 기준 월(예: 2026-11), 품번/품명, 고객사, 판매 수량, 비고/특이사항 |
| 소재 월별구매량 `material` | 기준 월(예: 2026-11), 소재명/규격(예: SPHC 2.3t / CR 1.6t), 매입처, 구매 수량/중량(예: 42.5 ton), 비고/특이사항 |

---

## 7. 데모 모드 / 초기화

- Supabase 미설정 시 데이터는 **이 브라우저의 localStorage** 에만 저장됩니다. (기기 간 공유 안 됨)
- 첫 실행 시 샘플 6건이 자동 생성됩니다. `config.js` 의 `storage.seedVersion` 을 올리면
  기존에 쌓인 기록은 그대로 두고 새 샘플만 한 번 더 채워 넣습니다.
- 처음 상태로 되돌리려면 개발자도구 콘솔에서:

```js
localStorage.removeItem("jeonwoo.portal.posts.v1");
localStorage.removeItem("jeonwoo.portal.seed.v1");
location.reload();
```

- 이미지는 1장당 최대 1,600px·JPEG 85%로 자동 압축됩니다. (`config.js` 의 `upload` 에서 조정)
- Supabase 모드에서 게시글을 삭제해도 Storage 에 업로드된 이미지 파일은 남습니다. 필요하면
  Storage → `post-images` 에서 직접 정리하세요.
- 이미지를 많이 올려 **저장 공간이 가득 차면** "저장 공간이 가득 찼습니다" 안내가 나옵니다.
  이때는 Supabase 연결을 사용하거나 오래된 글의 이미지를 줄여 주세요.

---

## 8. 화면 미리보기 파일

검증용 스크린샷이 함께 있다면:

| 파일 | 화면 |
| --- | --- |
| `preview-login.png` | 비밀번호 게이트 |
| `preview-main.png` | 팀 열람 대시보드 (`jwjm1234` 입장 후) |
| `preview-menu-tree.png` | 상단 트리 메뉴 드롭다운이 열린 화면 |
| `preview-admin.png` | 관리자 글쓰기 · 카테고리별 입력 · 이미지 업로드 |
| `preview-detail.png` | 기록 상세 (불량 정보 + 첨부 이미지) |
| `preview-lightbox.png` | 불량 이미지 확대 보기 |
| `preview-charts.png` | 설비별 계획 vs 실적 차트 · 주차별 추이 · 설비별 요약표 |
| `preview-mobile-charts.png` | 모바일(390px) 분석 대시보드 |

---

## 9. 엑셀 업로드 · 설비별 그래프 (analytics.js)

관리자로 로그인하면 기록 목록 위의 **생산 분석** 영역에 엑셀 업로드 바가 나타납니다.
파일을 끌어다 놓거나 클릭해서 고르면 브라우저 안에서 바로 파싱하고, 새로고침해도 유지되도록 `localStorage`(`jeonwoo.portal.excel.v1`)에 보관합니다.

### 읽는 시트 (자동 인식)

| 순서 | 시트 | 사용하는 값 |
| --- | --- | --- |
| 1 | `주차별_생산요약` | 주차별 계획량 · 양품실적 · 불량수량 · 달성률 · 과부족, 설비별 월 누적 |
| 2 | `생산계획_통제` | 일자별 계획/실적을 주차(1~7, 8~14, 15~21, 22~28, 29~말일)로 합산 |
| 3 | `생산실적` | 설비·작업일별 원장을 주차로 합산 (계획이 없으므로 실적만 표시) |

- 시트 이름이 달라도 `설비구분/설비명 + 계획량` 헤더 구조가 있으면 인식합니다.
- 날짜 열이 `2026-10-01` 형태면 그 달을 기준 월로 잡고, 없으면 제목의 `10월`과 파일의 연도로 추정합니다.
- 합계 행(`■ 설비별 총계`)은 자동으로 전체 합계로 분리합니다.
- `.xlsx` · `.xls` · `.csv` 를 지원합니다(CSV는 위 구조를 그대로 내보낸 경우).

### 표시되는 내용

- **KPI** — 월 계획 / 양품실적(달성률) / 불량수량(불량률) / 잔여(과부족)
- **설비별 계획 vs 양품실적** — 막대(수량) + 선(달성률, 오른쪽 축) 11개 설비
- **주차별 생산 추이** — 주차별 계획·양품 막대 + 불량 선
- **설비별 요약** — 가동형태 · 발주량 · 계획 · 양품 · 불량 · 달성률(게이지) · 잔여 + 전체 합계 행
- **제품 월별판매량 / 소재 월별구매량** — 기록의 `기준 월`·`수량`을 모아 월별 막대·전월 대비·누적, 새 기록을 저장하면 즉시 반영
- **유출불량 히스토리** — 전체/이번 달/A등급 건수와 월별 발생 건수 차트

### 기본값과 초기화

처음 열면 `assets/seed-data.js` 에 들어 있는 **실제 10월 주차별_생산요약 값**(11개 설비)이 표시됩니다.
업로드 후 **샘플 데이터로 되돌리기** 를 누르면 저장된 업로드본을 지우고 이 기본값으로 돌아갑니다.

### 라이브러리

`assets/vendor/` 에 SheetJS 0.18.5 와 Chart.js 4.4.6 사본을 함께 두어 오프라인·사내망에서도 동작합니다.
사본이 없으면 `index.html` 이 jsDelivr CDN에서 자동으로 보충합니다.

---

## 10. 단축키 · 사용 팁

- `/` — 검색창으로 이동
- `Esc` — 열린 창/이미지 닫기
- 이미지 확대 상태에서 `←` `→` — 이전/다음 이미지
- 데스크톱에서 카드에 마우스를 올리면 관리자에게 **수정 / 삭제** 버튼이 나타납니다.
- 모바일에서는 카드 하단에 항상 표시됩니다.
- 팀 열람 화면 상단의 **관리자 로그인** 버튼으로 관리자 모드로 전환할 수 있습니다.

---

© 전우정밀 (JEONWOO PRECISION) — 내부 열람용
