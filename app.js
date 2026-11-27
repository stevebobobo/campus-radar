// 校園輿情雷達：展示網站
// 資料都在 Apps Script 後端，要密碼才拿得到；這個頁面本身不含任何資料。
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var API = window.RADAR_API;
  var LEVEL_LABEL = { red: '重大', orange: '抱怨', green: '正面', gray: '交易租屋', normal: '一般' };
  var LEVEL_ORDER = { red: 0, orange: 1, normal: 2, green: 3, gray: 4 };
  var CHIPS = [['alert', '重大＋抱怨'], ['red', '重大'], ['orange', '抱怨'], ['normal', '一般'], ['green', '正面'], ['gray', '交易租屋'], ['all', '全部']];
  var DAY = 86400000, FRESH_DAYS = 7, PAGE = 30;
  var state = { password: '', posts: [], runs: [], level: 'alert', shown: PAGE, primary: '', school: '' };
  var TOP_PER_WEEK = 5;   // 其他學校：每校每週互動（讚＋留言）前幾名算「精選」
  var OTHERS = '__others';

  // ---------- 小工具 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function highlight(text, hits) {
    var html = esc(text);
    String(hits || '').split('、').forEach(function (w) { if (w) html = html.split(esc(w)).join('<mark>' + esc(w) + '</mark>'); });
    return html;
  }
  function fmt(t) {
    if (!t) return '';
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function store(key, val) { try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) {} }
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.hidden = true; }, 2000); }
  function isFresh(p) { var c = Date.parse(p.createdAt), f = Date.parse(p.firstSeen); return !c || !f || c >= f - FRESH_DAYS * DAY; }
  function isAlert(p) { return p.level === 'red' || p.level === 'orange'; }
  function needsAttention(p) { return isPrimary(p) && !p.handled && isAlert(p) && isFresh(p); }
  function url(p) {
    if (p.url) return /^https:\/\//.test(p.url) ? p.url : '#';
    return 'https://www.dcard.tw/f/' + encodeURIComponent(p.forumAlias) + '/p/' + encodeURIComponent(p.id);
  }
  function heat(p) {
    if (p.platform === 'PTT') return '推 ' + p.likeCount;
    if (p.platform === '新聞' || p.platform === 'Threads') return '';
    if (p.platform === 'YouTube') return p.commentCount ? '💬 ' + p.commentCount : '';
    if (p.platform === 'Instagram') return '💬 ' + p.commentCount + '　❤ ' + p.likeCount;
    if (p.platform === 'Google 地圖' || p.platform === 'Facebook' || p.platform === '網路') return '';
    return '💬 ' + p.commentCount + '　❤ ' + p.likeCount;
  }

  // ---------- 學校 ----------
  // v0.3 的資料沒有 school 欄位，一律算主校
  function schoolOf(p) { return p.school || state.primary; }
  function isPrimary(p) { return schoolOf(p) === state.primary; }
  function shortName(n) { return String(n || '').replace(/^國立/, '').replace('科技大學', '科大'); }
  function weekKey(t) {
    var d = new Date(t); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return d.getTime();
  }
  function featured(list) {
    var groups = {}, out = [];
    list.forEach(function (p) { var k = schoolOf(p) + '|' + weekKey(Date.parse(p.createdAt) || 0); (groups[k] = groups[k] || []).push(p); });
    Object.keys(groups).forEach(function (k) {
      out = out.concat(groups[k].sort(function (a, b) { return (b.likeCount + b.commentCount) - (a.likeCount + a.commentCount); }).slice(0, TOP_PER_WEEK));
    });
    return out;
  }
  // 目前選的學校要看的貼文：主校全部；其他學校只看每週精選
  function cur() {
    if (!state.school) return state.posts.filter(isPrimary);
    var others = state.posts.filter(function (p) { return !isPrimary(p) && (state.school === OTHERS || schoolOf(p) === state.school); });
    return featured(others);
  }
  function renderSchoolBar() {
    var names = {};
    state.posts.forEach(function (p) { if (!isPrimary(p)) names[schoolOf(p)] = true; });
    var list = Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
    $('schoolBar').hidden = !list.length;                     // 還沒有其他學校的資料就跟舊版一樣
    if (!list.length) { state.school = ''; return; }
    if (state.school && state.school !== OTHERS && !names[state.school]) state.school = '';
    $('schoolFilter').innerHTML = '<option value="">' + esc(shortName(state.primary) || '本校') + '（完整監測）</option>'
      + '<option value="' + OTHERS + '">其他學校・每週精選（' + list.length + ' 校）</option>'
      + list.map(function (n) { return '<option value="' + esc(n) + '">' + esc(shortName(n)) + '・精選</option>'; }).join('');
    $('schoolFilter').value = state.school;
    $('schoolNote').textContent = state.school ? 'Dcard 校板每校每週讚＋留言前 ' + TOP_PER_WEEK + ' 名' : '';
  }
  $('schoolFilter').addEventListener('change', function () {
    state.school = this.value; state.shown = PAGE;
    // 其他學校看的是熱門文，預設全部分類、全部狀態
    state.level = state.school ? 'all' : 'alert';
    $('stateFilter').value = state.school ? 'all' : 'open';
    render();
  });

  async function api(body) {
    if (!API) throw new Error('網站還沒設定後端網址（config.js）');
    body.password = state.password;
    var r = await fetch(API, { method: 'POST', body: JSON.stringify(body) });
    var j = await r.json();
    if (!j.ok) throw new Error(j.error || '讀取失敗');
    return j;
  }

  // ---------- 登入 ----------
  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    state.password = $('password').value;
    $('loginBtn').disabled = true; $('loginMsg').textContent = '';
    try {
      await load();
      if ($('remember').checked) store('radar-pw', state.password);
      enter();
    } catch (err) {
      $('loginMsg').textContent = err.message;
    } finally { $('loginBtn').disabled = false; }
  });
  $('logout').addEventListener('click', function () {
    store('radar-pw', null); state.password = ''; state.posts = [];
    $('app').hidden = true; $('login').hidden = false; $('password').value = '';
  });
  $('refresh').addEventListener('click', async function () {
    var b = $('refresh'); b.disabled = true;
    try { await load(); render(); toast('已更新'); } catch (e) { toast(e.message); } finally { b.disabled = false; }
  });
  function enter() { $('login').hidden = true; $('app').hidden = false; render(); }

  async function load() {
    var j = await api({ action: 'list' });
    state.posts = j.posts || [];
    state.runs = j.runs || [];
    state.primary = j.school || '';
    if (j.school) { $('schoolName').textContent = j.school + '・輿情雷達'; document.title = j.school + '・輿情雷達'; }
  }

  // ---------- 畫面 ----------
  function render() {
    var r = state.runs[0];
    renderSchoolBar();
    $('status').textContent = r ? '最近檢查 ' + fmt(r.time) + '・共 ' + cur().length + ' 則' : '尚無檢查紀錄';
    $('errors').textContent = r && r.errors && r.errors.length ? '最近一次檢查的問題：\n' + r.errors.join('\n') : '';
    renderKpis(); renderTrend(); renderPlatforms(); renderList();
  }

  function renderKpis() {
    var now = Date.now(), ps = cur();
    var within = function (days) { return ps.filter(function (p) { return Date.parse(p.createdAt) >= now - days * DAY; }); };
    var d1 = within(1), d7 = within(7);
    var cnt = function (arr, lv) { return arr.filter(function (p) { return p.level === lv; }).length; };
    $('kpis').innerHTML = [
      [d1.length, '近 24 小時聲量', ''],
      [ps.filter(needsAttention).length, '待處理', '<span class="tag" style="background:var(--orange)">!</span>'],
      [cnt(d7, 'red'), '近 7 天重大事件', '<span class="tag" style="background:var(--red)">重大</span>'],
      [cnt(d7, 'green'), '近 7 天正面消息', '<span class="tag" style="background:#2a8a3c">正面</span>'],
    ].map(function (k) { return '<div class="kpi"><b>' + k[0] + '</b><span>' + k[2] + k[1] + '</span></div>'; }).join('');
  }

  function dailySeries() {
    var days = [], today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 29; i >= 0; i--) days.push({ t: today.getTime() - i * DAY, alert: 0, other: 0 });
    var start = days[0].t;
    cur().forEach(function (p) {
      var t = Date.parse(p.createdAt);
      if (!t || t < start) return;
      var d = new Date(t); d.setHours(0, 0, 0, 0);
      var idx = Math.round((d.getTime() - start) / DAY);
      if (days[idx]) days[idx][isAlert(p) ? 'alert' : 'other']++;
    });
    return days;
  }
  function md(t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); }

  function renderTrend() {
    var svg = $('trend'), days = dailySeries();
    var W = svg.clientWidth || 600, H = 200, padL = 28, padR = 6, padT = 10, padB = 22;
    var max = Math.max(4, Math.max.apply(null, days.map(function (d) { return d.alert + d.other; })));
    var step = Math.ceil(max / 4); max = step * 4;
    var plotW = W - padL - padR, plotH = H - padT - padB, slot = plotW / days.length, bw = Math.max(3, Math.min(18, slot - 3));
    var y = function (v) { return padT + plotH - v / max * plotH; };
    var out = [];
    for (var g = 0; g <= 4; g++) {
      var gy = y(step * g);
      out.push('<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy + '" y2="' + gy + '"/>');
      out.push('<text class="axis" x="' + (padL - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + step * g + '</text>');
    }
    days.forEach(function (d, i) {
      var cx = padL + slot * i + slot / 2, x = cx - bw / 2, base = y(0);
      var col = '<g class="col" data-i="' + i + '">';
      // 需注意放底部（貼著基線），其他疊上去；兩段之間留 2px 空隙，最上面那段圓角
      var hA = d.alert / max * plotH, hO = d.other / max * plotH;
      var top = d.other ? 'o' : 'a';
      if (hA > 0) col += bar(x, base - hA, bw, hA, 'var(--s-alert)', top === 'a');
      if (hO > 0) col += bar(x, base - hA - hO - (hA > 0 ? 2 : 0), bw, hO, 'var(--s-other)', true);
      col += '<rect class="hit" x="' + (padL + slot * i) + '" y="' + padT + '" width="' + slot + '" height="' + plotH + '"/></g>';
      out.push(col);
      if (i % 5 === 4 || i === 0) out.push('<text class="axis" x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + md(d.t) + '</text>');
    });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = out.join('');
    state.days = days;
    $('trendTable').innerHTML = '<table class="data"><tr><th>日期</th><th>需注意</th><th>其他</th><th>合計</th></tr>'
      + days.slice().reverse().map(function (d) { return '<tr><td>' + md(d.t) + '</td><td>' + d.alert + '</td><td>' + d.other + '</td><td>' + (d.alert + d.other) + '</td></tr>'; }).join('') + '</table>';
  }
  function bar(x, yTop, w, h, color, round) {
    var r = round ? Math.min(4, h, w / 2) : 0;
    return '<path fill="' + color + '" d="M' + x + ',' + (yTop + h) + 'V' + (yTop + r) + 'Q' + x + ',' + yTop + ' ' + (x + r) + ',' + yTop
      + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + yTop + ' ' + (x + w) + ',' + (yTop + r) + 'V' + (yTop + h) + 'Z"/>';
  }
  function showTip(e) {
    var g = e.target.closest('g.col');
    if (!g) { $('tip').hidden = true; return; }
    var d = state.days[+g.dataset.i], wrap = $('trend').getBoundingClientRect(), hit = g.querySelector('.hit').getBoundingClientRect();
    var tip = $('tip');
    tip.innerHTML = '<b>' + md(d.t) + '</b><br><i style="background:var(--s-alert)"></i>需注意 ' + d.alert + '<br><i style="background:var(--s-other)"></i>其他 ' + d.other;
    tip.hidden = false;
    var left = hit.left - wrap.left + hit.width / 2;
    tip.style.left = Math.max(60, Math.min(wrap.width - 60, left)) + 'px';
    tip.style.top = '0px';
  }
  $('trend').addEventListener('mousemove', showTip);
  $('trend').addEventListener('click', showTip);
  $('trend').addEventListener('mouseleave', function () { $('tip').hidden = true; });
  $('toggleTable').addEventListener('click', function () {
    var t = $('trendTable'); t.hidden = !t.hidden;
    this.textContent = t.hidden ? '以表格檢視' : '收起表格';
  });
  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (!$('app').hidden) renderTrend(); }, 150); });

  function renderPlatforms() {
    var since = Date.now() - 30 * DAY, c = { Dcard: 0, PTT: 0, Threads: 0, YouTube: 0, Instagram: 0, Facebook: 0, 'Google 地圖': 0, '網路': 0, '新聞': 0 };
    cur().forEach(function (p) { if (Date.parse(p.createdAt) >= since && p.platform in c) c[p.platform]++; });
    var max = Math.max.apply(null, [1].concat(Object.keys(c).map(function (k) { return c[k]; })));
    $('platformBars').innerHTML = Object.keys(c).map(function (k) {
      return '<div class="bar-row"><span>' + k + '</span><div class="bar-track"><div class="bar-fill" style="width:' + (c[k] / max * 100) + '%"></div></div><b>' + c[k] + '</b></div>';
    }).join('');
  }

  function filtered(rangeDays) {
    var lv = state.level, pf = $('platformFilter').value, st = $('stateFilter').value, q = $('search').value.trim();
    var days = rangeDays === undefined ? +$('rangeFilter').value : rangeDays, since = days ? Date.now() - days * DAY : 0;
    return cur().filter(function (p) {
      if (lv === 'alert' && !isAlert(p)) return false;
      if (lv !== 'alert' && lv !== 'all' && p.level !== lv) return false;
      if (pf && p.platform !== pf) return false;
      if (st === 'open' && p.handled) return false;
      if (st === 'done' && !p.handled) return false;
      if (since && Date.parse(p.createdAt) < since) return false;
      if (q && (p.title + p.excerpt + p.context + (p.fullText || '') + p.forum + p.note).indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return Date.parse(b.createdAt) - Date.parse(a.createdAt); });
  }

  function renderList() {
    $('levelChips').innerHTML = CHIPS.map(function (c) { return '<button class="chip' + (state.level === c[0] ? ' on' : '') + '" data-level="' + c[0] + '">' + c[1] + '</button>'; }).join('');
    var list = filtered();
    $('count').textContent = '共 ' + list.length + ' 則';
    if (!list.length) {
      var older = +$('rangeFilter').value ? filtered(0).length : 0;
      $('list').innerHTML = '<p class="empty">這個期間沒有符合的內容' + (older ? '<br>期間改選「全部期間」可以看到 ' + older + ' 則較早的內容' : '') + '</p>';
      return;
    }
    $('list').innerHTML = list.slice(0, state.shown).map(card).join('')
      + (list.length > state.shown ? '<button class="more" id="more">再顯示 ' + Math.min(PAGE, list.length - state.shown) + ' 則</button>' : '');
  }

  function card(p) {
    return '<article class="card ' + esc(p.level) + (p.handled ? ' done' : '') + '" data-id="' + esc(p.id) + '">'
      + '<div class="meta"><span class="badge ' + esc(p.level) + '">' + LEVEL_LABEL[p.level] + '</span>'
      + (p.deletedAt ? '<span class="old del" title="' + fmt(p.deletedAt) + ' 發現原文已被刪除，這裡保留的是刪除前抓到的標題和摘要">已刪文</span>' : '')
      + (isFresh(p) ? '' : '<span class="old" title="系統第一次看到時已發文超過 7 天">舊文</span>')
      + (isPrimary(p) ? '' : '<span class="sch">' + esc(shortName(schoolOf(p))) + '</span>')
      + '<span class="pf">' + esc(p.platform) + '</span><span>' + esc(p.forum) + '</span><span>' + fmt(p.createdAt) + '</span>'
      + (heat(p) ? '<span>' + heat(p) + '</span>' : '') + '</div>'
      + '<a class="title" href="' + esc(url(p)) + '" target="_blank" rel="noopener noreferrer">' + highlight(p.title, p.hits) + '</a>'
      + (p.excerpt ? '<p class="excerpt">' + highlight(p.excerpt, p.hits) + '</p>' : '')
      + (p.context ? '<p class="context">內文提到：' + highlight(p.context, p.hits) + '</p>' : '')
      + (p.fullText ? '<details class="full"><summary>' + (p.deletedAt ? '看原文全文（刪除前保存）' : '看原文全文') + '</summary><p>' + highlight(p.fullText, p.hits) + '</p></details>' : '')
      + '<div class="ops"><button data-act="toggle">' + (p.handled ? '改回未處理' : '標記已處理') + '</button>'
      + '<select data-act="level">' + Object.keys(LEVEL_LABEL).map(function (k) { return '<option value="' + k + '"' + (k === p.level ? ' selected' : '') + '>改為：' + LEVEL_LABEL[k] + '</option>'; }).join('') + '</select>'
      + '<input data-act="note" placeholder="處理備註（例如：已轉學務處）" value="' + esc(p.note) + '"></div></article>';
  }

  async function patch(id, change) {
    var p = state.posts.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    var before = Object.assign({}, p);
    Object.assign(p, change);
    render();
    try { await api({ action: 'update', id: id, patch: change }); toast('已儲存'); }
    catch (e) { Object.assign(p, before); render(); toast('儲存失敗：' + e.message); }
  }

  $('list').addEventListener('click', function (e) {
    if (e.target.id === 'more') { state.shown += PAGE; renderList(); return; }
    var b = e.target.closest('button[data-act="toggle"]');
    if (b) { var id = b.closest('.card').dataset.id; var p = state.posts.find(function (x) { return String(x.id) === id; }); patch(id, { handled: !p.handled }); }
  });
  $('list').addEventListener('change', function (e) {
    var c = e.target.closest('.card'); if (!c) return;
    if (e.target.dataset.act === 'note') patch(c.dataset.id, { note: e.target.value });
    if (e.target.dataset.act === 'level') patch(c.dataset.id, { level: e.target.value });
  });
  $('levelChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-level]'); if (!b) return;
    state.level = b.dataset.level; state.shown = PAGE; renderList();
  });
  ['platformFilter', 'stateFilter', 'rangeFilter'].forEach(function (id) { $(id).addEventListener('change', function () { state.shown = PAGE; renderList(); }); });
  $('search').addEventListener('input', function () { state.shown = PAGE; renderList(); });

  $('copySummary').addEventListener('click', async function () {
    var recent = cur().filter(function (p) { return Date.parse(p.createdAt) >= Date.now() - DAY; })
      .sort(function (a, b) { return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.commentCount - a.commentCount; });
    var n = function (lv) { return recent.filter(function (p) { return p.level === lv; }).length; };
    var d = new Date();
    var who = state.school === OTHERS ? '其他學校精選' : state.school ? shortName(state.school) + '精選' : '';
    var lines = ['【校園輿情摘要' + (who ? '・' + who : '') + '】' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
      '近 24 小時各平台共 ' + recent.length + ' 則：重大 ' + n('red') + '、抱怨 ' + n('orange') + '、正面 ' + n('green') + '、一般 ' + n('normal'), ''];
    recent.filter(function (p) { return p.level !== 'gray'; }).forEach(function (p, i) {
      var where = p.platform === 'PTT' ? p.forum + '，推 ' + p.likeCount : p.platform === '新聞' ? '新聞：' + p.forum : p.platform === 'Threads' ? 'Threads' : p.platform === 'YouTube' || p.platform === 'Google 地圖' ? p.forum : ['Instagram', 'Facebook', '網路'].indexOf(p.platform) >= 0 ? p.platform + '：' + p.forum : 'Dcard ' + p.forum + '，留言 ' + p.commentCount;
      lines.push((i + 1) + '. 【' + LEVEL_LABEL[p.level] + '】' + p.title + '（' + where + '）');
      lines.push('   ' + url(p));
    });
    if (!recent.length) lines.push('近 24 小時沒有新內容。');
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('已複製，可以貼到 LINE'); }
    catch (e) { toast('這個瀏覽器不允許複製'); }
  });

  // 記住密碼的話直接進入
  var saved = read('radar-pw');
  if (saved) {
    state.password = saved;
    load().then(enter).catch(function () { store('radar-pw', null); state.password = ''; });
  }
})();
