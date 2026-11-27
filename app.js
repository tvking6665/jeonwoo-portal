/* ============================================================
   전우정밀 생산 이력 공유 포털 — app.js
   데이터 계층 + 화면 렌더링 (Supabase / localStorage 자동 전환)
   ============================================================ */
(function () {
  "use strict";

  /* ------------------------------------------------------------
     0. 설정 병합
     ------------------------------------------------------------ */
  var RAW = window.JEONWOO_CONFIG || {};

  var CFG = {
    company: Object.assign(
      { name: "전우정밀", nameEn: "JEONWOO PRECISION", tagline: "정밀 프레스 부품 제조", siteTitle: "생산 이력 공유 포털" },
      RAW.company || {}
    ),
    auth: Object.assign(
      { teamPassword: "jwjm1234", adminPassword: "admin1234!" },
      RAW.auth || {}
    ),
    supabase: Object.assign(
      { url: "", anonKey: "", table: "posts", bucket: "post-images" },
      RAW.supabase || {}
    ),
    storage: Object.assign(
      {
        postsKey: "jeonwoo.portal.posts.v1",
        sessionKey: "jeonwoo.portal.session.v1",
        seedKey: "jeonwoo.portal.seed.v1",
        seedVersion: 2,
      },
      RAW.storage || {}
    ),
    upload: Object.assign(
      { maxFiles: 8, maxFileMB: 15, maxWidth: 1600, quality: 0.85 },
      RAW.upload || {}
    ),
    defaultAuthor: RAW.defaultAuthor || "김현준",
  };

  /* ------------------------------------------------------------
     1. 카테고리 정의 (입력 항목도 여기서 관리)
     ------------------------------------------------------------ */
  var CATEGORIES = {
    plan: {
      id: "plan",
      label: "생산계획",
      short: "생산계획",
      group: "생산관리",
      chip: "chip-plan",
      icon: "📅",
      fields: [
        { key: "period", label: "계획 기간", placeholder: "2026-11-23 ~ 11-27", required: true, card: true },
        { key: "line", label: "생산 라인", placeholder: "1호 프레스 라인", card: true },
        { key: "item", label: "품번 / 품명", placeholder: "JW-BRK-2041 브래킷", card: true },
        { key: "quantity", label: "계획 수량", placeholder: "12,000 EA", card: true },
        { key: "owner", label: "담당", placeholder: "생산기술팀" },
      ],
    },
    result: {
      id: "result",
      label: "생산실적",
      short: "생산실적",
      group: "생산관리",
      chip: "chip-result",
      icon: "📈",
      fields: [
        { key: "period", label: "실적 기간", placeholder: "2026-11-16 ~ 11-20", required: true, card: true },
        { key: "line", label: "생산 라인", placeholder: "1호 프레스 라인", card: true },
        { key: "item", label: "품번 / 품명", placeholder: "JW-BRK-2041 브래킷" },
        { key: "quantity", label: "실적 수량", placeholder: "11,568 EA", card: true },
        { key: "rate", label: "달성률 (%)", placeholder: "96.4", type: "number", card: true },
        { key: "issue", label: "특이사항", placeholder: "설비 정지, 품질 이슈 등", type: "textarea", full: true },
      ],
    },
    defect: {
      id: "defect",
      label: "유출불량 히스토리",
      short: "유출불량",
      group: "품질관리",
      chip: "chip-defect",
      icon: "🔎",
      fields: [
        { key: "occurredAt", label: "발생일", type: "date", required: true, card: true },
        { key: "customer", label: "고객사", placeholder: "대성오토", card: true },
        { key: "item", label: "품번 / 품명", placeholder: "JW-BRK-2041 브래킷", card: true },
        { key: "quantity", label: "수량", placeholder: "120 EA", card: true },
        { key: "defectType", label: "불량 유형", placeholder: "미세 크랙 / 치수 이탈", card: true },
        { key: "severity", label: "등급", type: "select", options: ["A", "B", "C"], card: true },
        { key: "cause", label: "원인", placeholder: "발생 원인 분석", type: "textarea", full: true },
        { key: "countermeasure", label: "대책", placeholder: "재발 방지 대책", type: "textarea", full: true },
      ],
    },
    product: {
      id: "product",
      label: "제품 월별판매량",
      short: "제품 판매",
      group: "영업·자재",
      chip: "chip-product",
      icon: "🏷",
      fields: [
        { key: "month", label: "기준 월", placeholder: "2026-11", required: true, card: true },
        { key: "item", label: "품번 / 품명", placeholder: "JW-BRK-2041 브래킷", card: true },
        { key: "customer", label: "고객사", placeholder: "대성오토", card: true },
        { key: "quantity", label: "판매 수량", placeholder: "6,000 EA", card: true },
        { key: "note", label: "비고 / 특이사항", placeholder: "추가 발주, 단가 변동 등", type: "textarea", full: true },
      ],
    },
    material: {
      id: "material",
      label: "소재 월별구매량",
      short: "소재 구매",
      group: "영업·자재",
      chip: "chip-material",
      icon: "🧱",
      fields: [
        { key: "month", label: "기준 월", placeholder: "2026-11", required: true, card: true },
        { key: "material", label: "소재명 / 규격", placeholder: "SPHC 2.3t / CR 1.6t", card: true },
        { key: "supplier", label: "매입처", placeholder: "포스코 스틸서비스", card: true },
        { key: "quantity", label: "구매 수량 / 중량", placeholder: "42.5 ton", card: true },
        { key: "note", label: "비고 / 특이사항", placeholder: "단가, 입고 일정 등", type: "textarea", full: true },
      ],
    },
  };
  var CATEGORY_ORDER = ["plan", "result", "defect", "product", "material"];

  /* ------------------------------------------------------------
     2. 작은 도구들
     ------------------------------------------------------------ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function uid() {
    return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function toDate(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function fmtDate(value) {
    var d = toDate(value);
    if (!d) return "—";
    return d.getFullYear() + "." + pad2(d.getMonth() + 1) + "." + pad2(d.getDate());
  }

  function fmtDateShort(value) {
    var d = toDate(value);
    if (!d) return "";
    return pad2(d.getMonth() + 1) + "." + pad2(d.getDate());
  }

  function fmtDateTime(value) {
    var d = toDate(value);
    if (!d) return "—";
    return fmtDate(value) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function todayInput() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("파일을 읽을 수 없습니다: " + file.name)); };
      reader.readAsDataURL(file);
    });
  }

  function initials(name) {
    var text = String(name || "?").trim();
    return text ? text.charAt(0) : "?";
  }

  /* ------------------------------------------------------------
     3. 샘플 데이터 (데모 모드 첫 실행 시 1회 저장)
     ------------------------------------------------------------ */
  function samplePosts() {
    return [
      {
        id: "p-sample-plan-1123",
        category: "plan",
        title: "11월 4주차 프레스 1·2라인 생산계획",
        content:
          "11월 4주차 주간 생산계획을 공유합니다.\n\n" +
          "· 1호 프레스 — 브래킷 JW-BRK-2041 6,000 EA\n" +
          "· 2호 프레스 — 하우징 JW-HSG-1180 4,000 EA\n" +
          "· 조립·검사 — 3,000 EA (수요일부터)\n\n" +
          "목요일 오전에는 2호 프레스 금형 교체가 예정되어 있어 해당 시간대 가동이 중단됩니다. " +
          "납기 대응을 위해 1호 라인은 수요일까지 2교대 운영합니다.",
        fields: {
          period: "2026-11-23 ~ 11-27",
          line: "1·2호 프레스 라인",
          item: "JW-BRK-2041 외 2종",
          quantity: "12,000 EA",
          owner: "생산기술팀 김현준",
        },
        images: [
          { url: "assets/sample-plan.svg", caption: "11월 4주차 주간 생산계획 (간트)" },
        ],
        author: "김현준",
        createdAt: "2026-11-23T08:05:00+09:00",
        updatedAt: "2026-11-23T08:05:00+09:00",
      },
      {
        id: "p-sample-result-1120",
        category: "result",
        title: "11월 3주차 생산실적 — 달성률 96.4%",
        content:
          "11월 3주차(11/16~11/20) 생산실적입니다.\n\n" +
          "계획 12,000 EA 대비 실적 11,568 EA로 달성률 96.4%를 기록했습니다. " +
          "목요일 2호 프레스 금형 마모로 2시간 가동이 정지되었으나, 대체 금형으로 교체 후 만회 생산을 진행했습니다.\n\n" +
          "이번 주 잔여 물량은 다음 주 월요일 1라인에서 우선 소진할 예정입니다.",
        fields: {
          period: "2026-11-16 ~ 11-20",
          line: "1·2호 프레스 라인",
          item: "브래킷 · 하우징",
          quantity: "11,568 / 12,000 EA",
          rate: "96.4",
          issue: "2호 프레스 금형 마모로 목요일 2시간 정지 (대체 금형 교체 완료)",
        },
        images: [
          { url: "assets/sample-result.svg", caption: "일자별 계획 대비 실적" },
        ],
        author: "김현준",
        createdAt: "2026-11-21T09:40:00+09:00",
        updatedAt: "2026-11-21T09:40:00+09:00",
      },
      {
        id: "p-sample-defect-1118",
        category: "defect",
        title: "브래킷 미세 크랙 유출 — 출구 검사 미검",
        content:
          "11월 18일 2호 프레스 라인에서 생산한 브래킷 JW-BRK-2041 120 EA에서 미세 크랙이 확인되어 고객사로 유출되었습니다.\n\n" +
          "출구 비전 검사 임계값이 0.6mm로 상향 운영되면서 0.35mm 수준의 크랙이 검출되지 않았습니다. " +
          "해당 로트는 전수 재검사 후 불량 120 EA를 선별하였고, 고객사에는 즉시 통보 및 대체품 출하를 완료했습니다.\n\n" +
          "재발 방지를 위해 검사 임계값을 0.35mm로 복원하고, 금형 냉각 시간을 2초 연장했습니다. " +
          "주 1회 검사 프로그램 검증을 추가로 실시합니다.",
        fields: {
          occurredAt: "2026-11-18",
          customer: "대성오토",
          item: "JW-BRK-2041 브래킷",
          quantity: "120 EA",
          defectType: "미세 크랙",
          severity: "A",
          cause: "검사 임계값 상향(0.4→0.6mm)으로 0.35mm 크랙 미검출, 성형 후 잔류 응력 누적",
          countermeasure: "임계값 0.35mm 복원, 해당 로트 전수 재검사, 금형 냉각 2초 연장, 검사 프로그램 주 1회 검증",
        },
        images: [
          { url: "assets/sample-defect-crack.svg", caption: "출구 비전 검사 캡처 — 크랙 0.35mm" },
          { url: "assets/sample-defect-dim.svg", caption: "동일 로트 치수 측정 결과" },
        ],
        author: "김현준",
        createdAt: "2026-11-19T10:20:00+09:00",
        updatedAt: "2026-11-19T10:20:00+09:00",
      },
      {
        id: "p-sample-defect-1111",
        category: "defect",
        title: "하우징 체결홀 치수 이탈 — 고객사 수입검사 지적",
        content:
          "한성정공 수입검사에서 하우징 JW-HSG-1180의 체결홀 위치가 규격 대비 +0.12mm 이탈한 것으로 확인되었습니다(38 EA).\n\n" +
          "원인은 조립 지그의 마모로 위치 편차가 누적된 것으로 판단됩니다. " +
          "해당 3개 로트는 재작업 후 재출하하였으며, 지그를 신품으로 교체했습니다.\n\n" +
          "일일 첫 제품 치수 확인 항목에 체결홀 위치를 추가하여 편차 추이를 관리합니다.",
        fields: {
          occurredAt: "2026-11-11",
          customer: "한성정공",
          item: "JW-HSG-1180 하우징",
          quantity: "38 EA",
          defectType: "치수 이탈 (홀 위치 +0.12mm)",
          severity: "B",
          cause: "조립 지그 마모로 위치 편차 누적",
          countermeasure: "지그 신품 교체, 3개 로트 재작업, 일일 첫 제품 치수 확인 항목 추가",
        },
        images: [
          { url: "assets/sample-defect-dim.svg", caption: "체결홀 위치 측정 — 규격 대비 +0.12mm" },
        ],
        author: "김현준",
        createdAt: "2026-11-12T14:05:00+09:00",
        updatedAt: "2026-11-12T14:05:00+09:00",
      },
      {
        id: "p-sample-sales-202611",
        category: "product",
        seedVersion: 2,
        title: "11월 제품 월별판매량 — 브래킷 견조, 하우징 소폭 감소",
        content:
          "11월 제품 월별판매량 정리입니다 (집계 기준 11/26, 마감 전 잠정치).\n\n" +
          "· 브래킷 JW-BRK-2041 — 11,200 EA (대성오토 8,400 / 한성정공 2,800)\n" +
          "· 하우징 JW-HSG-1180 — 7,200 EA (한성정공 5,100 / 대성오토 2,100)\n\n" +
          "브래킷은 11/24 대성오토 추가 발주 2,000 EA가 반영되어 전월 대비 6.4% 늘었고, " +
          "하우징은 고객사 재고 조정으로 3.1% 줄었습니다. 12월은 브래킷 중심으로 19,000 EA 수준을 예상합니다.",
        fields: {
          month: "2026-11",
          item: "JW-BRK-2041 / JW-HSG-1180",
          customer: "대성오토 · 한성정공",
          quantity: "18,400 EA",
          note: "11/24 대성오토 추가 발주 2,000 EA 반영 · 12월 예상 19,000 EA",
        },
        images: [],
        author: "김현준",
        createdAt: "2026-11-26T09:15:00+09:00",
        updatedAt: "2026-11-26T09:15:00+09:00",
      },
      {
        id: "p-sample-material-202611",
        category: "material",
        seedVersion: 2,
        title: "11월 소재 월별구매량 — SPHC 2.3t 42.5 ton 입고",
        content:
          "11월 소재 구매 실적입니다.\n\n" +
          "· SPHC 2.3t — 42.5 ton (포스코 스틸서비스, 3회 분할 입고)\n" +
          "· CR 1.6t — 12.0 ton (대구철강)\n\n" +
          "브래킷 증산분 반영으로 SPHC는 전월 대비 8% 늘었고, CR은 재고 소진 위주로 구매를 줄였습니다. " +
          "12월 초 단가 3% 인상 예고가 있어 12월분 20 ton은 11월 내 선구매를 검토 중입니다.",
        fields: {
          month: "2026-11",
          material: "SPHC 2.3t / CR 1.6t",
          supplier: "포스코 스틸서비스 · 대구철강",
          quantity: "54.5 ton",
          note: "12월 초 단가 3% 인상 예고 — 12월분 20 ton 선구매 검토",
        },
        images: [],
        author: "김현준",
        createdAt: "2026-11-25T14:30:00+09:00",
        updatedAt: "2026-11-25T14:30:00+09:00",
      },
    ];
  }

  /* ------------------------------------------------------------
     4. 데이터 계층 (Supabase ↔ localStorage)
     ------------------------------------------------------------ */
  var Store = (function () {
    var sb = CFG.supabase;
    var configured = !!(sb.url && sb.anonKey);
    var mode = configured ? "supabase" : "local";
    var baseUrl = String(sb.url || "").replace(/\/+$/, "");
    var table = sb.table || "posts";
    var bucket = sb.bucket || "post-images";
    var key = sb.anonKey;

    /* ---- localStorage ---- */
    function readLocal() {
      try {
        var raw = localStorage.getItem(CFG.storage.postsKey);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.posts)) return parsed.posts;
        return null;
      } catch (err) {
        console.warn("[전우정밀] 로컬 저장소를 읽지 못했습니다.", err);
        return null;
      }
    }

    function writeLocal(posts) {
      try {
        localStorage.setItem(CFG.storage.postsKey, JSON.stringify(posts));
      } catch (err) {
        if (err && (err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014)) {
          throw new Error("브라우저 저장 공간이 가득 찼습니다. 이미지를 줄이거나 Supabase를 연결해 주세요.");
        }
        throw err;
      }
    }

    function seedLocal() {
      var existing = readLocal() || [];
      var applied = 0;
      try { applied = parseInt(localStorage.getItem(CFG.storage.seedKey), 10) || 0; } catch (err) { applied = 0; }

      /* 이미 최신 샘플이 반영되어 있으면 그대로 사용 */
      if (existing.length && applied >= CFG.storage.seedVersion) return existing;

      var samples = samplePosts();
      var merged;
      if (!existing.length) {
        merged = samples.slice();
      } else {
        /* 기존에 쌓인 기록은 그대로 두고, 이번 버전에서 새로 추가된 샘플만 더한다 */
        var ids = existing.map(function (p) { return p.id; });
        merged = existing.concat(samples.filter(function (s) {
          return ids.indexOf(s.id) === -1 && (s.seedVersion || 1) >= CFG.storage.seedVersion;
        }));
      }
      merged = merged.map(function (p) {
        var copy = Object.assign({}, p);
        delete copy.seedVersion;
        return copy;
      });

      try {
        writeLocal(merged);
        localStorage.setItem(CFG.storage.seedKey, String(CFG.storage.seedVersion));
      } catch (err) { console.warn(err); }
      return merged;
    }

    /* ---- Supabase REST ---- */
    function rest(path, options) {
      options = options || {};
      var headers = {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: options.prefer || "return=representation",
      };
      if (options.headers) Object.assign(headers, options.headers);

      return fetch(baseUrl + "/rest/v1/" + path, {
        method: options.method || "GET",
        headers: headers,
        body: options.body,
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            throw new Error("Supabase 오류 (" + res.status + "): " + String(text).slice(0, 180));
          });
        }
        if (res.status === 204) return null;
        return res.text().then(function (text) { return text ? JSON.parse(text) : null; });
      });
    }

    function fromRow(row) {
      return {
        id: row.id,
        category: row.category,
        title: row.title,
        content: row.content || "",
        fields: row.fields && typeof row.fields === "object" ? row.fields : {},
        images: Array.isArray(row.images) ? row.images : [],
        author: row.author || "",
        createdAt: row.created_at || row.createdAt,
        updatedAt: row.updated_at || row.updatedAt || row.created_at || row.createdAt,
      };
    }

    function toRow(post) {
      return {
        id: post.id,
        category: post.category,
        title: post.title,
        content: post.content,
        fields: post.fields,
        images: post.images,
        author: post.author,
        created_at: post.createdAt,
        updated_at: post.updatedAt,
      };
    }

    /* ---- 이미지 ---- */
    function loadImage(file) {
      return new Promise(function (resolve, reject) {
        var objectUrl = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(objectUrl); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(objectUrl); reject(new Error("이미지를 열 수 없습니다: " + file.name)); };
        img.src = objectUrl;
      });
    }

    function compress(file) {
      if (!file.type || file.type.indexOf("image/") !== 0) {
        return Promise.reject(new Error("이미지 파일만 올릴 수 있습니다: " + file.name));
      }
      if (file.size > CFG.upload.maxFileMB * 1024 * 1024) {
        return Promise.reject(new Error(file.name + " — 파일이 " + CFG.upload.maxFileMB + "MB를 넘습니다."));
      }
      if (file.type === "image/svg+xml") {
        return readAsDataURL(file).then(function (dataUrl) {
          return { dataUrl: dataUrl, blob: file, name: file.name };
        });
      }
      return loadImage(file).then(function (img) {
        var maxW = CFG.upload.maxWidth;
        var scale = Math.min(1, maxW / (img.naturalWidth || maxW));
        var w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
        var h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        var quality = CFG.upload.quality;
        return new Promise(function (resolve) {
          if (canvas.toBlob) {
            canvas.toBlob(function (blob) {
              resolve({
                blob: blob || file,
                dataUrl: canvas.toDataURL("image/jpeg", quality),
                name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
              });
            }, "image/jpeg", quality);
          } else {
            resolve({ blob: file, dataUrl: canvas.toDataURL("image/jpeg", quality), name: file.name });
          }
        });
      });
    }

    function uploadToStorage(compressed) {
      var safeName = String(compressed.name || "image").replace(/[^a-zA-Z0-9._-]/g, "_");
      var path = "posts/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "-" + safeName;
      var body = compressed.blob;
      return fetch(baseUrl + "/storage/v1/object/" + bucket + "/" + path, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": body.type || "image/jpeg",
          "x-upsert": "true",
        },
        body: body,
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            throw new Error("이미지 업로드 실패 (" + res.status + "): " + String(text).slice(0, 160));
          });
        }
        return baseUrl + "/storage/v1/object/public/" + bucket + "/" + path;
      });
    }

    /* ---- 공개 API ---- */
    return {
      mode: mode,

      list: function () {
        if (mode === "local") {
          return Promise.resolve(seedLocal().slice());
        }
        return rest(table + "?select=*&order=created_at.desc").then(function (rows) {
          return (rows || []).map(fromRow);
        });
      },

      create: function (post) {
        if (mode === "local") {
          var posts = readLocal() || [];
          posts.unshift(post);
          writeLocal(posts);
          return Promise.resolve(post);
        }
        return rest(table, { method: "POST", body: JSON.stringify(toRow(post)) }).then(function (rows) {
          return fromRow(Array.isArray(rows) ? rows[0] : rows);
        });
      },

      update: function (post) {
        if (mode === "local") {
          var posts = readLocal() || [];
          var idx = posts.findIndex(function (p) { return p.id === post.id; });
          if (idx === -1) posts.unshift(post); else posts[idx] = post;
          writeLocal(posts);
          return Promise.resolve(post);
        }
        return rest(table + "?id=eq." + encodeURIComponent(post.id), {
          method: "PATCH",
          body: JSON.stringify(toRow(post)),
        }).then(function (rows) {
          return fromRow(Array.isArray(rows) ? rows[0] : rows);
        });
      },

      remove: function (id) {
        if (mode === "local") {
          var posts = (readLocal() || []).filter(function (p) { return p.id !== id; });
          writeLocal(posts);
          return Promise.resolve();
        }
        return rest(table + "?id=eq." + encodeURIComponent(id), { method: "DELETE", prefer: "return=minimal" });
      },

      uploadImage: function (file) {
        return compress(file).then(function (compressed) {
          if (mode === "local") {
            return { url: compressed.dataUrl, name: compressed.name, caption: "" };
          }
          return uploadToStorage(compressed).then(function (url) {
            return { url: url, name: compressed.name, caption: "" };
          });
        });
      },
    };
  })();

  /* ------------------------------------------------------------
     5. 상태
     ------------------------------------------------------------ */
  var state = {
    role: "team",
    posts: [],
    filter: "all",
    query: "",
    sort: "newest",
    loading: true,
    editingId: null,
    draftImages: [],
    uploading: false,
    detailId: null,
    pendingDeleteId: null,
    lightbox: { images: [], index: 0 },
    lastSavedId: null,
    lastFocused: null,
  };

  var TOAST_TIMER = null;

  /* ------------------------------------------------------------
     6. 인증 / 게이트
     ------------------------------------------------------------ */
  function showGate() {
    $("#app").hidden = true;
    $("#gate").hidden = false;
    document.body.classList.remove("is-locked");
    closeAllModals();
    var input = $("#gatePassword");
    if (input) {
      input.value = "";
      setTimeout(function () { input.focus(); }, 60);
    }
    setGateError("");
  }

  function unlock(role) {
    state.role = role;
    try { sessionStorage.setItem(CFG.storage.sessionKey, role); } catch (err) { /* ignore */ }
    $("#gate").hidden = true;
    $("#app").hidden = false;
    $("#gatePassword").value = "";
    $("#adminPassword").value = "";
    setGateError("");
    applyRole();
    loadPosts();
  }

  function applyRole() {
    var isAdmin = state.role === "admin";
    var badge = $("#roleBadge");
    badge.className = "role-badge " + (isAdmin ? "role-admin" : "role-team");
    $("#roleText").textContent = isAdmin ? "관리자" : "팀 열람";
    $("#newPostBtn").hidden = !isAdmin;
    $("#adminLoginBtn").hidden = isAdmin;
    $("#emptyNewBtn").hidden = !isAdmin;
  }

  function setGateError(message) {
    var el = $("#gateError");
    el.textContent = message || "";
    el.hidden = !message;
  }

  function handleGateSubmit(event) {
    event.preventDefault();
    var input = $("#gatePassword");
    var value = input.value.trim();
    if (!value) {
      setGateError("비밀번호를 입력해 주세요.");
      input.focus();
      return;
    }
    if (value === CFG.auth.teamPassword) {
      unlock("team");
      toast("생산 이력 포털에 입장했습니다.");
    } else if (value === CFG.auth.adminPassword) {
      unlock("admin");
      toast("관리자 모드로 입장했습니다.");
    } else {
      setGateError("비밀번호가 맞지 않습니다. 팀 공지에 안내된 비밀번호를 확인해 주세요.");
      var card = $(".gate-card");
      card.classList.remove("is-shake");
      void card.offsetWidth;
      card.classList.add("is-shake");
      input.select();
    }
  }

  function handleAdminSubmit(event) {
    event.preventDefault();
    var input = $("#adminPassword");
    var err = $("#adminError");
    var value = input.value.trim();
    if (value === CFG.auth.adminPassword) {
      closeModal("adminLoginModal");
      if (state.role !== "admin") unlock("admin");
      else { applyRole(); renderList(); }
      toast("관리자 모드로 전환했습니다. 글 작성·수정·삭제가 가능합니다.");
    } else {
      err.textContent = "관리자 비밀번호가 맞지 않습니다.";
      err.hidden = false;
      input.select();
    }
  }

  /* ------------------------------------------------------------
     7. 데이터 로드 / 렌더
     ------------------------------------------------------------ */
  function loadPosts() {
    state.loading = true;
    $("#resultCount").textContent = "불러오는 중…";
    $("#demoBanner").hidden = Store.mode !== "local";

    Store.list()
      .then(function (posts) {
        state.posts = posts || [];
        state.loading = false;
        renderAll();
      })
      .catch(function (err) {
        state.loading = false;
        state.posts = [];
        console.error(err);
        renderAll();
        toast(err.message || "기록을 불러오지 못했습니다.", "error");
      });
  }

  function searchText(post) {
    var cat = CATEGORIES[post.category];
    var parts = [post.title, post.content, post.author, cat ? cat.label : ""];
    Object.keys(post.fields || {}).forEach(function (k) {
      parts.push(post.fields[k]);
    }.bind(parts));
    return parts.join(" ").toLowerCase();
  }

  function visiblePosts() {
    var list = state.posts.slice();
    if (state.filter !== "all") {
      list = list.filter(function (p) { return p.category === state.filter; });
    }
    var q = state.query.trim().toLowerCase();
    if (q) {
      list = list.filter(function (p) { return searchText(p).indexOf(q) !== -1; });
    }
    var dir = state.sort === "oldest" ? -1 : 1;
    list.sort(function (a, b) {
      var da = toDate(a.createdAt), db = toDate(b.createdAt);
      return dir * ((db ? db.getTime() : 0) - (da ? da.getTime() : 0));
    });
    return list;
  }

  function renderAll() {
    renderStats();
    renderTabs();
    renderList();
    applyRole();
  }

  function renderStats() {
    var total = state.posts.length;
    var counts = {};
    CATEGORY_ORDER.forEach(function (k) { counts[k] = 0; });
    state.posts.forEach(function (p) { if (counts[p.category] != null) counts[p.category]++; });

    $$("[data-stat]").forEach(function (el) {
      var k = el.getAttribute("data-stat");
      el.textContent = k === "total" ? total : (counts[k] || 0);
    });
    $$("[data-count]").forEach(function (el) {
      var k = el.getAttribute("data-count");
      el.textContent = k === "all" ? total : (counts[k] || 0);
    });
    $$("[data-navcount]").forEach(function (el) {
      var k = el.getAttribute("data-navcount");
      el.textContent = counts[k] || 0;
    });
  }

  /* 필터 상태를 트리 메뉴 · 칩에 반영 */
  function renderTabs() {
    $$(".filter-chip[data-filter]").forEach(function (chip) {
      var active = chip.getAttribute("data-filter") === state.filter;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    });
    $$(".nav-link[data-filter]").forEach(function (link) {
      var active = link.getAttribute("data-filter") === state.filter;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    $$(".nav-sub [data-filter]").forEach(function (btn) {
      btn.classList.toggle("is-current", btn.getAttribute("data-filter") === state.filter);
    });
    $$(".nav-item.has-sub").forEach(function (item) {
      item.classList.toggle("has-current", !!$(".nav-link.is-active, .nav-sub .is-current", item));
    });
  }

  function miniMeta(post) {
    var cat = CATEGORIES[post.category];
    if (!cat) return "";
    var items = cat.fields
      .filter(function (f) { return f.card && post.fields && post.fields[f.key]; })
      .slice(0, 3)
      .map(function (f) {
        return "<div><dt>" + esc(f.label) + "</dt><dd>" + esc(post.fields[f.key]) + "</dd></div>";
      });
    return items.length ? '<dl class="mini-meta">' + items.join("") + "</dl>" : "";
  }

  function thumbs(post) {
    var images = post.images || [];
    if (!images.length) return "";
    var shown = images.slice(0, images.length > 3 ? 2 : 3);
    var html = shown.map(function (img) {
      return '<span class="card-thumb"><img src="' + esc(img.url) + '" alt="" loading="lazy"></span>';
    });
    if (images.length > shown.length) {
      html.push('<span class="card-thumb more">+' + (images.length - shown.length) + "</span>");
    }
    return '<div class="card-thumbs">' + html.join("") + "</div>";
  }

  function cardHtml(post) {
    var cat = CATEGORIES[post.category];
    if (!cat) return "";
    var isAdmin = state.role === "admin";
    var sev = post.category === "defect" && post.fields && post.fields.severity
      ? '<span class="sev sev-' + esc(post.fields.severity) + '">등급 ' + esc(post.fields.severity) + "</span>"
      : "";
    var excerpt = String(post.content || "").replace(/\s+/g, " ").trim();
    var actions = isAdmin
      ? '<div class="card-actions">' +
          '<button type="button" class="icon-btn" data-action="edit-post" data-id="' + esc(post.id) + '">수정</button>' +
          '<button type="button" class="icon-btn danger" data-action="delete-post" data-id="' + esc(post.id) + '">삭제</button>' +
        "</div>"
      : "";

    return (
      '<article class="post-card' + (state.lastSavedId === post.id ? " is-new" : "") + '"' +
        ' role="button" tabindex="0" aria-label="' + esc(post.title) + ' 상세 보기"' +
        ' data-action="open-post" data-id="' + esc(post.id) + '">' +
        '<div class="card-top">' +
          '<span class="chip ' + cat.chip + '">' + esc(cat.label) + "</span>" +
          '<span class="card-date">' + esc(fmtDateShort(post.createdAt)) + "</span>" +
        "</div>" +
        "<h3>" + esc(post.title) + "</h3>" +
        (excerpt ? '<p class="card-excerpt">' + esc(excerpt) + "</p>" : "") +
        sev +
        miniMeta(post) +
        thumbs(post) +
        '<div class="card-foot">' +
          '<span class="card-author"><span class="avatar">' + esc(initials(post.author)) + "</span>" + esc(post.author || "—") + "</span>" +
          actions +
        "</div>" +
      "</article>"
    );
  }

  function renderList() {
    var list = visiblePosts();
    var grid = $("#postGrid");
    var empty = $("#emptyState");
    var catLabel = state.filter === "all" ? "전체" : CATEGORIES[state.filter].label;

    $("#listTitle").textContent = catLabel + " 기록";

    var clearBtn = $(".search-clear");
    if (clearBtn) clearBtn.hidden = !state.query;

    if (state.loading) {
      $("#resultCount").textContent = "불러오는 중…";
      grid.innerHTML = "";
      empty.hidden = true;
      return;
    }

    $("#resultCount").textContent = state.query
      ? '"' + state.query + '" 검색 결과 ' + list.length + "건"
      : list.length + "건";

    grid.innerHTML = list.map(cardHtml).join("");
    grid.hidden = list.length === 0;
    empty.hidden = list.length !== 0;

    if (!list.length) {
      var emptyTitle = $("#emptyTitle");
      var emptyDesc = $("#emptyDesc");
      if (state.query) {
        emptyTitle.textContent = "검색 결과가 없습니다";
        emptyDesc.textContent = "다른 검색어를 입력하거나 카테고리를 전체로 바꿔 보세요.";
      } else if (state.posts.length === 0) {
        emptyTitle.textContent = "아직 등록된 기록이 없습니다";
        emptyDesc.textContent = state.role === "admin"
          ? "새 글 작성으로 첫 기록을 남겨 보세요."
          : "관리자가 기록을 등록하면 이곳에 표시됩니다.";
      } else {
        emptyTitle.textContent = catLabel + " 기록이 없습니다";
        emptyDesc.textContent = "다른 카테고리를 선택해 보세요.";
      }
    }
  }

  /* ------------------------------------------------------------
     8. 상세 보기
     ------------------------------------------------------------ */
  function getPost(id) {
    return state.posts.filter(function (p) { return p.id === id; })[0] || null;
  }

  function openDetail(id) {
    var post = getPost(id);
    if (!post) return;
    var cat = CATEGORIES[post.category];
    if (!cat) return;

    state.detailId = id;

    var meta = cat.fields
      .filter(function (f) { return !f.full && f.key !== "severity" && post.fields && post.fields[f.key]; })
      .map(function (f) {
        return '<div class="meta-item"><dt>' + esc(f.label) + "</dt><dd>" + esc(post.fields[f.key]) + "</dd></div>";
      }).join("");

    var longFields = cat.fields.filter(function (f) {
      return f.full && post.fields && post.fields[f.key];
    });
    var longHtml = longFields.length
      ? '<div class="detail-fields">' + longFields.map(function (f) {
          return '<div class="field-block"><h4>' + esc(f.label) + "</h4><p>" + esc(post.fields[f.key]) + "</p></div>";
        }).join("") + "</div>"
      : "";

    var sev = post.category === "defect" && post.fields && post.fields.severity
      ? '<span class="sev sev-' + esc(post.fields.severity) + '">등급 ' + esc(post.fields.severity) + "</span>"
      : "";

    var rate = null;
    if (post.category === "result" && post.fields && post.fields.rate != null) {
      var parsed = parseFloat(String(post.fields.rate).replace(/[^0-9.\-]/g, ""));
      if (!isNaN(parsed)) rate = parsed;
    }
    var rateHtml = rate == null ? "" :
      '<div class="rate-wrap">' +
        '<div class="rate-head"><span>계획 대비 달성률</span><b>' + rate.toFixed(1) + '%</b></div>' +
        '<div class="rate-bar"><span style="width:' + Math.max(0, Math.min(100, rate)) + '%"></span></div>' +
      "</div>";

    var images = post.images || [];
    var galleryHtml = "";
    if (images.length) {
      galleryHtml =
        '<section class="detail-gallery">' +
          '<div class="gallery-head"><span>첨부 이미지</span><span>' + images.length + "장 · 클릭하면 크게 볼 수 있습니다</span></div>" +
          '<div class="gallery-grid">' +
            images.map(function (img, i) {
              return '<button type="button" class="gallery-item" style="position:relative" data-action="open-lightbox" data-post="' + esc(post.id) + '" data-index="' + i + '" aria-label="이미지 ' + (i + 1) + ' 크게 보기">' +
                '<img src="' + esc(img.url) + '" alt="' + esc(img.caption || "첨부 이미지 " + (i + 1)) + '" loading="lazy">' +
                '<span class="gallery-caption">' + esc(img.caption || "이미지 " + (i + 1)) + "</span>" +
                '<span class="gallery-zoom">확대</span>' +
              "</button>";
            }).join("") +
          "</div>" +
        "</section>";
    }

    var actions = state.role === "admin"
      ? '<div class="detail-actions">' +
          '<button type="button" class="btn btn-ghost" data-action="edit-post" data-id="' + esc(post.id) + '">수정</button>' +
          '<button type="button" class="btn btn-danger" data-action="delete-post" data-id="' + esc(post.id) + '">삭제</button>' +
        "</div>"
      : "";

    var updatedLine = post.updatedAt && post.updatedAt !== post.createdAt
      ? '<span class="sep">·</span><span>수정 ' + esc(fmtDateTime(post.updatedAt)) + "</span>"
      : "";

    $("#detailBody").innerHTML =
      '<div class="detail-head">' +
        '<span class="chip ' + cat.chip + '">' + esc(cat.label) + "</span> " + sev +
        '<h2 class="detail-title" id="detailTitle">' + esc(post.title) + "</h2>" +
        '<div class="detail-sub">' +
          "<span>" + esc(post.author || "—") + "</span>" +
          '<span class="sep">·</span><span>작성 ' + esc(fmtDateTime(post.createdAt)) + "</span>" +
          updatedLine +
        "</div>" +
      "</div>" +
      (meta ? '<dl class="meta-table">' + meta + "</dl>" : "") +
      longHtml +
      rateHtml +
      (post.content ? '<div class="detail-body">' + esc(post.content) + "</div>" : "") +
      galleryHtml +
      actions;

    openModal("detailModal");
  }

  /* ------------------------------------------------------------
     9. 글쓰기 / 수정
     ------------------------------------------------------------ */
  function fieldControl(field, value) {
    var id = "meta-" + field.key;
    var common = ' id="' + id + '" data-field="' + esc(field.key) + '"';
    var placeholder = field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : "";

    if (field.type === "textarea") {
      return "<textarea" + common + ' rows="2"' + placeholder + ">" + esc(value) + "</textarea>";
    }
    if (field.type === "select") {
      var opts = (field.options || []).map(function (o) {
        return '<option value="' + esc(o) + '"' + (String(value) === String(o) ? " selected" : "") + ">" + esc(o) + "등급</option>";
      }).join("");
      return "<select" + common + ">" + opts + "</select>";
    }
    var type = field.type === "date" ? "date" : "text";
    return '<input type="' + type + '"' + common + ' value="' + esc(value) + '"' + placeholder + ">";
  }

  function renderMetaFields(categoryId, values) {
    var cat = CATEGORIES[categoryId];
    values = values || {};
    $("#metaFields").innerHTML = cat.fields.map(function (f) {
      var value = values[f.key];
      if (value == null) value = f.type === "date" ? todayInput() : "";
      return (
        '<div class="form-field' + (f.full ? " full" : "") + '">' +
          '<label class="field-label" for="meta-' + esc(f.key) + '">' + esc(f.label) +
            (f.required ? ' <span class="req">*</span>' : "") + "</label>" +
          fieldControl(f, value) +
        "</div>"
      );
    }).join("");
  }

  function openEditor(id) {
    var post = id ? getPost(id) : null;
    state.editingId = post ? post.id : null;
    state.draftImages = post && post.images ? post.images.map(function (i) { return Object.assign({}, i); }) : [];

    $("#editorTitle").textContent = post ? "기록 수정" : "새 기록 작성";
    $("#editorSub").textContent = post
      ? "내용을 고친 뒤 저장하면 수정 이력이 남습니다."
      : "카테고리를 고르면 입력 항목이 바뀝니다.";

    $("#postCategory").value = post ? post.category : (state.filter !== "all" ? state.filter : "plan");
    $("#postTitle").value = post ? post.title : "";
    $("#postContent").value = post ? post.content || "" : "";
    $("#postAuthor").value = post ? post.author || "" : CFG.defaultAuthor;

    renderMetaFields($("#postCategory").value, post ? post.fields : {});
    renderImagePreview();
    setEditorError("");
    updateContentCount();

    openModal("editorModal");
    setTimeout(function () { $("#postTitle").focus(); }, 80);
  }

  function setEditorError(message) {
    var el = $("#editorError");
    el.textContent = message || "";
    el.hidden = !message;
  }

  function updateContentCount() {
    var len = $("#postContent").value.length;
    $("#contentCount").textContent = len;
  }

  function renderImagePreview() {
    var wrap = $("#imagePreview");
    var max = CFG.upload.maxFiles;
    $("#maxFilesLabel").textContent = max;

    if (!state.draftImages.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = state.draftImages.map(function (img, i) {
      return (
        '<div class="preview-item' + (i === 0 ? " is-cover" : "") + '">' +
          '<div class="preview-thumb">' +
            '<img src="' + esc(img.url) + '" alt="">' +
            (i === 0 ? '<span class="cover-tag">대표</span>' : "") +
            '<button type="button" class="remove" data-action="remove-draft-image" data-index="' + i + '" aria-label="이미지 삭제">×</button>' +
          "</div>" +
          '<input class="caption" type="text" maxlength="60" data-action="caption-input" data-index="' + i + '"' +
            ' value="' + esc(img.caption || "") + '" placeholder="설명 (선택)" aria-label="이미지 설명">' +
        "</div>"
      );
    }).join("");
  }

  function handleFiles(fileList) {
    if (state.role !== "admin") return;
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var remain = CFG.upload.maxFiles - state.draftImages.length;
    if (remain <= 0) {
      toast("이미지는 최대 " + CFG.upload.maxFiles + "장까지 첨부할 수 있습니다.", "error");
      return;
    }
    var take = files.slice(0, remain);
    if (take.length < files.length) {
      toast("이미지는 최대 " + CFG.upload.maxFiles + "장까지 첨부됩니다.", "error");
    }

    state.uploading = true;
    $("#saveBtn").disabled = true;
    var hint = $("#uploadHint");
    var done = 0;
    hint.textContent = "처리 중… 0/" + take.length;

    var chain = Promise.resolve();
    take.forEach(function (file) {
      chain = chain.then(function () {
        return Store.uploadImage(file).then(function (result) {
          state.draftImages.push({
            url: result.url,
            name: result.name || file.name,
            caption: "",
          });
          done++;
          hint.textContent = "처리 중… " + done + "/" + take.length;
          renderImagePreview();
        }).catch(function (err) {
          done++;
          toast(err.message || "이미지를 추가하지 못했습니다.", "error");
        });
      });
    });

    chain.then(function () {
      state.uploading = false;
      $("#saveBtn").disabled = false;
      hint.textContent = state.draftImages.length + " / " + CFG.upload.maxFiles + "장";
    });
  }

  function collectFields() {
    var fields = {};
    $$("#metaFields [data-field]").forEach(function (el) {
      fields[el.getAttribute("data-field")] = el.value.trim();
    });
    return fields;
  }

  function handleEditorSubmit(event) {
    event.preventDefault();
    if (state.uploading) {
      setEditorError("이미지를 처리하는 중입니다. 잠시 후 다시 저장해 주세요.");
      return;
    }

    var category = $("#postCategory").value;
    var cat = CATEGORIES[category];
    var title = $("#postTitle").value.trim();
    var content = $("#postContent").value.trim();
    var author = $("#postAuthor").value.trim() || CFG.defaultAuthor;
    var fields = collectFields();

    if (!title) {
      setEditorError("제목을 입력해 주세요.");
      $("#postTitle").focus();
      return;
    }

    var missing = cat.fields.filter(function (f) {
      return f.required && !fields[f.key];
    });
    if (missing.length) {
      setEditorError(missing[0].label + "을(를) 입력해 주세요.");
      var el = document.getElementById("meta-" + missing[0].key);
      if (el) el.focus();
      return;
    }

    var existing = state.editingId ? getPost(state.editingId) : null;
    var now = new Date().toISOString();
    var post = {
      id: existing ? existing.id : uid(),
      category: category,
      title: title,
      content: content,
      fields: fields,
      images: state.draftImages.map(function (img) {
        return { url: img.url, caption: img.caption || "", name: img.name || "" };
      }),
      author: author,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    var btn = $("#saveBtn");
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "저장 중…";
    setEditorError("");

    var request = existing ? Store.update(post) : Store.create(post);

    request.then(function () {
      return Store.list();
    }).then(function (posts) {
      state.posts = posts || [];
      state.lastSavedId = post.id;
      closeModal("editorModal");
      applyRole();
      renderStats();
      renderTabs();
      renderList();
      toast(existing ? "기록을 수정했습니다." : "새 기록을 등록했습니다.");
      setTimeout(function () { state.lastSavedId = null; }, 2500);
    }).catch(function (err) {
      console.error(err);
      setEditorError(err.message || "저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = original;
    });
  }

  /* ------------------------------------------------------------
     10. 삭제
     ------------------------------------------------------------ */
  function askDelete(id) {
    var post = getPost(id);
    if (!post) return;
    state.pendingDeleteId = id;
    $("#confirmDesc").textContent = '"' + post.title + '" 기록을 삭제합니다. 삭제 후에는 되돌릴 수 없습니다.';
    openModal("confirmModal");
  }

  function handleDelete() {
    var id = state.pendingDeleteId;
    if (!id) return;
    var btn = $("#confirmDeleteBtn");
    btn.disabled = true;
    btn.textContent = "삭제 중…";

    Store.remove(id)
      .then(function () { return Store.list(); })
      .then(function (posts) {
        state.posts = posts || [];
        if (state.detailId === id) closeModal("detailModal");
        closeModal("confirmModal");
        state.pendingDeleteId = null;
        renderAll();
        toast("기록을 삭제했습니다.");
      })
      .catch(function (err) {
        console.error(err);
        toast(err.message || "삭제하지 못했습니다.", "error");
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "삭제";
      });
  }

  /* ------------------------------------------------------------
     11. 라이트박스
     ------------------------------------------------------------ */
  function openLightbox(postId, index) {
    var post = getPost(postId);
    if (!post || !post.images || !post.images.length) return;
    state.lightbox.images = post.images;
    state.lightbox.index = Math.max(0, Math.min(post.images.length - 1, index || 0));
    renderLightbox();
    $("#lightbox").hidden = false;
    document.body.classList.add("is-locked");
  }

  function renderLightbox() {
    var images = state.lightbox.images;
    var i = state.lightbox.index;
    var img = images[i];
    if (!img) return;
    $("#lightboxImg").src = img.url;
    $("#lightboxImg").alt = img.caption || "첨부 이미지";
    $("#lightboxCaption").textContent = img.caption || "";
    $("#lightboxCounter").textContent = (i + 1) + " / " + images.length;
    var prev = $('[data-action="lightbox-prev"]');
    var next = $('[data-action="lightbox-next"]');
    prev.disabled = i === 0;
    next.disabled = i === images.length - 1;
    prev.style.visibility = images.length > 1 ? "visible" : "hidden";
    next.style.visibility = images.length > 1 ? "visible" : "hidden";
  }

  function stepLightbox(delta) {
    var images = state.lightbox.images;
    var next = state.lightbox.index + delta;
    if (next < 0 || next >= images.length) return;
    state.lightbox.index = next;
    renderLightbox();
  }

  function closeLightbox() {
    $("#lightbox").hidden = true;
    $("#lightboxImg").src = "";
    if (!$(".modal:not([hidden])")) document.body.classList.remove("is-locked");
  }

  /* ------------------------------------------------------------
     12. 모달 / 토스트
     ------------------------------------------------------------ */
  function openModal(id) {
    state.lastFocused = document.activeElement;
    $("#" + id).hidden = false;
    document.body.classList.add("is-locked");
  }

  function closeModal(id) {
    var modal = $("#" + id);
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    if (id === "detailModal") state.detailId = null;
    if (id === "editorModal") state.editingId = null;
    if (!$(".modal:not([hidden])") && $("#lightbox").hidden) {
      document.body.classList.remove("is-locked");
    }
    if (state.lastFocused && typeof state.lastFocused.focus === "function") {
      try { state.lastFocused.focus(); } catch (err) { /* ignore */ }
    }
  }

  function closeAllModals() {
    $$(".modal").forEach(function (m) { m.hidden = true; });
    $("#lightbox").hidden = true;
    state.detailId = null;
    state.editingId = null;
    state.pendingDeleteId = null;
  }

  function topModal() {
    if (!$("#lightbox").hidden) return $("#lightbox");
    var open = $$(".modal").filter(function (m) { return !m.hidden; });
    return open.length ? open[open.length - 1] : null;
  }

  function toast(message, kind) {
    var el = $("#toast");
    el.textContent = message;
    el.className = "toast" + (kind === "error" ? " is-error" : "");
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add("is-show");
    clearTimeout(TOAST_TIMER);
    TOAST_TIMER = setTimeout(function () {
      el.classList.remove("is-show");
      setTimeout(function () { el.hidden = true; }, 220);
    }, kind === "error" ? 4200 : 2600);
  }

  /* ------------------------------------------------------------
     13. 이벤트
     ------------------------------------------------------------ */
  /* ------------------------------------------------------------
     12-b. 트리 메뉴 (헤더 상단 내비게이션)
     ------------------------------------------------------------ */
  function navItems() { return $$(".nav-item.has-sub"); }

  function closeNavSubs(except) {
    navItems().forEach(function (item) {
      if (item === except) return;
      item.classList.remove("is-open");
      var link = $(".nav-link", item);
      if (link) link.setAttribute("aria-expanded", "false");
    });
  }

  function setNavOpen(open) {
    var header = $("#siteHeader");
    var toggle = $("#navToggle");
    if (!header) return;
    header.classList.toggle("nav-open", !!open);
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) closeNavSubs();
  }

  function isDesktopNav() {
    return window.matchMedia ? window.matchMedia("(min-width: 901px)").matches : true;
  }

  function setFilter(filter) {
    if (filter !== "all" && !CATEGORIES[filter]) return;
    state.filter = filter;
    renderTabs();
    renderList();
    setNavOpen(false);

    /* 모바일에서는 메뉴를 닫고 목록 위치로 이동 */
    if (!isDesktopNav()) {
      var target = $(".list-section");
      if (target) {
        var y = target.getBoundingClientRect().top + (window.pageYOffset || 0) - 72;
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
      }
    }
  }

  function bindEvents() {
    $("#gateForm").addEventListener("submit", handleGateSubmit);
    $("#adminForm").addEventListener("submit", handleAdminSubmit);
    $("#editorForm").addEventListener("submit", handleEditorSubmit);
    $("#confirmDeleteBtn").addEventListener("click", handleDelete);

    document.addEventListener("click", function (event) {
      var trigger = event.target.closest("[data-action]");
      if (!trigger) return;

      var action = trigger.getAttribute("data-action");

      switch (action) {
        case "toggle-pw": {
          var target = document.getElementById(trigger.getAttribute("data-target"));
          if (!target) return;
          var showing = target.type === "text";
          target.type = showing ? "password" : "text";
          trigger.textContent = showing ? "보기" : "숨기기";
          target.focus();
          return;
        }
        case "open-admin-login": {
          var err = $("#adminError");
          err.hidden = true;
          $("#adminPassword").value = "";
          openModal("adminLoginModal");
          setTimeout(function () { $("#adminPassword").focus(); }, 80);
          return;
        }
        case "close-modal": {
          event.preventDefault();
          var modalId = trigger.getAttribute("data-modal");
          if (modalId) closeModal(modalId);
          return;
        }
        case "new-post": {
          event.preventDefault();
          if (state.role !== "admin") {
            toast("관리자 로그인 후 작성할 수 있습니다.", "error");
            return;
          }
          openEditor(null);
          return;
        }
        case "open-post": {
          openDetail(trigger.getAttribute("data-id"));
          return;
        }
        case "edit-post": {
          event.preventDefault();
          event.stopPropagation();
          if (state.role !== "admin") return;
          var id = trigger.getAttribute("data-id");
          if ($("#detailModal").hidden === false) closeModal("detailModal");
          openEditor(id);
          return;
        }
        case "delete-post": {
          event.preventDefault();
          event.stopPropagation();
          if (state.role !== "admin") return;
          askDelete(trigger.getAttribute("data-id"));
          return;
        }
        case "logout": {
          try { sessionStorage.removeItem(CFG.storage.sessionKey); } catch (e) { /* ignore */ }
          state.role = "team";
          state.query = "";
          $("#searchInput").value = "";
          state.filter = "all";
          showGate();
          return;
        }
        case "go-home": {
          event.preventDefault();
          setNavOpen(false);
          state.filter = "all";
          state.query = "";
          $("#searchInput").value = "";
          renderAll();
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        case "clear-search": {
          $("#searchInput").value = "";
          state.query = "";
          renderList();
          $("#searchInput").focus();
          return;
        }
        case "remove-draft-image": {
          var idx = parseInt(trigger.getAttribute("data-index"), 10);
          state.draftImages.splice(idx, 1);
          renderImagePreview();
          return;
        }
        case "open-lightbox": {
          openLightbox(trigger.getAttribute("data-post"), parseInt(trigger.getAttribute("data-index"), 10) || 0);
          return;
        }
        case "lightbox-close": {
          closeLightbox();
          return;
        }
        case "lightbox-prev": {
          stepLightbox(-1);
          return;
        }
        case "lightbox-next": {
          stepLightbox(1);
          return;
        }
        default:
          return;
      }
    });

    /* 트리 메뉴 */
    var header = $("#siteHeader");
    var navToggle = $("#navToggle");

    if (navToggle && header) {
      navToggle.addEventListener("click", function (event) {
        event.stopPropagation();
        setNavOpen(!header.classList.contains("nav-open"));
      });
    }

    navItems().forEach(function (item) {
      var link = $(".nav-link", item);
      if (!link) return;

      link.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var canHover = window.matchMedia && window.matchMedia("(hover: hover)").matches;
        /* 마우스 환경에서는 항상 열기만, 터치 환경에서는 열고 닫기 토글 */
        var willOpen = canHover && isDesktopNav() ? true : !item.classList.contains("is-open");
        closeNavSubs(item);
        item.classList.toggle("is-open", willOpen);
        link.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });

      /* 데스크톱: 마우스를 올리면 열리고, 벗어나면 닫힌다 (클릭도 동일하게 토글) */
      item.addEventListener("mouseenter", function () {
        if (!isDesktopNav()) return;
        if (window.matchMedia && !window.matchMedia("(hover: hover)").matches) return;
        closeNavSubs(item);
        item.classList.add("is-open");
        link.setAttribute("aria-expanded", "true");
      });
      item.addEventListener("mouseleave", function () {
        if (!isDesktopNav()) return;
        if (window.matchMedia && !window.matchMedia("(hover: hover)").matches) return;
        item.classList.remove("is-open");
        link.setAttribute("aria-expanded", "false");
      });
    });

    /* 필터 칩 · 트리 하위 메뉴 · 전체 메뉴 */
    document.addEventListener("click", function (event) {
      var el = event.target;
      if (!el || !el.closest) return;

      if (el.closest(".nav-item.has-sub > .nav-link")) return;

      var filterBtn = el.closest(".filter-chip[data-filter], .nav-sub [data-filter], .nav-link[data-filter]");
      if (filterBtn) {
        setFilter(filterBtn.getAttribute("data-filter"));
        return;
      }

      if (el.closest("#siteNav") || el.closest("#navToggle")) return;
      closeNavSubs();
      if (!isDesktopNav()) setNavOpen(false);
    });

    /* 검색 */
    var onSearch = debounce(function () {
      state.query = $("#searchInput").value;
      var clear = $(".search-clear");
      if (clear) clear.hidden = !state.query;
      renderList();
    }, 140);
    $("#searchInput").addEventListener("input", onSearch);

    /* 정렬 */
    $("#sortSelect").addEventListener("change", function () {
      state.sort = this.value;
      renderList();
    });

    /* 카테고리 변경 → 입력 항목 전환 */
    $("#postCategory").addEventListener("change", function () {
      renderMetaFields(this.value, {});
    });

    /* 내용 글자 수 */
    $("#postContent").addEventListener("input", updateContentCount);

    /* 이미지 선택 */
    var input = $("#imageInput");
    var drop = $("#dropZone");

    drop.addEventListener("click", function () { input.click(); });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", function () {
      handleFiles(input.files);
      input.value = "";
    });

    ["dragenter", "dragover"].forEach(function (type) {
      drop.addEventListener(type, function (e) {
        e.preventDefault();
        drop.classList.add("is-drag");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      drop.addEventListener(type, function (e) {
        e.preventDefault();
        if (type === "dragleave" && e.target !== drop) return;
        drop.classList.remove("is-drag");
      });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });

    /* 이미지 설명 입력 */
    $("#imagePreview").addEventListener("input", function (e) {
      var el = e.target.closest('[data-action="caption-input"]');
      if (!el) return;
      var i = parseInt(el.getAttribute("data-index"), 10);
      if (state.draftImages[i]) state.draftImages[i].caption = el.value;
    });

    /* 카드 키보드 접근 */
    document.addEventListener("keydown", function (e) {
      var card = e.target.closest && e.target.closest(".post-card");
      if (card && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openDetail(card.getAttribute("data-id"));
        return;
      }

      if (e.key === "Escape") {
        if (!$("#lightbox").hidden) { closeLightbox(); return; }
        var modal = topModal();
        if (modal) {
          closeModal(modal.id || "");
          return;
        }
        if ($("#siteHeader") && $("#siteHeader").classList.contains("nav-open")) setNavOpen(false);
        closeNavSubs();
        return;
      }

      if (!$("#lightbox").hidden) {
        if (e.key === "ArrowLeft") { stepLightbox(-1); return; }
        if (e.key === "ArrowRight") { stepLightbox(1); return; }
      }

      /* '/' → 검색 포커스 */
      if (e.key === "/" && $("#app").hidden === false && !topModal()) {
        var active = document.activeElement;
        var typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
        if (!typing) {
          e.preventDefault();
          $("#searchInput").focus();
        }
      }
    });
  }

  /* ------------------------------------------------------------
     14. 시작
     ------------------------------------------------------------ */
  function boot() {
    document.title = CFG.company.name + " · " + CFG.company.siteTitle;

    $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
    applyRole();
    bindEvents();

    var saved = null;
    try { saved = sessionStorage.getItem(CFG.storage.sessionKey); } catch (err) { /* ignore */ }

    if (saved === "team" || saved === "admin") {
      unlock(saved);
    } else {
      showGate();
    }

    if (Store.mode === "supabase") {
      console.info("[전우정밀] Supabase 모드로 연결되었습니다:", CFG.supabase.url);
    } else {
      console.info("[전우정밀] 데모 모드(localStorage)로 실행 중입니다. config.js에 Supabase 정보를 넣으면 공유 저장소로 전환됩니다.");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);

  /* 테스트/디버깅용 (필요 없으면 지워도 됩니다) */
  window.JEONWOO_APP = { state: state, Store: Store, CFG: CFG, openEditor: openEditor, openDetail: openDetail };
})();
