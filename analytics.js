/* ============================================================
   전우정밀 생산 이력 공유 포털 — analytics.js
   엑셀(.xlsx/.xls/.csv) 업로드·자동 파싱 + 설비별 차트/요약표
   · 주차별_생산요약 → 생산계획_통제 → 생산실적 순으로 자동 인식
   · 파싱 결과는 localStorage 에 보관, '샘플 데이터로 되돌리기' 가능
   ============================================================ */
(function () {
  "use strict";

  var CFG_KEY = "jeonwoo.portal.excel.v1";
  var SCHEMA = 1;

  var COLORS = {
    plan: "#b9ccf8",
    planLine: "#93aeee",
    good: "#1f4ed8",
    rate: "#0e9f7a",
    defect: "#dc2626",
    product: "#7c3aed",
    material: "#0f766e",
    sample: "rgba(124, 58, 237, .28)",
    sampleMaterial: "rgba(15, 118, 110, .26)",
    grid: "#eef1f7",
    axis: "#8b98ab",
  };

  /* ------------------------------------------------------------
     0. 공통 유틸
     ------------------------------------------------------------ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function num(v) {
    if (v == null) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var s = String(v).replace(/,/g, "").replace(/[^\d.\-]/g, "");
    if (s === "" || s === "-" || s === ".") return 0;
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function fmtNum(n, dec) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("ko-KR", {
      minimumFractionDigits: dec || 0,
      maximumFractionDigits: dec == null ? 0 : dec,
    });
  }
  function fmtPct(n, dec) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toFixed(dec == null ? 1 : dec) + "%";
  }
  function trimZero(s) { return String(s).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1"); }

  function axisNum(v) {
    var a = Math.abs(v);
    if (a === 0) return "0";
    if (a >= 10000) return trimZero((v / 10000).toFixed(a >= 100000 ? 0 : 1)) + "만";
    return String(Math.round(v));
  }

  function fmtDateTime(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function wrapLabel(name) {
    var t = String(name || "").split(/\s+/).filter(Boolean);
    if (t.length >= 3) return [t[0], t[1], t.slice(2).join(" ")];
    if (t.length === 2) {
      if (t[1].length <= 6) return [t[0], t[1]];
      var m = t[1].match(/^(\D+)(\d.*)$/);
      return m ? [t[0], m[1], m[2]] : [t[0], t[1]];
    }
    var s = t[0] || "";
    if (s.length <= 8) return [s];
    var mid = Math.ceil(s.length / 2);
    return [s.slice(0, mid), s.slice(mid)];
  }

  function shortName(name) {
    return String(name == null ? "" : name)
      .replace(/^■\s*/, "")
      .replace(/대형\s*/g, "")
      .replace(/트렌스퍼|트랜스퍼/g, "트랜스퍼")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toast(msg, kind) {
    var app = window.JEONWOO_APP;
    if (app && typeof app.toast === "function") { app.toast(msg, kind); return; }
    if (kind === "error") console.warn("[전우정밀]", msg);
  }

  /* ------------------------------------------------------------
     1. 엑셀 파서
     ------------------------------------------------------------ */
  function txt(v) {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).replace(/\u00a0/g, " ").trim();
  }

  function matrix(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  }

  function sheetRows(ws) {
    var mx = matrix(ws);
    var width = 0;
    mx.forEach(function (r) { if (r && r.length > width) width = r.length; });
    return { rows: mx, width: width };
  }

  function cell(row, i) { return row && i >= 0 ? row[i] : null; }

  function normRate(v, plan, good) {
    if (typeof v === "number" && isFinite(v)) {
      if (v > 0) return round1(v <= 1.5 ? v * 100 : v);
    } else if (typeof v === "string") {
      var hasPct = v.indexOf("%") >= 0;
      var n = num(v);
      if (n > 0) return round1(hasPct ? n : (n <= 1.5 ? n * 100 : n));
    }
    if (plan > 0) return round1((good / plan) * 100);
    return null;
  }

  function totalsOfWeeks(weeks) {
    var plan = 0, good = 0, defect = 0;
    weeks.forEach(function (w) {
      plan += w[0] || 0; good += w[1] || 0; defect += w[2] || 0;
    });
    /* 주차별 과부족은 누적치이므로 합산하지 않고 계획 − 양품으로 계산한다 */
    return [plan, good, defect, plan > 0 ? round1((good / plan) * 100) : null, plan - good];
  }

  function detectPeriod(wb, hintMonth) {
    var counts = {};
    function add(y, m) {
      if (!y || !m || m < 1 || m > 12) return;
      var k = y + "-" + (m < 10 ? "0" + m : m);
      counts[k] = (counts[k] || 0) + 1;
    }
    wb.SheetNames.forEach(function (name) {
      var ws = wb.Sheets[name];
      if (!ws || !ws["!ref"]) return;
      var r = XLSX.utils.decode_range(ws["!ref"]);
      var maxR = Math.min(r.e.r, r.s.r + 40);
      var maxC = Math.min(r.e.c, r.s.c + 40);
      for (var R = r.s.r; R <= maxR; R++) {
        for (var C = r.s.c; C <= maxC; C++) {
          var cellObj = ws[XLSX.utils.encode_cell({ r: R, c: C })];
          if (!cellObj) continue;
          if (cellObj.t === "d" && cellObj.v instanceof Date) add(cellObj.v.getFullYear(), cellObj.v.getMonth() + 1);
          else if (cellObj.t === "s") {
            var m = String(cellObj.v).match(/^(\d{4})\s*[-\/.]\s*(\d{1,2})/);
            if (m) add(parseInt(m[1], 10), parseInt(m[2], 10));
          }
        }
      }
    });

    var best = null, bestCount = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestCount) { best = k; bestCount = counts[k]; }
    });
    if (best) return best;

    if (hintMonth) {
      var now = new Date();
      var y = now.getFullYear();
      if (hintMonth > now.getMonth() + 2) y -= 1;
      return y + "-" + (hintMonth < 10 ? "0" + hintMonth : hintMonth);
    }
    return "";
  }

  function periodLabel(period) {
    var m = String(period || "").match(/^(\d{4})-(\d{2})$/);
    if (!m) return "";
    return m[1] + "년 " + parseInt(m[2], 10) + "월";
  }

  /* --- 1-a. 주차별_생산요약 (본선) --- */
  function parseWeeklySummary(wb) {
    var ordered = wb.SheetNames.slice().sort(function (a, b) {
      var sa = /주차별.*생산요약/.test(a) ? 0 : 1;
      var sb = /주차별.*생산요약/.test(b) ? 0 : 1;
      return sa - sb;
    });

    for (var si = 0; si < ordered.length; si++) {
      var ws = wb.Sheets[ordered[si]];
      if (!ws) continue;
      var packed = sheetRows(ws);
      var rows = packed.rows;
      var headerAt = -1, subAt = -1;

      for (var i = 0; i < Math.min(rows.length, 30); i++) {
        var row = rows[i] || [];
        var first = txt(row[0]);
        if (!/설비구분|설비명/.test(first)) continue;
        var next = rows[i + 1] || [];
        var hasPlan = next.some(function (c) { return /^계획량$/.test(txt(c)); });
        if (!hasPlan) continue;
        headerAt = i; subAt = i + 1;
        break;
      }
      if (headerAt < 0) continue;

      var header = rows[headerAt];
      var sub = rows[subAt];
      var buckets = [];
      var current = null;
      var colMap = {};

      for (var j = 0; j < packed.width; j++) {
        var h = txt(cell(header, j));
        if (h) {
          var wm = h.match(/(\d+)\s*주차/);
          if (wm) {
            var rm = h.match(/(\d{1,2}\s*\/\s*\d{1,2})\s*[~∼\-]\s*(\d{1,2}\s*\/\s*\d{1,2})/);
            current = {
              kind: "week",
              label: wm[1] + "주차",
              range: rm ? rm[1].replace(/\s+/g, "") + "~" + rm[2].replace(/\s+/g, "") : "",
              map: {},
            };
            buckets.push(current);
          } else if (/누적|총계|합계/.test(h)) {
            current = { kind: "total", label: "누적", range: "", map: {} };
            buckets.push(current);
          }
        }
        var s = txt(cell(sub, j));
        if (current && s) {
          if (/^계획량/.test(s)) current.map.plan = j;
          else if (/^양품실적/.test(s)) current.map.good = j;
          else if (/^불량수량/.test(s)) current.map.defect = j;
          else if (/^달성률/.test(s)) current.map.rate = j;
          else if (/^과부족/.test(s)) current.map.remain = j;
        }
      }

      var weekBuckets = buckets.filter(function (b) { return b.kind === "week"; });
      var totalBucket = buckets.filter(function (b) { return b.kind === "total"; })[0] || null;
      if (!weekBuckets.length) continue;
      var mapped = weekBuckets.filter(function (b) { return b.map.plan != null && b.map.good != null; });
      if (!mapped.length) continue;

      var machines = [];
      var totals = null;
      var hintMonth = null;

      for (var r = subAt + 1; r < rows.length; r++) {
        var drow = rows[r] || [];
        var name = txt(drow[0]);
        if (!name) continue;
        if (/^(합\s*계|총\s*계)$/.test(name)) continue;
        if (/^\*|^※/.test(name)) continue;

        var weeks = mapped.map(function (b) {
          var plan = num(cell(drow, b.map.plan));
          var good = num(cell(drow, b.map.good));
          var defect = num(cell(drow, b.map.defect));
          var remain = b.map.remain != null ? num(cell(drow, b.map.remain)) : plan - good;
          var rate = b.map.rate != null ? normRate(cell(drow, b.map.rate), plan, good) : normRate(null, plan, good);
          return [plan, good, defect, rate, remain];
        });
        var total = null;
        if (totalBucket) {
          var planT = num(cell(drow, totalBucket.map.plan));
          var goodT = num(cell(drow, totalBucket.map.good));
          var defectT = num(cell(drow, totalBucket.map.defect));
          var remainT = totalBucket.map.remain != null ? num(cell(drow, totalBucket.map.remain)) : planT - goodT;
          var rateT = totalBucket.map.rate != null
            ? normRate(cell(drow, totalBucket.map.rate), planT, goodT)
            : normRate(null, planT, goodT);
          if (planT || goodT || defectT) total = [planT, goodT, defectT, rateT, remainT];
        }

        var rec = {
          name: name,
          short: shortName(name),
          shift: txt(drow[1]),
          base: num(drow[2]),
          weeks: weeks,
          total: total,
          _raw: drow,
        };
        if (/^■/.test(name) || /설비별 총계|전체 라인/.test(name)) totals = rec;
        else machines.push(rec);
      }

      if (!machines.length) continue;

      /* 같은 설비명이 여러 행(품목별 상세)으로 나뉜 경우 합산 */
      var groups = {}, order = [];
      machines.forEach(function (m) {
        if (!groups[m.name]) { groups[m.name] = []; order.push(m.name); }
        groups[m.name].push(m);
      });
      machines = order.map(function (n) {
        var g = groups[n];
        if (g.length === 1) return g[0];
        var weeks = g[0].weeks.map(function () { return [0, 0, 0, 0, 0]; });
        var planT = 0, goodT = 0, defT = 0, remT = 0, hasT = false, base = 0;
        g.forEach(function (m) {
          m.weeks.forEach(function (w, wi) {
            weeks[wi][0] += w[0]; weeks[wi][1] += w[1]; weeks[wi][2] += w[2];
          });
          if (m.total) { planT += m.total[0]; goodT += m.total[1]; defT += m.total[2]; remT += m.total[4]; hasT = true; }
          if ((m.base || 0) > base) base = m.base;
        });
        weeks = weeks.map(function (w) {
          return [w[0], w[1], w[2], w[0] > 0 ? round1((w[1] / w[0]) * 100) : null, w[0] - w[1]];
        });
        return {
          name: g[0].name, short: g[0].short, shift: g[0].shift || "", base: base, weeks: weeks,
          total: hasT
            ? [planT, goodT, defT, planT > 0 ? round1((goodT / planT) * 100) : null, remT]
            : totalsOfWeeks(weeks),
        };
      });

      var totalPlan = machines.reduce(function (s, m) { return s + (m.total[0] || 0); }, 0);
      var totalGood = machines.reduce(function (s, m) { return s + (m.total[1] || 0); }, 0);
      if (!totalPlan && !totalGood) continue;

      var rangeText = weekBuckets.map(function (b) { return b.range; }).join(" ");
      var rm2 = rangeText.match(/(\d{1,2})\s*\/\s*\d{1,2}/);
      if (rm2) hintMonth = parseInt(rm2[1], 10);
      var period = detectPeriod(wb, hintMonth);

      if (!totals) {
        totals = {
          name: "설비별 총계",
          short: "전체 합계",
          shift: "",
          base: machines.reduce(function (s, m) { return s + (m.base || 0); }, 0),
          weeks: [],
          total: null,
        };
        var nWeeks = machines[0].weeks.length;
        for (var wi = 0; wi < nWeeks; wi++) {
          totals.weeks.push(totalsOfWeeks(machines.map(function (m) { return m.weeks[wi]; })));
        }
        totals.total = totalsOfWeeks(totals.weeks);
      } else {
        totals.total = totals.total || totalsOfWeeks(totals.weeks);
        totals.short = "전체 합계";
      }

      return {
        mode: "weekly",
        meta: {
          source: "upload",
          sheet: ordered[si],
          period: period,
          periodLabel: periodLabel(period),
          weeks: mapped.map(function (b) { return { label: b.label, range: b.range }; }),
          uploadedAt: new Date().toISOString(),
        },
        machines: machines,
        totals: totals,
      };
    }
    return null;
  }

  /* --- 1-b. 생산계획_통제 (일자별 → 주차 집계) --- */
  function dayOfCell(v, headerText) {
    if (v instanceof Date) return { month: v.getMonth() + 1, day: v.getDate() };
    var s = txt(v);
    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return { month: parseInt(iso[2], 10), day: parseInt(iso[3], 10) };
    var md = (headerText || s).match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (md) return { month: parseInt(md[1], 10), day: parseInt(md[2], 10) };
    return null;
  }

  function parseControlSheet(wb) {
    for (var si = 0; si < wb.SheetNames.length; si++) {
      var name = wb.SheetNames[si];
      var ws = wb.Sheets[name];
      if (!ws) continue;
      var packed = sheetRows(ws);
      var rows = packed.rows;
      var headerAt = -1;

      for (var i = 0; i < Math.min(rows.length, 20); i++) {
        var row = rows[i] || [];
        var joined = row.map(txt).join("|");
        if (/설비명|설비구분/.test(joined) && /구분/.test(joined) && /가동\s*형태/.test(joined)) {
          headerAt = i; break;
        }
      }
      if (headerAt < 0) continue;

      var header = rows[headerAt];
      var dayCols = [];
      for (var j = 4; j < packed.width; j++) {
        var hTxt = txt(cell(header, j));
        var day = dayOfCell(cell(header, j), hTxt);
        if (day) dayCols.push({ col: j, month: day.month, day: day.day });
      }
      if (dayCols.length < 3) continue;

      var bucketMap = {};
      dayCols.forEach(function (d) {
        var k = Math.floor((d.day - 1) / 7);
        if (!bucketMap[k]) bucketMap[k] = { key: k, days: [], cols: [] };
        bucketMap[k].days.push(d.day);
        bucketMap[k].cols.push(d);
      });
      var keys = Object.keys(bucketMap).map(Number).sort(function (a, b) { return a - b; });
      var buckets = keys.map(function (k, idx) {
        var b = bucketMap[k];
        var min = Math.min.apply(null, b.days);
        var max = Math.max.apply(null, b.days);
        var month = b.cols[0].month;
        return {
          label: (idx + 1) + "주차",
          range: month + "/" + (min < 10 ? "0" + min : min) + "~" + month + "/" + (max < 10 ? "0" + max : max),
          cols: b.cols,
        };
      });

      var machines = [];
      for (var r = headerAt + 1; r < rows.length; r++) {
        var drow = rows[r] || [];
        var mName = txt(drow[0]);
        var cType = txt(drow[2]);
        if (!mName || !/가동품명/.test(cType)) continue;
        if (/^■/.test(mName)) continue;

        var block = {};
        for (var k2 = 0; k2 < 6; k2++) {
          var brow = rows[r + k2] || [];
          var label = txt(brow[2]);
          if (!label) continue;
          if (/^계획수량/.test(label)) block.plan = brow;
          else if (/^양품실적/.test(label)) block.good = brow;
          else if (/^불량수량/.test(label)) block.defect = brow;
        }
        if (!block.plan) continue;

        var weeks = buckets.map(function (b) {
          var plan = 0, good = 0, defect = 0;
          b.cols.forEach(function (d) {
            plan += num(cell(block.plan, d.col));
            if (block.good) good += num(cell(block.good, d.col));
            if (block.defect) defect += num(cell(block.defect, d.col));
          });
          return [plan, good, defect, plan > 0 ? round1((good / plan) * 100) : null, plan - good];
        });

        machines.push({
          name: mName,
          short: shortName(mName),
          shift: txt(drow[1]),
          base: num(cell(block.plan, 3)),
          weeks: weeks,
          total: totalsOfWeeks(weeks),
        });
      }

      if (machines.length < 2) continue;

      var totals = {
        name: "설비별 총계",
        short: "전체 합계",
        shift: "",
        base: machines.reduce(function (s, m) { return s + (m.base || 0); }, 0),
        weeks: machines[0].weeks.map(function (_, wi) {
          return totalsOfWeeks(machines.map(function (m) { return m.weeks[wi]; }));
        }),
        total: null,
      };
      totals.total = totalsOfWeeks(totals.weeks);

      var period = detectPeriod(wb, dayCols[0].month);
      return {
        mode: "weekly",
        meta: {
          source: "upload",
          sheet: name,
          period: period,
          periodLabel: periodLabel(period),
          weeks: buckets.map(function (b) { return { label: b.label, range: b.range }; }),
          uploadedAt: new Date().toISOString(),
        },
        machines: machines,
        totals: totals,
      };
    }
    return null;
  }

  /* --- 1-c. 생산실적 원장 (실적만 집계) --- */
  function parseLedger(wb) {
    for (var si = 0; si < wb.SheetNames.length; si++) {
      var name = wb.SheetNames[si];
      var ws = wb.Sheets[name];
      if (!ws) continue;
      var packed = sheetRows(ws);
      var rows = packed.rows;
      var headerAt = -1;

      for (var i = 0; i < Math.min(rows.length, 15); i++) {
        var joined = (rows[i] || []).map(txt).join("|");
        if (/작업일/.test(joined) && /설비/.test(joined) && /(실적량|가동생산)/.test(joined)) { headerAt = i; break; }
      }
      if (headerAt < 0) continue;

      var header = rows[headerAt];
      var idx = { equip: -1, date: -1, good: -1, run: -1, defect: -1 };
      for (var j = 0; j < packed.width; j++) {
        var h = txt(cell(header, j));
        if (idx.equip < 0 && /^설비/.test(h)) idx.equip = j;
        else if (idx.date < 0 && /작업일/.test(h)) idx.date = j;
        else if (idx.good < 0 && /실적량/.test(h)) idx.good = j;
        else if (idx.run < 0 && /가동생산/.test(h)) idx.run = j;
        else if (idx.defect < 0 && /불량/.test(h)) idx.defect = j;
      }
      if (idx.equip < 0 || idx.date < 0) continue;

      var groups = {}, dates = [], periods = {};
      for (var r = headerAt + 1; r < rows.length; r++) {
        var drow = rows[r] || [];
        var equip = txt(cell(drow, idx.equip));
        if (!equip || /^\[?\s*합\s*계|^합계/.test(txt(cell(drow, 0)))) continue;
        if (/^■/.test(equip)) continue;
        var rawDate = cell(drow, idx.date);
        var d = rawDate instanceof Date ? rawDate : (function () {
          var m = txt(rawDate).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
          return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
        })();
        if (!d || isNaN(d.getTime())) continue;

        var good = idx.good >= 0 ? num(cell(drow, idx.good)) : 0;
        if (!good && idx.run >= 0) good = num(cell(drow, idx.run));
        var defect = idx.defect >= 0 ? num(cell(drow, idx.defect)) : 0;

        var k = Math.floor((d.getDate() - 1) / 7);
        var key = equip + "||" + k;
        if (!groups[key]) groups[key] = { equip: equip, k: k, good: 0, defect: 0, month: d.getMonth() + 1, days: [] };
        groups[key].good += good;
        groups[key].defect += defect;
        groups[key].days.push(d.getDate());
        dates.push(d);
        periods[d.getFullYear() + "-" + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1)] = 1;
      }

      if (!dates.length) continue;

      var maxWeek = Math.min(4, Math.max.apply(null, Object.keys(groups).map(function (k) { return groups[k].k; })));
      var weeksMeta = [];
      for (var k3 = 0; k3 <= maxWeek; k3++) {
        var days = Object.keys(groups).map(function (kk) { return groups[kk]; })
          .filter(function (g) { return g.k === k3; })
          .reduce(function (a, g) { return a.concat(g.days); }, []);
        if (!days.length) continue;
        var mn = Math.min.apply(null, days), mx = Math.max.apply(null, days);
        var bucketGroups = Object.keys(groups).map(function (kk) { return groups[kk]; }).filter(function (g) { return g.k === k3; });
        var mMonth = bucketGroups.length ? Math.min.apply(null, bucketGroups.map(function (g) { return g.month; })) : 1;
        weeksMeta.push({
          k: k3, label: (k3 + 1) + "주차",
          range: mMonth + "/" + (mn < 10 ? "0" + mn : mn) + "~" + mMonth + "/" + (mx < 10 ? "0" + mx : mx),
        });
      }

      var byEquip = {}, order = [];
      Object.keys(groups).forEach(function (key) {
        var g = groups[key];
        if (!byEquip[g.equip]) { byEquip[g.equip] = { name: g.equip, short: shortName(g.equip), shift: "", base: 0, weeks: weeksMeta.map(function () { return [0, 0, 0, null, 0]; }), total: null }; order.push(g.equip); }
        var pos = weeksMeta.map(function (w) { return w.k; }).indexOf(g.k);
        if (pos < 0) return;
        var m = byEquip[g.equip];
        m.weeks[pos][1] += g.good;
        m.weeks[pos][2] += g.defect;
        m.weeks[pos][4] = m.weeks[pos][0] - m.weeks[pos][1];
      });
      var machines = order.map(function (n) {
        var m = byEquip[n];
        m.total = totalsOfWeeks(m.weeks);
        return m;
      });
      machines.sort(function (a, b) { return (b.total[1] || 0) - (a.total[1] || 0); });

      var total = machines.reduce(function (acc, m) {
        acc[0] += m.total[0] || 0; acc[1] += m.total[1] || 0; acc[2] += m.total[2] || 0; acc[4] += m.total[4] || 0;
        return acc;
      }, [0, 0, 0, null, 0]);
      total[3] = total[0] > 0 ? round1((total[1] / total[0]) * 100) : null;
      var pKey = Object.keys(periods).sort()[0] || "";
      return {
        mode: "actuals",
        meta: {
          source: "upload",
          sheet: name,
          period: pKey,
          periodLabel: periodLabel(pKey),
          weeks: weeksMeta.map(function (w) { return { label: w.label, range: w.range }; }),
          uploadedAt: new Date().toISOString(),
          hasPlan: false,
        },
        machines: machines,
        totals: { name: "설비별 총계", short: "전체 합계", shift: "", base: 0, weeks: [], total: total },
      };
    }
    return null;
  }

  function parseWorkbook(buffer, fileName) {
    if (!window.XLSX) throw new Error("엑셀 라이브러리를 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
    var wb = XLSX.read(buffer, { type: "array", cellDates: true });
    var result = parseWeeklySummary(wb) || parseControlSheet(wb) || parseLedger(wb);
    if (!result) {
      throw new Error("생산 데이터를 찾지 못했습니다. 「주차별_생산요약」·「생산계획_통제」·「생산실적」 시트가 있는 파일인지 확인해 주세요.");
    }
    result.meta.fileName = fileName || "";
    result.meta.sheet = result.meta.sheet || "";
    return result;
  }

  /* ------------------------------------------------------------
     2. 저장 / 기본 데이터
     ------------------------------------------------------------ */
  function seedProduction() {
    var seed = (window.JEONWOO_SEED && window.JEONWOO_SEED.production) || null;
    if (!seed) return null;
    var copy = JSON.parse(JSON.stringify(seed));
    copy.mode = "weekly";
    copy.meta = {
      source: "seed",
      sheet: copy.sheet || "주차별_생산요약",
      period: copy.period,
      periodLabel: copy.periodLabel,
      weeks: copy.weeks,
      fileName: copy.fileName || "최종현재수정.xlsx",
      uploadedAt: "",
      hasPlan: true,
    };
    delete copy.sheet; delete copy.period; delete copy.periodLabel; delete copy.fileName; delete copy.seed;
    var nWeeks = (copy.meta.weeks || []).length;
    copy.machines.forEach(function (m) {
      if (nWeeks) m.weeks = m.weeks.slice(0, nWeeks);
      /* 샘플 파일의 달성률은 엑셀 원본처럼 0~1 소수이므로 %로 변환 */
      m.weeks = m.weeks.map(function (w) {
        var r = normRate(w[3], w[0], w[1]);
        return [w[0], w[1], w[2], r, w[4]];
      });
      if (m.total) m.total[3] = normRate(m.total[3], m.total[0], m.total[1]);
      m.total = m.total || totalsOfWeeks(m.weeks);
    });
    copy.totals.weeks = (copy.totals.weeks || []).slice(0, nWeeks || copy.totals.weeks.length);
    if (copy.totals.total) {
      copy.totals.total[3] = normRate(copy.totals.total[3], copy.totals.total[0], copy.totals.total[1]);
    }
    copy.totals.total = copy.totals.total || totalsOfWeeks(copy.totals.weeks);
    return copy;
  }

  var production = null;

  function isValid(ds) {
    return !!(ds && ds.machines && ds.machines.length && ds.meta && ds.meta.weeks);
  }

  function loadProduction() {
    var stored = null;
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.v === SCHEMA && isValid(parsed.data)) stored = parsed.data;
        else if (isValid(parsed)) stored = parsed;
      }
    } catch (err) { stored = null; }
    production = stored || seedProduction();
  }

  function saveProduction(ds) {
    try {
      if (ds && ds.meta && ds.meta.source === "upload") {
        localStorage.setItem(CFG_KEY, JSON.stringify({ v: SCHEMA, data: ds }));
      } else {
        localStorage.removeItem(CFG_KEY);
      }
    } catch (err) {
      toast("브라우저 저장 공간이 부족해 엑셀 데이터를 보관하지 못했습니다.", "error");
    }
  }

  /* ------------------------------------------------------------
     3. 화면 상태
     ------------------------------------------------------------ */
  var S = {
    filter: "all",
    role: "team",
    posts: [],
    charts: {},
    ready: false,
    parsing: false,
    libsWarned: false,
  };

  var dom = {};

  function cacheDom() {
    dom.root = $("#analytics");
    if (!dom.root) return false;
    dom.eyebrow = $("#anEyebrow");
    dom.title = $("#anTitle");
    dom.sub = $("#anSub");
    dom.sourceBadge = $("#anSourceBadge");
    dom.sourceText = $("#anSourceText");
    dom.sourceWrap = dom.sourceText ? dom.sourceText.closest(".an-source") : null;
    dom.viewProduction = $("#anProduction");
    dom.viewMonthly = $("#anMonthly");
    dom.viewDefect = $("#anDefect");
    dom.kpis = $("#anKpis");
    dom.periodTag = $("#anPeriodTag");
    dom.table = $("#anTable");
    dom.tableSub = $("#anTableSub");
    dom.xlPanel = $("#xlPanel");
    dom.xlDrop = $("#xlDrop");
    dom.xlInput = $("#xlInput");
    dom.xlStatus = $("#xlStatus");
    dom.xlReset = $("#xlReset");
    dom.xlTeamNote = $("#xlTeamNote");
    dom.monthlyKpis = $("#anMonthlyKpis");
    dom.monthlyTitle = $("#anMonthlyTitle");
    dom.monthlySub = $("#anMonthlySub");
    dom.monthlyNote = $("#anMonthlyNote");
    dom.monthlyTable = $("#anMonthlyTable");
    dom.defectKpis = $("#anDefectKpis");
    return true;
  }

  /* ------------------------------------------------------------
     4. 차트
     ------------------------------------------------------------ */
  function chartLib() {
    if (window.Chart) return window.Chart;
    if (!S.libsWarned) {
      S.libsWarned = true;
      $$(".chart-box").forEach(function (box) {
        if (!box.querySelector(".chart-fallback")) {
          var p = document.createElement("p");
          p.className = "chart-fallback";
          p.textContent = "차트 라이브러리를 불러오지 못했습니다. 표의 수치는 그대로 확인할 수 있습니다.";
          box.appendChild(p);
        }
      });
    }
    return null;
  }

  function destroyChart(id) {
    if (S.charts[id]) { try { S.charts[id].destroy(); } catch (e) { /* ignore */ } S.charts[id] = null; }
  }

  function canvasCtx(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    var ctx = el.getContext("2d");
    return ctx;
  }

  function baseOptions(extra) {
    var Chart = window.Chart;
    if (Chart) {
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.font.size = 11.5;
      Chart.defaults.color = COLORS.axis;
    }
    return Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 480 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: "rectRounded", padding: 14, color: "#46536b", font: { size: 11.5, weight: "600" } },
        },
      },
    }, extra || {});
  }

  function tooltipStyle() {
    return {
      backgroundColor: "rgba(8, 20, 40, .94)",
      titleColor: "#fff",
      bodyColor: "#e6ecf7",
      padding: 10,
      cornerRadius: 8,
      displayColors: true,
      boxPadding: 4,
      titleFont: { size: 12, weight: "700" },
      bodyFont: { size: 12 },
    };
  }

  function smallScreen() { return window.matchMedia ? window.matchMedia("(max-width: 720px)").matches : false; }

  function renderMachineChart() {
    var Chart = chartLib();
    if (!Chart || !production) return;
    destroyChart("machines");
    var ctx = canvasCtx("chartMachines");
    if (!ctx) return;

    var machines = production.machines;
    var hasPlan = production.mode !== "actuals" && production.meta.hasPlan !== false;
    var labels = machines.map(function (m) { return shortName(m.name); });
    var plans = machines.map(function (m) { return m.total[0] || 0; });
    var goods = machines.map(function (m) { return m.total[1] || 0; });
    var rates = machines.map(function (m) { return m.total[3]; });

    var datasets = [];
    if (hasPlan) {
      datasets.push({
        type: "bar", label: "계획량", data: plans,
        backgroundColor: COLORS.plan, borderColor: COLORS.planLine, borderWidth: 1,
        borderRadius: 4, maxBarThickness: 26, yAxisID: "y", order: 1,
      });
    }
    datasets.push({
      type: "bar", label: hasPlan ? "양품실적" : "양품실적(원장)", data: goods,
      backgroundColor: COLORS.good, hoverBackgroundColor: "#173bb0",
      borderRadius: 4, maxBarThickness: 26, yAxisID: "y", order: 1,
    });
    if (hasPlan) {
      datasets.push({
        type: "line", label: "달성률", data: rates,
        borderColor: COLORS.rate, backgroundColor: COLORS.rate,
        borderWidth: 2, tension: 0.32, pointRadius: 3, pointHoverRadius: 5,
        pointBackgroundColor: "#fff", pointBorderWidth: 2, spanGaps: true,
        yAxisID: "y1", order: 3,
      });
    }

    var mobile = smallScreen();
    var opts = baseOptions({
      plugins: {
        legend: Object.assign({}, baseOptions().plugins.legend, { display: !mobile }),
        tooltip: Object.assign(tooltipStyle(), {
          callbacks: {
            label: function (c) {
              if (c.dataset.yAxisID === "y1") {
                return " " + c.dataset.label + " " + (c.parsed.y == null ? "—" : c.parsed.y.toFixed(1) + "%");
              }
              return " " + c.dataset.label + " " + fmtNum(c.parsed.y) + " EA";
            },
          },
        }),
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0,
            callback: function (value) {
              var label = this.getLabelForValue ? this.getLabelForValue(value) : labels[value];
              return wrapLabel(label);
            },
            font: { size: mobile ? 8 : 9.5, weight: "600" },
            color: "#55637a",
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: COLORS.grid, drawTicks: false },
          border: { display: false },
          ticks: { callback: function (v) { return axisNum(v); }, padding: 6, font: { size: 10.5 } },
          title: { display: !mobile, text: "수량 (EA)", color: "#8b98ab", font: { size: 10.5, weight: "600" } },
        },
        y1: hasPlan ? {
          position: "right",
          beginAtZero: true,
          suggestedMax: 110,
          grid: { display: false },
          border: { display: false },
          ticks: { callback: function (v) { return v + "%"; }, font: { size: 10.5 }, padding: 4 },
          title: { display: false },
        } : { display: false },
      },
    });

    S.charts.machines = new Chart(ctx, { type: "bar", data: { labels: labels, datasets: datasets }, options: opts });
  }

  function renderWeeklyChart() {
    var Chart = chartLib();
    if (!Chart || !production) return;
    destroyChart("weekly");
    var ctx = canvasCtx("chartWeekly");
    if (!ctx) return;

    var weeks = production.meta.weeks || [];
    var labels = weeks.map(function (w) { return w.label + (w.range ? "\n" + w.range : ""); });
    var plan = [], good = [], defect = [];
    weeks.forEach(function (_, i) {
      var agg = [0, 0, 0];
      production.machines.forEach(function (m) {
        var w = m.weeks[i];
        if (!w) return;
        agg[0] += w[0] || 0; agg[1] += w[1] || 0; agg[2] += w[2] || 0;
      });
      plan.push(agg[0]); good.push(agg[1]); defect.push(agg[2]);
    });

    var hasPlan = production.mode !== "actuals" && production.meta.hasPlan !== false;
    var datasets = [];
    if (hasPlan) {
      datasets.push({ type: "bar", label: "계획량", data: plan, backgroundColor: COLORS.plan, borderColor: COLORS.planLine, borderWidth: 1, borderRadius: 5, maxBarThickness: 34, yAxisID: "y", order: 1 });
    }
    datasets.push({ type: "bar", label: "양품실적", data: good, backgroundColor: COLORS.good, borderRadius: 5, maxBarThickness: 34, yAxisID: "y", order: 1 });
    datasets.push({
      type: "line", label: "불량수량", data: defect, yAxisID: "y1",
      borderColor: COLORS.defect, backgroundColor: COLORS.defect,
      borderWidth: 2, tension: 0.3, pointRadius: 3, pointHoverRadius: 5,
      pointBackgroundColor: "#fff", pointBorderWidth: 2, order: 3,
    });

    var mobile = smallScreen();
    var opts = baseOptions({
      plugins: {
        legend: baseOptions().plugins.legend,
        tooltip: Object.assign(tooltipStyle(), {
          callbacks: {
            label: function (c) {
              if (c.dataset.yAxisID === "y1") return " " + c.dataset.label + " " + fmtNum(c.parsed.y) + " EA";
              return " " + c.dataset.label + " " + fmtNum(c.parsed.y) + " EA";
            },
          },
        }),
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: mobile ? 9.5 : 11, weight: "600" }, color: "#55637a",
            callback: function (val) {
              var w = weeks[val];
              if (!w) return "";
              return mobile ? w.label : [w.label, w.range];
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: COLORS.grid, drawTicks: false },
          border: { display: false },
          ticks: { callback: function (v) { return axisNum(v); }, font: { size: 10.5 }, padding: 6 },
        },
        y1: {
          position: "right",
          beginAtZero: true,
          grid: { display: false },
          border: { display: false },
          ticks: { callback: function (v) { return fmtNum(v); }, font: { size: 10 }, color: COLORS.defect, padding: 4 },
        },
      },
    });

    S.charts.weekly = new Chart(ctx, { type: "bar", data: { labels: labels, datasets: datasets }, options: opts });
  }

  /* ------------------------------------------------------------
     5. 생산 대시보드 (KPI · 표)
     ------------------------------------------------------------ */
  function productionSummary() {
    var machines = production.machines;
    var plan = 0, good = 0, defect = 0, remain = 0, base = 0;
    machines.forEach(function (m) {
      plan += m.total[0] || 0; good += m.total[1] || 0; defect += m.total[2] || 0; remain += m.total[4] || 0; base += m.base || 0;
    });
    var sheetTotal = production.totals && production.totals.total;
    if (sheetTotal && sheetTotal[0]) {
      plan = sheetTotal[0]; good = sheetTotal[1]; defect = sheetTotal[2];
      if (sheetTotal[4] != null) remain = sheetTotal[4];
    }
    var rate = plan > 0 ? (good / plan) * 100 : null;
    var defectRate = good + defect > 0 ? (defect / (good + defect)) * 100 : null;
    var best = null, worst = null;
    machines.forEach(function (m) {
      var r = m.total[3];
      if (r == null) return;
      if (!best || r > best.total[3]) best = m;
      if (!worst || r < worst.total[3]) worst = m;
    });
    return { plan: plan, good: good, defect: defect, remain: remain, base: base, rate: rate, defectRate: defectRate, best: best, worst: worst };
  }

  function kpiCard(opts) {
    return (
      '<div class="an-kpi' + (opts.tone ? " tone-" + opts.tone : "") + '">' +
        '<span class="an-kpi-label">' + esc(opts.label) + "</span>" +
        '<strong class="an-kpi-value">' + opts.value + "</strong>" +
        (opts.sub ? '<span class="an-kpi-sub">' + opts.sub + "</span>" : "") +
      "</div>"
    );
  }

  function renderProductionKpis() {
    var s = productionSummary();
    var html = "";
    if (production.mode === "actuals") {
      html += kpiCard({ label: "양품실적 합계", value: fmtNum(s.good) + ' <small>EA</small>', sub: production.meta.periodLabel + " · 원장 집계" });
      html += kpiCard({ label: "불량수량", value: fmtNum(s.defect) + ' <small>EA</small>', sub: "불량률 " + fmtPct(s.defectRate), tone: "defect" });
      html += kpiCard({ label: "가동 설비", value: production.machines.length + ' <small>대</small>', sub: "생산실적 원장 기준" });
      html += kpiCard({ label: "데이터 범위", value: esc(production.meta.periodLabel || "—"), sub: "주차 " + (production.meta.weeks || []).length + "구간" });
    } else {
      html += kpiCard({ label: "월 계획", value: fmtNum(s.plan) + ' <small>EA</small>', sub: s.base ? "기초·발주 " + fmtNum(s.base) + " EA" : "주차별 계획 합계" });
      html += kpiCard({ label: "양품실적", value: fmtNum(s.good) + ' <small>EA</small>', sub: "달성률 <b>" + fmtPct(s.rate) + "</b>", tone: "good" });
      html += kpiCard({ label: "불량수량", value: fmtNum(s.defect) + ' <small>EA</small>', sub: "불량률 " + fmtPct(s.defectRate, 2), tone: "defect" });
      html += kpiCard({
        label: "잔여 (과부족)",
        value: fmtNum(s.remain) + ' <small>EA</small>',
        sub: s.worst ? "최저 달성 " + esc(shortName(s.worst.name)) + " " + fmtPct(s.worst.total[3]) : "계획 − 양품실적",
        tone: "warn",
      });
    }
    dom.kpis.innerHTML = html;
  }

  function rateTone(r) {
    if (r == null) return "none";
    if (r >= 95) return "good";
    if (r >= 85) return "ok";
    if (r >= 60) return "warn";
    return "low";
  }

  function renderTable() {
    var machines = production.machines;
    var hasPlan = production.mode !== "actuals" && production.meta.hasPlan !== false;
    var tbody = dom.table.querySelector("tbody");
    var thead = dom.table.querySelector("thead");

    thead.innerHTML = hasPlan
      ? "<tr><th>설비</th><th>가동형태</th><th class=\"t-num\">발주량</th><th class=\"t-num\">계획</th><th class=\"t-num\">양품</th><th class=\"t-num\">불량</th><th>달성률</th><th class=\"t-num\">잔여</th></tr>"
      : "<tr><th>설비</th><th class=\"t-num\">양품실적</th><th class=\"t-num\">불량</th><th>불량률</th></tr>";

    var rows = machines.map(function (m) {
      var t = m.total;
      if (!hasPlan) {
        var dr = (t[1] + t[2]) > 0 ? (t[2] / (t[1] + t[2])) * 100 : null;
        return "<tr>" +
          '<td class="t-name"><span class="t-dot"></span>' + esc(m.name) + "</td>" +
          '<td class="t-num">' + fmtNum(t[1]) + "</td>" +
          '<td class="t-num">' + fmtNum(t[2]) + "</td>" +
          '<td><span class="rate-pill is-' + rateTone(dr) + '">' + fmtPct(dr, 2) + "</span></td>" +
        "</tr>";
      }
      var r = t[3];
      var tone = rateTone(r);
      var width = clamp(r || 0, 0, 100);
      return "<tr>" +
        '<td class="t-name"><span class="t-dot"></span>' + esc(m.name) + "</td>" +
        '<td class="t-muted">' + esc(m.shift || "—") + "</td>" +
        '<td class="t-num">' + fmtNum(m.base) + "</td>" +
        '<td class="t-num">' + fmtNum(t[0]) + "</td>" +
        '<td class="t-num">' + fmtNum(t[1]) + "</td>" +
        '<td class="t-num t-defect">' + fmtNum(t[2]) + "</td>" +
        '<td class="t-rate"><div class="t-rate-inner"><span class="rate-pill is-' + tone + '">' + fmtPct(r) + "</span>" +
          '<span class="rate-track"><i class="is-' + tone + '" style="width:' + width + '%"></i></span></div></td>' +
        '<td class="t-num">' + fmtNum(t[4]) + "</td>" +
      "</tr>";
    });

    if (hasPlan) {
      var tot = production.totals && production.totals.total ? production.totals.total : productionSummary();
      var tPlan = tot[0] || 0, tGood = tot[1] || 0, tDef = tot[2] || 0, tRate = tot[3], tRem = tot[4] || 0;
      var baseSum = machines.reduce(function (s2, m) { return s2 + (m.base || 0); }, 0);
      rows.push(
        '<tr class="t-total">' +
          '<td class="t-name">전체 합계</td>' +
          '<td class="t-muted">' + machines.length + "개 설비</td>" +
          '<td class="t-num">' + fmtNum(baseSum) + "</td>" +
          '<td class="t-num">' + fmtNum(tPlan) + "</td>" +
          '<td class="t-num">' + fmtNum(tGood) + "</td>" +
          '<td class="t-num t-defect">' + fmtNum(tDef) + "</td>" +
          '<td class="t-rate"><div class="t-rate-inner"><span class="rate-pill is-' + rateTone(tRate) + '">' + fmtPct(tRate) + "</span>" +
            '<span class="rate-track"><i class="is-' + rateTone(tRate) + '" style="width:' + clamp(tRate || 0, 0, 100) + '%"></i></span></div></td>' +
          '<td class="t-num">' + fmtNum(tRem) + "</td>" +
        "</tr>"
      );
    }

    tbody.innerHTML = rows.join("");
    dom.tableSub.textContent = (production.meta.periodLabel || "") + " · " + (production.meta.sheet || "") +
      (hasPlan ? " · 달성률 = 양품 ÷ 계획" : " · 생산실적 원장 집계");
  }

  /* ------------------------------------------------------------
     6. 월별(제품/소재) 추이
     ------------------------------------------------------------ */
  function monthKeyOf(post) {
    var f = post.fields || {};
    var raw = f.month || "";
    var m = String(raw).match(/(\d{4})\s*[.\-\/년\s]\s*(\d{1,2})/);
    if (m) return m[1] + "-" + (parseInt(m[2], 10) < 10 ? "0" + parseInt(m[2], 10) : parseInt(m[2], 10));
    var d = post.createdAt ? new Date(post.createdAt) : null;
    if (d && !isNaN(d.getTime())) return d.getFullYear() + "-" + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1);
    return "";
  }

  function firstNumber(v) {
    if (v == null) return null;
    var s = String(v).replace(/,/g, "");
    var m = s.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  function monthlyData(kind) {
    var seedMonthly = (window.JEONWOO_SEED && window.JEONWOO_SEED.monthly) || {};
    var samples = seedMonthly[kind] || [];
    var map = {};
    var posts = S.posts.filter(function (p) { return p.category === kind; });

    posts.forEach(function (p) {
      var key = monthKeyOf(p);
      if (!key) return;
      var q = firstNumber((p.fields || {}).quantity);
      if (q == null) return;
      if (!map[key]) map[key] = { month: key, value: 0, count: 0, sample: false, items: [] };
      map[key].value += q;
      map[key].count += 1;
      map[key].items.push({ title: p.title, quantity: (p.fields || {}).quantity || "" });
    });

    samples.forEach(function (s) {
      if (!s || !s.month) return;
      if (map[s.month]) return;
      map[s.month] = { month: s.month, value: s.quantity, count: 0, sample: true, items: [] };
    });

    var keys = Object.keys(map).sort();
    var list = keys.map(function (k) { return map[k]; });
    if (list.length > 8) list = list.slice(list.length - 8);
    return { list: list, posts: posts };
  }

  function monthLabel(month, multiYear) {
    var m = String(month).match(/^(\d{4})-(\d{2})$/);
    if (!m) return month;
    if (multiYear) return m[1].slice(2) + "." + m[2];
    return parseInt(m[2], 10) + "월";
  }

  function renderMonthly() {
    var kind = S.filter === "material" ? "material" : "product";
    var isProduct = kind === "product";
    var unit = isProduct ? "EA" : "ton";
    var data = monthlyData(kind);
    var list = data.list;

    dom.monthlyTitle.textContent = isProduct ? "제품 월별판매량 추이" : "소재 월별구매량 추이";
    dom.monthlySub.textContent = isProduct
      ? "월별 판매 수량 — 기록을 등록하면 그래프에 바로 반영됩니다"
      : "월별 구매 수량 — 기록을 등록하면 그래프에 바로 반영됩니다";

    var realList = list.filter(function (d) { return !d.sample; });
    var hasSample = list.some(function (d) { return d.sample; });
    var last = realList.length ? realList[realList.length - 1] : null;
    var prev = list.length > 1 ? list[list.length - 2] : null;
    var realSum = realList.reduce(function (s, d) { return s + d.value; }, 0);
    var recordCount = data.posts.length;

    var delta = null;
    if (last && prev && prev.value) delta = ((last.value - prev.value) / prev.value) * 100;

    var dec = isProduct ? 0 : 1;
    var html = "";
    html += kpiCard({
      label: last ? monthLabel(last.month, false) + (isProduct ? " 판매량" : " 구매량") : "최근 기록",
      value: last ? fmtNum(last.value, dec) + " <small>" + unit + "</small>" : "—",
      sub: last ? "기록 " + (last.count || 1) + "건" : "월별 기록 없음",
      tone: isProduct ? "product" : "material",
    });
    html += kpiCard({
      label: "전월 대비",
      value: delta == null ? "—" : (delta >= 0 ? "▲ " : "▼ ") + fmtPct(Math.abs(delta)),
      sub: prev ? monthLabel(prev.month, false) + (prev.sample ? " (예시) 대비" : " 대비") : "비교할 이전 달 없음",
      tone: delta == null ? "" : (delta >= 0 ? "good" : "defect"),
    });
    html += kpiCard({
      label: "월평균 (기록 기준)",
      value: realList.length ? fmtNum(realSum / realList.length, dec) + " <small>" + unit + "</small>" : "—",
      sub: realList.length + "개월 기록",
    });
    html += kpiCard({
      label: "누적 합계 (기록 기준)",
      value: realList.length ? fmtNum(realSum, dec) + " <small>" + unit + "</small>" : "—",
      sub: recordCount + "건의 기록",
    });
    dom.monthlyKpis.innerHTML = html;

    var Chart = chartLib();
    destroyChart("monthly");
    if (Chart && list.length) {
      var ctx = canvasCtx("chartMonthly");
      if (ctx) {
        var multiYear = list.some(function (d) { return String(d.month).slice(0, 4) !== String(list[0].month).slice(0, 4); });
        var labels = list.map(function (d) { return monthLabel(d.month, multiYear); });
        var values = list.map(function (d) { return d.value; });
        var colors = list.map(function (d) {
          if (d.sample) return isProduct ? COLORS.sample : COLORS.sampleMaterial;
          return isProduct ? COLORS.product : COLORS.material;
        });
        var borders = list.map(function (d) {
          if (d.sample) return isProduct ? "rgba(124,58,237,.45)" : "rgba(15,118,110,.4)";
          return isProduct ? "#6d28d9" : "#0b5e57";
        });

        S.charts.monthly = new Chart(ctx, {
          type: "bar",
          data: {
            labels: labels,
            datasets: [{
              label: isProduct ? "판매량" : "구매량",
              data: values,
              backgroundColor: colors,
              borderColor: borders,
              borderWidth: 1,
              borderRadius: 6,
              maxBarThickness: 54,
            }],
          },
          options: baseOptions({
            plugins: {
              legend: { display: false },
              tooltip: Object.assign(tooltipStyle(), {
                callbacks: {
                  label: function (c) {
                    var d = list[c.dataIndex];
                    var txt2 = " " + fmtNum(c.parsed.y, dec) + " " + unit;
                    if (d && d.sample) txt2 += " (예시)";
                    if (d && d.count) txt2 += " · 기록 " + d.count + "건";
                    return txt2;
                  },
                },
              }),
            },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 11, weight: "600" }, color: "#55637a" } },
              y: {
                beginAtZero: true,
                grid: { color: COLORS.grid, drawTicks: false },
                border: { display: false },
                ticks: { callback: function (v) { return fmtNum(v, dec); }, font: { size: 10.5 }, padding: 6 },
                title: { display: true, text: unit, color: "#8b98ab", font: { size: 10.5, weight: "600" } },
              },
            },
          }),
        });
      }
    }

    dom.monthlyNote.textContent = hasSample
      ? "옅은 막대는 예시 데이터입니다. 해당 월의 기록을 등록하면 실제 값으로 바뀝니다."
      : "모든 값이 등록된 기록에서 계산되었습니다.";
    dom.monthlyNote.hidden = !list.length && !hasSample;

    var tbody = dom.monthlyTable.querySelector("tbody");
    var thead = dom.monthlyTable.querySelector("thead");
    thead.innerHTML = "<tr><th>월</th><th class=\"t-num\">" + (isProduct ? "판매량" : "구매량") + "</th><th class=\"t-num\">전월 대비</th><th>구분</th></tr>";
    tbody.innerHTML = list.slice().reverse().map(function (d, i, arr) {
      var idx = list.length - 1 - i;
      var p = idx > 0 ? list[idx - 1] : null;
      var ch = p && p.value ? ((d.value - p.value) / p.value) * 100 : null;
      return "<tr>" +
        "<td>" + esc(monthLabel(d.month, true)) + "</td>" +
        '<td class="t-num">' + fmtNum(d.value, dec) + " " + unit + "</td>" +
        '<td class="t-num ' + (ch == null ? "" : ch >= 0 ? "t-up" : "t-down") + '">' + (ch == null ? "—" : (ch >= 0 ? "+" : "") + fmtPct(ch)) + "</td>" +
        "<td>" + (d.sample ? '<span class="mini-tag">예시</span>' : '<span class="mini-tag is-real">기록 ' + (d.count || 1) + "건</span>") + "</td>" +
      "</tr>";
    }).join("");
    var monthlyPanel = dom.monthlyTable ? dom.monthlyTable.closest(".an-panel") : null;
    if (monthlyPanel) monthlyPanel.hidden = !list.length;
  }

  /* ------------------------------------------------------------
     7. 유출불량 요약
     ------------------------------------------------------------ */
  function renderDefect() {
    var posts = S.posts.filter(function (p) { return p.category === "defect"; });
    var months = {};
    var sev = { A: 0, B: 0, C: 0 };
    var lastDate = null;
    posts.forEach(function (p) {
      var f = p.fields || {};
      var d = f.occurredAt ? new Date(f.occurredAt) : (p.createdAt ? new Date(p.createdAt) : null);
      if (d && !isNaN(d.getTime())) {
        var k = d.getFullYear() + "-" + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1);
        months[k] = (months[k] || 0) + 1;
        if (!lastDate || d > lastDate) lastDate = d;
      }
      var s = String(f.severity || "").toUpperCase();
      if (sev[s] != null) sev[s]++;
    });
    var keys = Object.keys(months).sort();
    var thisMonth = new Date();
    var thisKey = thisMonth.getFullYear() + "-" + (thisMonth.getMonth() + 1 < 10 ? "0" : "") + (thisMonth.getMonth() + 1);

    dom.defectKpis.innerHTML =
      kpiCard({ label: "유출불량 기록", value: posts.length + " <small>건</small>", sub: "전체 이력", tone: "defect" }) +
      kpiCard({ label: "이번 달", value: (months[thisKey] || 0) + " <small>건</small>", sub: monthLabel(thisKey, false) + " 기준" }) +
      kpiCard({ label: "A등급", value: sev.A + " <small>건</small>", sub: "B " + sev.B + " · C " + sev.C }) +
      kpiCard({ label: "최근 발생", value: lastDate ? lastDate.getFullYear() + "." + ("0" + (lastDate.getMonth() + 1)).slice(-2) + "." + ("0" + lastDate.getDate()).slice(-2) : "—", sub: "등록된 기록 기준" });

    var Chart = chartLib();
    destroyChart("defect");
    if (Chart && keys.length) {
      var ctx = canvasCtx("chartDefect");
      if (ctx) {
        S.charts.defect = new Chart(ctx, {
          type: "bar",
          data: {
            labels: keys.map(function (k) { return monthLabel(k, keys.length > 1 && keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4)); }),
            datasets: [{
              label: "유출불량 건수", data: keys.map(function (k) { return months[k]; }),
              backgroundColor: "rgba(220, 38, 38, .16)", borderColor: COLORS.defect, borderWidth: 1,
              borderRadius: 5, maxBarThickness: 40,
            }],
          },
          options: baseOptions({
            plugins: {
              legend: { display: false },
              tooltip: Object.assign(tooltipStyle(), { callbacks: { label: function (c) { return " " + c.parsed.y + " 건"; } } }),
            },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 11, weight: "600" }, color: "#55637a" } },
              y: { beginAtZero: true, grid: { color: COLORS.grid, drawTicks: false }, border: { display: false }, ticks: { precision: 0, font: { size: 10.5 }, padding: 6 } },
            },
          }),
        });
      }
    }
    var panel = dom.viewDefect.querySelector(".an-panel");
    if (panel) panel.hidden = !keys.length;
  }

  /* ------------------------------------------------------------
     8. 데이터 출처 · 업로드 UI
     ------------------------------------------------------------ */
  function renderSource() {
    var meta = production.meta;
    var isUpload = meta.source === "upload";
    dom.sourceBadge.textContent = isUpload ? "업로드 데이터" : "기본 데이터";
    dom.sourceBadge.className = "src-badge" + (isUpload ? " is-upload" : "");
    var parts = [];
    if (meta.fileName) parts.push(meta.fileName);
    if (meta.sheet) parts.push(meta.sheet);
    if (meta.periodLabel) parts.push(meta.periodLabel);
    if (isUpload && meta.uploadedAt) parts.push(fmtDateTime(meta.uploadedAt) + " 업로드");
    if (!isUpload) parts.push("샘플 · 엑셀 업로드 시 교체");
    dom.sourceText.textContent = parts.join(" · ");
    dom.sourceText.title = parts.join(" · ");

    if (dom.xlStatus) {
      dom.xlStatus.textContent = isUpload
        ? meta.fileName + " · " + fmtDateTime(meta.uploadedAt) + " 업로드 · " + production.machines.length + "개 설비" + (meta.weeks ? " · " + meta.weeks.length + "구간" : "")
        : "현재 기본 데이터 · " + (meta.fileName || "") + " (" + (meta.periodLabel || "") + " " + (meta.sheet || "") + ")";
    }
    if (dom.periodTag) dom.periodTag.textContent = (meta.period || "").replace("-", ".") || "";
  }

  function setRole(role) {
    S.role = role || "team";
    var isAdmin = S.role === "admin";
    if (dom.xlPanel) dom.xlPanel.hidden = !isAdmin;
    if (dom.xlTeamNote) dom.xlTeamNote.hidden = isAdmin;
    if (dom.xlReset) dom.xlReset.hidden = !isAdmin || !production || production.meta.source !== "upload";
  }

  function setParsing(on, text) {
    S.parsing = on;
    if (dom.xlDrop) dom.xlDrop.classList.toggle("is-busy", !!on);
    if (dom.xlStatus && on && text) dom.xlStatus.textContent = text;
  }

  function handleFile(file) {
    if (!file) return;
    if (S.role !== "admin") { toast("엑셀 업로드는 관리자 로그인 후 가능합니다.", "error"); return; }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast("엑셀(.xlsx, .xls) 또는 CSV 파일만 올릴 수 있습니다.", "error");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast("파일이 너무 큽니다. 25MB 이하 파일을 올려 주세요.", "error");
      return;
    }
    setParsing(true, file.name + " 분석 중…");
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var ds = parseWorkbook(new Uint8Array(reader.result), file.name);
        production = ds;
        saveProduction(ds);
        renderAllViews();
        toast("엑셀을 읽었습니다. " + ds.machines.length + "개 설비 · " + (ds.meta.weeks || []).length + "구간 데이터로 그래프를 갱신했습니다.");
      } catch (err) {
        console.error(err);
        toast(err.message || "엑셀을 읽지 못했습니다.", "error");
        if (dom.xlStatus) dom.xlStatus.textContent = "읽지 못했습니다 · " + (err.message || "");
      } finally {
        setParsing(false);
        if (dom.xlInput) dom.xlInput.value = "";
      }
    };
    reader.onerror = function () {
      setParsing(false);
      toast("파일을 읽지 못했습니다.", "error");
    };
    reader.readAsArrayBuffer(file);
  }

  /* ------------------------------------------------------------
     9. 렌더 진입점
     ------------------------------------------------------------ */
  function renderAllViews() {
    if (!production) {
      if (dom.kpis) dom.kpis.innerHTML = '<p class="an-empty">엑셀을 업로드하면 설비별 그래프와 요약표가 표시됩니다.</p>';
      return;
    }
    renderSource();
    setRole(S.role);
    if (S.filter === "product" || S.filter === "material") renderMonthly();
    else if (S.filter === "defect") renderDefect();
    else {
      renderProductionKpis();
      renderTable();
      renderMachineChart();
      renderWeeklyChart();
    }
  }

  function render(filter) {
    if (!dom.root) return;
    if (filter) S.filter = filter;
    var view = S.filter === "product" || S.filter === "material" ? "monthly"
      : S.filter === "defect" ? "defect" : "production";

    if (dom.viewProduction) dom.viewProduction.hidden = view !== "production";
    if (dom.viewMonthly) dom.viewMonthly.hidden = view !== "monthly";
    if (dom.viewDefect) dom.viewDefect.hidden = view !== "defect";
    if (dom.sourceWrap) dom.sourceWrap.hidden = view !== "production";

    if (view === "production") {
      dom.eyebrow.textContent = "PRODUCTION INSIGHT";
      dom.title.textContent = "설비별 생산 분석";
      dom.sub.textContent = production
        ? (production.meta.periodLabel || "") + " 주차별 계획 대비 실적 · 설비별 달성률 · 불량 현황을 한눈에 봅니다."
        : "엑셀을 올리면 설비별 계획·실적 그래프가 표시됩니다.";
      dom.eyebrow.hidden = false;
    } else if (view === "monthly") {
      dom.eyebrow.textContent = S.filter === "material" ? "MATERIAL TREND" : "SALES TREND";
      dom.title.textContent = S.filter === "material" ? "소재 월별구매량" : "제품 월별판매량";
      dom.sub.textContent = "기록에 등록된 월별 수량을 모아 추이로 보여줍니다. 새 기록을 저장하면 바로 반영됩니다.";
    } else {
      dom.eyebrow.textContent = "QUALITY HISTORY";
      dom.title.textContent = "유출불량 히스토리";
      dom.sub.textContent = "유출불량 기록과 사진, 월별 발생 건수를 함께 봅니다.";
    }

    renderAllViews();
  }

  /* ------------------------------------------------------------
     10. 이벤트 · 초기화
     ------------------------------------------------------------ */
  function bind() {
    if (dom.xlDrop) {
      dom.xlDrop.addEventListener("click", function () { if (dom.xlInput) dom.xlInput.click(); });
      dom.xlDrop.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (dom.xlInput) dom.xlInput.click(); }
      });
      ["dragenter", "dragover"].forEach(function (t) {
        dom.xlDrop.addEventListener(t, function (e) { e.preventDefault(); dom.xlDrop.classList.add("is-drag"); });
      });
      ["dragleave", "drop"].forEach(function (t) {
        dom.xlDrop.addEventListener(t, function (e) {
          e.preventDefault();
          if (t === "dragleave" && e.target !== dom.xlDrop) return;
          dom.xlDrop.classList.remove("is-drag");
        });
      });
      dom.xlDrop.addEventListener("drop", function (e) {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      });
    }
    if (dom.xlInput) {
      dom.xlInput.addEventListener("change", function () {
        if (dom.xlInput.files && dom.xlInput.files.length) handleFile(dom.xlInput.files[0]);
      });
    }
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest('[data-an-action="reset-excel"]') : null;
      if (!btn) return;
      if (S.role !== "admin") return;
      try { localStorage.removeItem(CFG_KEY); } catch (err) { /* ignore */ }
      production = seedProduction();
      renderAllViews();
      toast("기본(샘플) 데이터로 되돌렸습니다.");
    });
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { renderAllViews(); }, 220);
    });
  }

  function init() {
    if (!cacheDom()) return;
    loadProduction();
    bind();
    setRole(S.role);
    S.ready = true;
  }

  function onPosts(posts) {
    S.posts = posts || [];
    if (!S.ready) return;
    if (S.filter === "product" || S.filter === "material") renderMonthly();
    else if (S.filter === "defect") renderDefect();
  }

  window.JeonwooAnalytics = {
    init: init,
    render: render,
    setRole: setRole,
    onPosts: onPosts,
    parseWorkbook: function (buffer, fileName) { return parseWorkbook(buffer, fileName); },
    getProduction: function () { return production; },
    getMonthly: monthlyData,
    _state: S,
  };
})();
