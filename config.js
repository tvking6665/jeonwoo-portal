/**
 * 전우정밀 생산 이력 공유 포털 — 설정 파일
 * ------------------------------------------------------------------
 * 이 파일만 수정하면 비밀번호·회사 정보·데이터 저장소를 바꿀 수 있습니다.
 * (자세한 설명은 README.md 참고)
 */
window.JEONWOO_CONFIG = {
  company: {
    name: "전우정밀",
    nameEn: "JEONWOO PRECISION",
    tagline: "정밀 프레스 부품 제조",
    siteTitle: "생산 이력 공유 포털",
  },

  /** 접속 비밀번호 */
  auth: {
    // 팀원 공용 열람 비밀번호 (읽기 전용)
    teamPassword: "jwjm1234",
    // 관리자 비밀번호 (작성·수정·삭제)
    adminPassword: "admin1234!",
  },

  /**
   * Supabase 연결 (선택)
   * url 과 anonKey 를 모두 채우면 자동으로 Supabase 모드로 전환됩니다.
   * 비워 두면 이 브라우저(localStorage)에만 저장되는 데모 모드로 동작합니다.
   */
  supabase: {
    url: "",             // 예: "https://abcdefgh.supabase.co"
    anonKey: "",         // 예: "eyJhbGciOiJIUzI1NiIsInR5cCI6..."
    table: "posts",      // 게시글 테이블 이름
    bucket: "post-images", // 이미지 저장 버킷 이름 (public)
  },

  /** 로컬(데모) 모드 저장 키 */
  storage: {
    postsKey: "jeonwoo.portal.posts.v1",
    sessionKey: "jeonwoo.portal.session.v1",
    seedKey: "jeonwoo.portal.seed.v1",
    // 값을 올리면 기존 기록은 그대로 두고 새 샘플만 한 번 더 채워 넣습니다.
    seedVersion: 2,
  },

  /** 이미지 업로드 설정 */
  upload: {
    maxFiles: 8,            // 게시글당 최대 이미지 수
    maxFileMB: 15,          // 파일 1개 최대 용량
    maxWidth: 1600,         // 저장 시 가로 최대 픽셀
    quality: 0.85,          // JPEG 품질
  },

  /** 기본 작성자 이름 */
  defaultAuthor: "김현준",
};
