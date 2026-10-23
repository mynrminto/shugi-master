/* 手技・物品マスター — ストーリーの描画と進行。
 * データは story/story.js（共通・プロローグ・勤務表）と story/ep<N>.js（勤務ごと）。ここはデータを持たない。
 * index.html とのつなぎ目は 2 つだけ：
 *   window.SHUGI_APP      … index.html が公開する道具（MODS・openMod・ART・coach・音など）。使うときに読む
 *   window.SHUGI_STORY_UI … ここが公開する入口（タイトルのボタン、つづきから、手技から戻る、など）
 * 1 つの勤務は「拍（beat）」の列で進む：
 *   扉 → 始まりの会話 → [業務ごとに] 業務の札 → 会話 → 準備 → 手順 → 判断 → 結果 → 会話 … → 終わりの会話 → 勤務の終わり
 * 保存（端末の localStorage。キーに版を付ける）
 *   shugi.player.v1       { name, role }
 *   shugi.story.v1        { seen, tasks, exp, epDone, picks, pos }
 *   shugi.story.last.v1   最後に遊んだのがストーリーなら 1（タイトルの「つづきから」）
 *   shugi.story.ret.v1    ストーリーから手技を開いたとき、戻る先（手技の画面の「‹ ストーリー」）
 */
(function () {
  'use strict';
  var S = window.SHUGI_STORY;
  if (!S) return;
  var EPS = window.SHUGI_STORY_EP = window.SHUGI_STORY_EP || {};

  var KEY = 'shugi.story.v1', PKEY = 'shugi.player.v1', LKEY = 'shugi.story.last.v1', RKEY = 'shugi.story.ret.v1';
  var SAY_CPS = 42;

  /* ---------- 保存 ---------- */
  function load(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても進む */ } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) { /* 無視 */ } }

  var P = load(KEY, null);
  if (!P || typeof P !== 'object') P = {};
  P.seen = Array.isArray(P.seen) ? P.seen : [];
  P.tasks = P.tasks && typeof P.tasks === 'object' ? P.tasks : {};
  P.exp = P.exp && typeof P.exp === 'object' ? P.exp : {};
  P.epDone = P.epDone && typeof P.epDone === 'object' ? P.epDone : {};
  P.picks = P.picks && typeof P.picks === 'object' ? P.picks : {};
  if (!P.pos || typeof P.pos !== 'object') P.pos = null;
  function persist() { save(KEY, P); }
  function seen(id) { return P.seen.indexOf(id) >= 0; }
  function markSeen(id) { if (!seen(id)) { P.seen.push(id); persist(); } }

  var PL = load(PKEY, null);
  function cleanName(n) { n = String(n || '').replace(/[\s<>&"'`]/g, '').slice(0, S.NAME_MAX); return n; }
  function playerName() { return (PL && PL.name) || S.DEFAULT_NAME; }
  function playerRole() { return (PL && S.ROLES[PL.role]) ? PL.role : 'doc'; }
  function setPlayer(name, role, chosen) {
    PL = { name: cleanName(name) || (PL && PL.name) || S.DEFAULT_NAME, role: S.ROLES[role] ? role : playerRole(), roleChosen: !!(chosen || (PL && PL.roleChosen)) };
    save(PKEY, PL);
  }

  /* ---------- 小物 ---------- */
  function A() { return window.SHUGI_APP || null; }
  function art(n) { return 'assets/' + n + '.png'; }
  /* ストーリーの絵（assets/story/<名前>.webp）。S.ART に名前のある物だけ URL を返す。無い絵は読みに行かない。 */
  function hasArt(n) { return !!n && Array.isArray(S.ART) && S.ART.indexOf(n) >= 0; }
  function sArt(n) { return hasArt(n) ? 'assets/story/' + n + '.webp' : null; }
  function bgUrl(n) { return hasArt(n) ? sArt(n) : (S.HAVE.indexOf(n) >= 0 ? 'assets/' + n + '.jpg' : null); }
  function bgCss(key) {
    return (S.BG[key] || S.BG.ward).map(bgUrl).filter(Boolean).map(function (u) { return "url('" + u + "')"; }).join(',');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fill(s) {
    var r = S.ROLES[playerRole()];
    return String(s == null ? '' : s).replace(/\{名前\}/g, playerName()).replace(/\{呼\}/g, r.call).replace(/\{役\}/g, r.label);
  }
  function sfx(n) { var a = A(); if (a && a.sfx) a.sfx(n); }
  function haptic(k) { var a = A(); if (a && a.haptic) a.haptic(k); }
  function bgmNow() { var a = A(); if (a && a.bgm) a.bgm(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function reduced() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function shuffled(arr, seed) {
    var a = arr.slice(), x = hash(seed) || 1;
    function rnd() { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function epMeta(id) { for (var i = 0; i < S.EPISODES.length; i++) if (S.EPISODES[i].id === id) return S.EPISODES[i]; return null; }
  function epIndex(id) { for (var i = 0; i < S.EPISODES.length; i++) if (S.EPISODES[i].id === id) return i; return -1; }
  function modOf(id) { var a = A(); return (a && a.MODS && a.MODS[id]) || (window.SHUGI_MODS || {})[id] || null; }
  function modTitle(id) {
    var a = A();
    if (a && a.CHAPTERS) for (var i = 0; i < a.CHAPTERS.length; i++) for (var j = 0; j < a.CHAPTERS[i].items.length; j++)
      if (a.CHAPTERS[i].items[j].id === id) return a.CHAPTERS[i].items[j].name;
    var m = modOf(id); return m ? m.title : id;
  }
  function doneCount(epId) { var n = 0; for (var k in P.tasks) if (P.tasks[k] && P.tasks[k].ep === epId) n++; return n; }

  /* ---------- 勤務ファイルの読み込み ---------- */
  var loading = {};
  function loadEp(id) {
    if (EPS[id]) return Promise.resolve(EPS[id]);
    var m = epMeta(id);
    if (!m || !m.ready || !m.file) return Promise.reject(new Error('not ready'));
    if (loading[id]) return loading[id];
    loading[id] = new Promise(function (ok, ng) {
      var sc = document.createElement('script'); sc.src = m.file;
      sc.onload = function () { EPS[id] ? ok(EPS[id]) : ng(new Error('no data')); };
      sc.onerror = function () { delete loading[id]; ng(new Error('load')); };
      document.head.appendChild(sc);
    });
    return loading[id];
  }
  S.EPISODES.forEach(function (m) { if (m.ready) loadEp(m.id).catch(function () {}); });

  /* ---------- 進み具合 ---------- */
  function currentEp() {
    if (P.pos && epMeta(P.pos.ep)) return epMeta(P.pos.ep);
    for (var i = 0; i < S.EPISODES.length; i++) if (!P.epDone[S.EPISODES[i].id]) return S.EPISODES[i];
    return null;
  }
  function progressLabel() {
    if (!seen('prologue')) return 'はじめから';
    var m = currentEp();
    if (!m) return 'ぜんぶの勤務を終えた';
    if (!m.ready) {
      var prev = S.EPISODES[epIndex(m.id) - 1];
      return prev ? prev.label + ' まで完了（続きは準備中）' : '準備中';
    }
    return m.label + '　' + doneCount(m.id) + '/' + m.mods.length;
  }
  function expCount() { return Object.keys(P.exp).length; }
  function allMods() { var a = A(), out = []; if (a && a.CHAPTERS) a.CHAPTERS.forEach(function (c) { c.items.forEach(function (it) { out.push(it.id); }); }); return out; }

  /* ---------- 画面（覆いの DOM） ---------- */
  var root = null;
  function build() {
    if (root) return root;
    injectCss();
    root = el('div', 'story');
    root.id = 'story'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'ストーリー');
    root.innerHTML =
      '<div class="sbg" id="sBg"></div>' +
      '<div class="stop"><span class="splace" id="sPlace"></span><span class="ssnd" id="sSnd"></span>' +
      '<button class="sref" id="sRef" type="button" aria-haspopup="dialog" aria-label="資料を見る" hidden>' + REF_ICON + '資料</button>' +
      '<button class="sskip" id="sSkip" type="button">スキップ ▸▸</button><button class="sclose" id="sClose" type="button" aria-label="中断して勤務表へ">×</button></div>' +
      '<div class="sband" id="sBand" hidden></div>' +
      '<div class="sstage" id="sStage"></div>' +
      '<div class="scard" id="sCard" hidden><i id="sKick"></i><b id="sTitle"></b><span id="sSub"></span></div>' +
      '<div class="sbox" id="sBox" hidden><div class="sname" id="sName"></div><div class="stext" id="sText"></div><div class="sact" id="sAct" hidden></div><span class="snext" id="sNext" aria-hidden="true">▼</span></div>' +
      '<div class="spanel" id="sPanel" hidden></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (ev) {
      if (ev.target.closest('button,input,form,a,.spanel')) return;
      tap();
    });
    q('#sSkip').addEventListener('click', function (ev) { ev.stopPropagation(); skip(); });
    q('#sClose').addEventListener('click', function (ev) { ev.stopPropagation(); closeBtn(); });
    q('#sRef').addEventListener('click', function (ev) { ev.stopPropagation(); refOpen(); });
    document.addEventListener('keydown', function (ev) {
      if (refIsOpen()) {
        if (ev.key === 'Escape' || ev.key === 'Esc') { ev.preventDefault(); ev.stopPropagation(); refClose(); }
        return;
      }
      if (!root || root.hidden || !R || R.mode !== 'line') return;
      if (document.querySelector('.modal')) return;
      if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
      if (ev.key === 'Enter' || ev.key === ' ') { if (ev.target && ev.target.closest && ev.target.closest('button')) return; ev.preventDefault(); tap(); }
    }, true);
    return root;
  }
  function q(s) { return root.querySelector(s); }
  function sndHTML() { var a = A(); return a && a.sndBtn ? a.sndBtn() : ''; }

  function show() {
    build(); root.hidden = false; save(LKEY, 1);
    q('#sSnd').innerHTML = sndHTML();
    document.documentElement.style.overflow = 'hidden';
  }
  function hide() {
    if (!root) return;
    refClose(true);
    clearInterval(TY.timer); root.hidden = true;
    document.documentElement.style.overflow = '';
  }

  var BG_NOW = '';
  function setBg(key, night) {
    var bg = q('#sBg'), sig = bgCss(key);
    if (BG_NOW !== sig) {
      var swap = !!BG_NOW && !reduced();
      BG_NOW = sig; bg.style.backgroundImage = sig;
      if (swap) { bg.classList.remove('swap'); void bg.offsetWidth; bg.classList.add('swap'); }
    }
    bg.setAttribute('data-bg', key);
    root.setAttribute('data-night', night ? '1' : '0');
  }

  /* ---------- 進行中の状態 ---------- */
  var R = null;        // { ep, beats, bi, li, reply, replay, read, mode, st:{…業務の途中}, sc:{prep,order,judge} }
  var TY = { timer: null, typing: false, full: '' };

  function beatsOf(ep) {
    var b = [];
    if (ep.card) b.push({ k: 'card' });
    if (ep.open && ep.open.length) b.push({ k: 'lines', key: 'open' });
    (ep.tasks || []).forEach(function (t, i) {
      b.push({ k: 'thead', t: i });
      if (t.intro && t.intro.length) b.push({ k: 'lines', key: 'intro', t: i });
      b.push({ k: 'prep', t: i }, { k: 'order', t: i }, { k: 'judge', t: i }, { k: 'result', t: i });
      if (t.outro && t.outro.length) b.push({ k: 'lines', key: 'outro', t: i });
    });
    if (ep.close && ep.close.length) b.push({ k: 'lines', key: 'close' });
    if (ep.id !== 'prologue') b.push({ k: 'epdone' });
    return b;
  }
  function prologueEp() {
    var p = S.PROLOGUE;
    return { id: 'prologue', card: p.card, bg: p.bg, time: p.time, open: p.lines, tasks: [], title: p.title };
  }
  function linesOf(beat) {
    if (!beat || beat.k !== 'lines') return [];
    if (beat.key === 'open') return R.ep.open || [];
    if (beat.key === 'close') return R.ep.close || [];
    var t = R.ep.tasks[beat.t]; return (t && t[beat.key]) || [];
  }
  function shows(line) {
    if (!line) return false;
    if (line.role && line.role !== playerRole()) return false;
    if (line.when) {
      var m = /^([\w-]+):(\w+)$/.exec(line.when);
      if (m) {
        if (m[1] === 'role') return playerRole() === m[2];
        var got = P.picks[m[1]] != null ? P.picks[m[1]] : 0;
        return String(got) === m[2];
      }
    }
    return true;
  }
  function task() { var b = R && R.beats[R.bi]; return b && b.t != null ? R.ep.tasks[b.t] : null; }

  function savePos() {
    if (!R || R.replay || R.read || R.ep.id === 'prologue') return;
    P.pos = { ep: R.ep.id, bi: R.bi, li: R.li, sc: R.sc || null };
    persist();
  }

  /* 背景と時刻は、勤務の頭からいまの行までに書かれた bg / bgm を順にたどって決める。 */
  function bgAt() {
    var key = R.ep.bg || 'ward', track = null;
    for (var i = 0; i <= R.bi && i < R.beats.length; i++) {
      var b = R.beats[i];
      if (b.k === 'thead') { var t = R.ep.tasks[b.t]; if (t.bg) key = t.bg; track = t.bgm || null; }
      if (b.k !== 'lines') continue;
      var ls = linesOf(b), end = i === R.bi ? Math.min(R.li, ls.length - 1) : ls.length - 1;
      var tr = null;
      for (var j = 0; j <= end; j++) { if (!shows(ls[j])) continue; if (ls[j].bg) key = ls[j].bg; if (ls[j].bgm) tr = ls[j].bgm; }
      if (i === R.bi) track = tr || track;
    }
    return { key: key, track: track };
  }
  function track() {
    if (!root || root.hidden) return null;
    if (!R) return 'day';
    var b = bgAt();
    return b.track || R.ep.time || 'day';
  }

  /* ---------- 入口 ---------- */
  function open() {
    show();
    if (!seen('prologue')) { startEp(prologueEp(), { bi: 0, li: 0 }); return; }
    hub();
  }
  function resume() {
    show();
    if (!seen('prologue')) { startEp(prologueEp(), { bi: 0, li: 0 }); return; }
    if (P.pos && epMeta(P.pos.ep)) { beginEp(P.pos.ep, false); return; }
    hub();
  }
  function beginEp(id, replay) {
    loadEp(id).then(function (ep) {
      var pos = (!replay && P.pos && P.pos.ep === id) ? P.pos : { bi: 0, li: 0 };
      startEp(ep, pos, replay);
    }).catch(function () { hub(); });
  }
  function startEp(ep, pos, replay, read) {
    R = { ep: ep, beats: read ? read.beats : beatsOf(ep), bi: Math.max(0, Math.min(pos.bi || 0, 999)), li: pos.li || 0,
      reply: null, replay: !!replay, read: read || null, st: null, sc: pos.sc || {}, band: '' };
    if (R.bi >= R.beats.length) R.bi = 0;
    savePos();
    paint();
    bgmNow();
  }

  /* ---------- 進める ---------- */
  function nextBeat() {
    var b = R.beats[R.bi];
    if (b && b.k === 'lines' && (b.key === 'open' || b.key === 'close') && !R.read) markSeen(R.ep.id + '-' + b.key);
    R.bi++; R.li = 0; R.reply = null; R.st = null;
    if (R.bi >= R.beats.length) { endRun(); return; }
    var nb = R.beats[R.bi];
    if (nb.k === 'thead') R.sc = {};
    savePos();
    paint();
    bgmNow();
  }
  function endRun() {
    var ep = R.ep;
    if (R.read) { R = null; hub(); return; }
    if (ep.id === 'prologue') {
      markSeen('prologue');
      R = null;
      var first = S.EPISODES[0];
      if (first && first.ready && !P.epDone[first.id]) { beginEp(first.id, false); return; }
      hub(); return;
    }
    R = null; hub();
  }

  /* 行の位置を、出す行まで進める。最後まで無ければ次の拍へ。 */
  function settle() {
    var ls = linesOf(R.beats[R.bi]);
    while (R.li < ls.length && !shows(ls[R.li])) R.li++;
    return R.li < ls.length;
  }

  function tap() {
    if (!R) return;
    if (R.mode === 'card') { sfx('tap'); nextBeat(); return; }
    if (R.mode !== 'line') return;
    if (TY.typing) { finishTyping(); return; }
    if (waiting()) return;
    sfx('tap');
    advanceLine();
  }
  function advanceLine() {
    if (R.reply) { R.reply = null; }
    R.li++;
    savePos();
    if (!settle()) { nextBeat(); return; }
    paint();
    bgmNow();
  }
  function waiting() {
    if (R.mode !== 'line' || R.reply) return null;
    var l = linesOf(R.beats[R.bi])[R.li];
    if (!l) return null;
    if (l.input) return 'input';
    if (l.choose) return 'choose';
    return null;
  }
  function skip() {
    if (!R) return;
    if (R.mode !== 'line' && R.mode !== 'card') return;
    clearInterval(TY.timer); TY.typing = false;
    if (R.mode === 'card') { nextBeat(); return; }
    var ls = linesOf(R.beats[R.bi]);
    for (var i = R.li; i < ls.length; i++) {
      if (!shows(ls[i])) continue;
      if ((ls[i].input === 'name' && !PL) || (ls[i].input === 'role' && !(PL && PL.roleChosen))) { R.li = i; R.reply = null; paint(); return; }
    }
    R.reply = null;
    nextBeat();
  }
  function closeBtn() {
    if (R && !R.read) { savePos(); }
    var wasRun = !!R;
    R = null;
    if (wasRun) { hub(); return; }
    hide(); bgmNow();
    var a = A(); if (a && a.showTitle) a.showTitle();
  }

  /* ---------- 描画 ---------- */
  function paint() {
    clearInterval(TY.timer); TY.typing = false;
    var b = R.beats[R.bi];
    var card = q('#sCard'), box = q('#sBox'), panel = q('#sPanel'), stage = q('#sStage');
    var bg = bgAt();
    setBg(bg.key, R.ep.time === 'night' || bg.key === 'night');
    var t = task();
    q('#sPlace').textContent = placeText();
    q('#sSkip').hidden = !(b.k === 'lines' || b.k === 'card');
    q('#sRef').hidden = !refMods().length;
    q('#sClose').setAttribute('aria-label', '中断して勤務表へ');
    card.hidden = true; box.hidden = true; panel.hidden = true; root.classList.remove('paneled');
    var was = R.mode;
    if (b.k === 'lines' && !settle()) { nextBeat(); return; }
    paintBand(bandFor(b), bg.key);
    root.classList.toggle('carded', b.k === 'card');
    if (b.k === 'card') {
      R.mode = 'card';
      var cd = R.read ? R.ep.card : R.ep.card;
      q('#sKick').textContent = cd.kicker; q('#sTitle').textContent = cd.title; q('#sSub').textContent = cd.sub || '';
      card.hidden = false; stage.innerHTML = ''; R.fig = null;
      var a = A(); if (a && a.BGM && !R.jingled) { R.jingled = true; try { a.BGM.jingle('chapter'); } catch (e) { /* 無視 */ } }
      return;
    }
    if (b.k === 'lines') {
      if (!settle()) { nextBeat(); return; }
      R.mode = 'line';
      box.hidden = false;
      if (was !== 'line' && !reduced()) { box.classList.remove('enter'); void box.offsetWidth; box.classList.add('enter'); }
      paintLine();
      return;
    }
    R.mode = 'panel';
    panel.hidden = false; root.classList.add('paneled');
    stage.innerHTML = ''; R.fig = null;
    panel.scrollTop = 0;
    R.react = REACT[b.k] ? { doc: REACT[b.k][0], puku: REACT[b.k][1] } : { doc: 'normal', puku: 'happy' };
    var fn = { thead: paintHead, prep: paintPrep, order: paintOrder, judge: paintJudge, result: paintResult, epdone: paintEpDone }[b.k];
    if (fn) fn(panel, t);
  }
  function placeText() {
    var b = R.beats[R.bi], t = task();
    if (R.ep.id === 'prologue') return R.ep.card.sub;
    var m = epMeta(R.ep.id), head = m ? m.label : '';
    if (t && b.k !== 'lines') return head + '　業務 ' + (b.t + 1) + '/' + R.ep.tasks.length + '　' + (t.place || '');
    if (t) return head + '　' + (t.place || '');
    return head + '　' + (m ? m.title : '');
  }

  function speaker(line) {
    var n = S.SPEAKER[line.who];
    if (line.who === 'pt' || line.who === 'fam') return line.name || '';
    if (line.who === 'me') return playerName();
    return n == null ? '' : fill(n);
  }
  /* 立ち絵で出す人。いぶき先生（doc）と、看護師のミナミさん（nurse）。 */
  var CAST = { doc: 1, nurse: 1 };
  function castImg(who, mood) {
    return '<img alt="" src="' + (who === 'doc' ? art('doctor_' + (/^(normal|happy|think|alert)$/.test(mood) ? mood : 'normal')) : art('nurse_minami')) + '">';
  }
  /* 同じ会話のまとまりで、もう一人（doc / nurse）がすでに話していれば、その行を返す（2 人並べて出す）。 */
  function castPartner(line) {
    if (!CAST[line.who] || !R || !R.beats) return null;
    var ls = linesOf(R.beats[R.bi]), end = Math.min(ls.length, R.reply ? R.li + 1 : R.li), p = null;
    for (var i = 0; i < end; i++) { var l = ls[i]; if (l && CAST[l.who] && l.who !== line.who && shows(l)) p = l; }
    return p;
  }
  function figFor(line) {
    if (CAST[line.who]) {
      var pt = castPartner(line);
      if (!pt) return { key: line.who, html: castImg(line.who, line.mood), cls: line.who };
      var dm = (line.who === 'doc' ? line : pt).mood;
      return { key: 'duo', cls: 'duo', html: '<span class="cs cs-nurse' + (line.who === 'nurse' ? ' on' : '') + '">' + castImg('nurse') + '</span>' +
        '<span class="cs cs-doc' + (line.who === 'doc' ? ' on' : '') + '">' + castImg('doc', dm) + '</span>' };
    }
    if (line.who === 'puku') return { key: 'puku', html: '<img alt="" src="' + art('mascot_' + (/^(happy|excited|sad)$/.test(line.mood) ? line.mood : 'happy')) + '">', cls: 'mascot' };
    var bd = S.BADGE[line.who];
    if (bd) {
      var mark = bd.mark || String(line.name || '？').charAt(0);
      return { key: line.who + ':' + (line.name || ''), cls: 'nametag', html: '<span class="sbadge" style="--bc:' + bd.color + '"><b>' + esc(mark) + '</b><i>' + esc(speaker(line)) + '</i></span>' };
    }
    return null;
  }
  function paintStage(line) {
    var st = q('#sStage'), f = figFor(line);
    st.classList.toggle('away', !f && line.who !== 'me');
    if (!f) { st.classList.add('dim'); return; }
    st.classList.remove('dim');
    var sig = f.key + '|' + f.html;
    if (R.fig === sig) return;
    var prev = R.fig ? R.fig.split('|')[0] : null, changed = prev !== f.key, html = f.html, enter = changed && !reduced();
    R.fig = sig;
    /* 1 人 → 2 人のときは、あとから来た人だけが入ってくる。 */
    if (f.key === 'duo' && CAST[prev]) { html = html.replace('cs cs-' + (prev === 'doc' ? 'nurse' : 'doc'), '$&' + (enter ? ' in' : '')); enter = false; }
    st.innerHTML = '<div class="sfig ' + f.cls + (enter ? ' enter' : '') + '">' + html + '</div>';
  }
  function curLine() {
    if (R.reply) return R.reply;
    return linesOf(R.beats[R.bi])[R.li] || null;
  }
  function paintLine() {
    var line = curLine();
    if (!line) return;
    paintStage(line);
    q('#sBand').classList.toggle('talk', line.who === 'pt');
    var nm = q('#sName'), who = speaker(line);
    nm.textContent = who; nm.hidden = !who; nm.className = 'sname w-' + line.who;
    q('#sText').className = 'stext' + (line.who === 'scene' ? ' scene' : '');
    q('#sAct').hidden = true; q('#sAct').innerHTML = '';
    typeLine(fill(line.say));
  }
  function typeLine(text) {
    TY.full = text;
    if (reduced() || window.SHUGI_FAST_STORY) { finishTyping(); return; }
    TY.typing = true; q('#sNext').hidden = true;
    var t0 = performance.now(), tx = q('#sText');
    tx.textContent = '';
    TY.timer = setInterval(function () {
      var n = Math.min(TY.full.length, Math.floor((performance.now() - t0) / 1000 * SAY_CPS) + 1);
      tx.textContent = TY.full.slice(0, n);
      if (n >= TY.full.length) finishTyping();
    }, 30);
  }
  function finishTyping() {
    clearInterval(TY.timer); TY.typing = false;
    q('#sText').textContent = TY.full;
    var w = waiting(), act = q('#sAct');
    q('#sNext').hidden = !!w;
    act.innerHTML = ''; act.hidden = !w; act.classList.remove('stack');
    if (!w) return;
    var line = curLine();
    if (w === 'input' && line.input === 'name') {
      var f = el('form', 'sform');
      f.innerHTML = '<input type="text" id="sNameInput" maxlength="' + S.NAME_MAX + '" autocomplete="off" aria-label="名前（苗字）" placeholder="' + esc(S.DEFAULT_NAME) + '">' +
        '<button class="sbtn go" type="submit">決める</button><i class="snote">苗字だけで。空のままなら「' + esc(S.DEFAULT_NAME) + '」。</i>';
      var inp = f.querySelector('input'); inp.value = PL && PL.name ? PL.name : '';
      f.addEventListener('submit', function (ev) { ev.preventDefault(); setPlayer(inp.value || S.DEFAULT_NAME, PL ? PL.role : 'doc'); sfx('confirm'); advanceLine(); });
      act.appendChild(f);
      setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }, 60);
    } else if (w === 'input' && line.input === 'role') {
      act.classList.add('stack');
      Object.keys(S.ROLES).forEach(function (k) {
        var r = S.ROLES[k], bt = el('button', 'sbtn role', '<b>' + esc(r.label) + '</b><i>' + esc(r.note) + '</i>');
        bt.type = 'button'; bt.setAttribute('data-role', k);
        bt.addEventListener('click', function (ev) { ev.stopPropagation(); setPlayer(playerName(), k, true); haptic('success'); sfx('confirm'); advanceLine(); });
        act.appendChild(bt);
      });
    } else if (w === 'choose') {
      var chs = line.choose;
      act.classList.toggle('stack', chs.length > 2 || chs.some(function (c) { return c.label.length > 9; }));
      chs.forEach(function (c, i) {
        var bt = el('button', 'sbtn', esc(fill(c.label))); bt.type = 'button'; bt.setAttribute('data-choice', i);
        bt.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (line.pick && !R.read) { P.picks[line.pick] = i; persist(); }
          R.reply = { who: c.who || 'doc', mood: c.mood || (c.who ? undefined : 'happy'), name: c.name, say: c.reply };
          sfx('tap'); paintLine();
        });
        act.appendChild(bt);
      });
    }
  }


  /* ---------- 上の帯（イベント CG／患者さんの場面）と、業務の場面 ---------- */
  /* 業務の拍ごとの、いぶき先生とぷくぷくの顔（選んだあとは react() で替える） */
  var REACT = { thead: ['normal', 'happy'], prep: ['think', 'happy'], order: ['think', 'happy'], judge: ['think', 'excited'], result: ['happy', 'happy'], epdone: ['happy', 'excited'] };
  function epCgName() { return 'cg_' + (R.ep.id === 'prologue' ? 'prologue' : R.ep.id); }
  /* いまの行で出すイベント CG の名前。勤務の始まり・終わりは毎回（絵が無ければ代わりの札）、
   * 業務の中（task.cg と行の cg）は絵が届いているときだけ。 */
  function cgAt() {
    var b = R.beats[R.bi];
    if (b.k === 'card') return epCgName();
    if (b.k !== 'lines') return null;
    var always = b.key === 'open' || b.key === 'close', t = task(), name = null;
    if (always) name = epCgName();
    else if (b.key === 'outro' && t && t.cg) name = 'cg_' + t.cg;
    var ls = linesOf(b), end = Math.min(R.li, ls.length - 1);
    for (var j = 0; j <= end; j++) if (shows(ls[j]) && ls[j].cg !== undefined) name = ls[j].cg ? 'cg_' + ls[j].cg : null;
    if (!name) return always ? '' : null;
    return always || hasArt(name) ? name : null;
  }
  /* いまの患者さんの絵（pt_ のあとの名前）と、結果より先か。業務の頭からいまの行までをたどる。 */
  function ptAt() {
    var b = R.beats[R.bi], t = task(), out = { key: null, after: false };
    if (!t) return out;
    out.key = t.ptImg || null;
    for (var i = 0; i <= R.bi && i < R.beats.length; i++) {
      var bb = R.beats[i]; if (bb.t !== b.t) continue;
      if (bb.k === 'result') { out.after = true; if (t.ptAfter) out.key = t.ptAfter; }
      if (bb.k !== 'lines') continue;
      var ls = linesOf(bb), end = i === R.bi ? Math.min(R.li, ls.length - 1) : ls.length - 1;
      for (var j = 0; j <= end; j++) if (shows(ls[j]) && ls[j].pt !== undefined) out.key = ls[j].pt || null;
    }
    return out;
  }
  function bandFor(b) {
    if (b.k === 'card') return { kind: 'cg', name: epCgName(), card: true };
    if (b.k !== 'lines') return null;
    var cg = cgAt(), t = task();
    if (cg != null && cg !== '') return { kind: 'cg', name: cg };
    if (t && (b.key === 'intro' || b.key === 'outro')) return { kind: 'scene', t: t };
    if (cg === '') return null;
    return null;
  }
  function paintBand(info, bgKey) {
    var band = q('#sBand');
    root.classList.toggle('banded', !!info);
    if (!info) { band.hidden = true; band.innerHTML = ''; R.band = ''; return; }
    var html;
    if (info.kind === 'cg') html = cgHTML(info.name, bgKey, info.card);
    else { var p = ptAt(); html = sceneHTML(info.t, { pt: p.key, after: p.after, bgKey: bgKey, band: true }); }
    band.hidden = false;
    if (R.band === html) return;
    R.band = html;
    band.innerHTML = html;
    if (!reduced()) { band.classList.remove('swap'); void band.offsetWidth; band.classList.add('swap'); }
  }
  /* イベント CG。絵が無ければ、その場所の背景に勤務の札をのせて代わりにする（card のときは札なし：下に章の札が出る）。 */
  function cgHTML(name, bgKey, noPlate) {
    var u = sArt(name);
    if (u) return '<div class="cg-img" style="background-image:url(\'' + u + '\')"></div>';
    var cd = R.ep.card || {}, title = name === 'cg_epilogue' ? 'エピローグ' : (cd.title || '');
    return '<div class="cg-ph" style="background-image:' + bgCss(bgKey) + '">' +
      (noPlate ? '' : '<span class="cg-plate"><i>' + esc(cd.kicker || '') + '</i><b>' + esc(title) + '</b></span>') + '</div>';
  }
  function ptWho(t) {
    var info = t.pt ? String(t.pt.info || '') : '', m = /^((?:生後\s*)?\d+\s*(?:歳|か月|週|日))\s*・\s*([男女](?:児|性|の子))/.exec(info);
    return { name: t.pt ? t.pt.name : '', age: m ? m[1].replace(/\s+/g, '') + '・' + m[2] : '', room: t.place || '' };
  }
  /* ベッドの札（患者さんの絵がまだ無いときの代わり）。輪郭だけのベッドと、状態の札。 */
  var BED_SVG = '<svg viewBox="0 0 200 150" aria-hidden="true"><ellipse cx="100" cy="140" rx="88" ry="7" fill="rgba(46,37,69,.12)"/>' +
    '<g stroke="#2E2545" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">' +
    '<rect x="10" y="40" width="18" height="86" rx="7" fill="#DCE6FF"/><rect x="174" y="70" width="16" height="56" rx="6" fill="#DCE6FF"/>' +
    '<rect x="18" y="104" width="166" height="16" rx="5" fill="#8FB4F5"/>' +
    '<circle cx="40" cy="132" r="7" fill="#fff"/><circle cx="160" cy="132" r="7" fill="#fff"/>' +
    '<path d="M28 104 L44 58 L64 62 L78 104 Z" fill="#fff"/><ellipse cx="50" cy="60" rx="17" ry="9" fill="#fff" transform="rotate(-62 50 60)"/>' +
    '<circle cx="60" cy="50" r="14" fill="#D9CFEA"/>' +
    '<path d="M58 104 Q60 72 84 74 Q122 80 152 86 Q174 88 174 104 Z" fill="#CFE3FF"/>' +
    '<path d="M86 84 h62 M92 84 v20 M142 84 v20" fill="none" stroke-width="3"/></g></svg>';
  function sceneHTML(t, o) {
    o = o || {};
    var key = o.pt, src = key ? sArt('pt_' + key) : null, who = ptWho(t);
    var cond = (o.after && t.condAfter) || t.cond || [];
    var chips = cond.map(function (c) {
      c = String(c); var k = c.charAt(0), cls = k === '!' ? ' bad' : k === '+' ? ' ok' : '';
      return '<span class="sc-chip' + cls + '">' + esc(fill(c.replace(/^[!+]/, ''))) + '</span>';
    }).join('');
    var body;
    if (!key) body = '<span class="sc-item">' + iconFor(t.mod) + '</span>';
    else if (src) body = '<img class="sc-ptimg" src="' + src + '" alt="' + esc(who.name) + '">';
    else {
      var st = key.indexOf('_') > 0 ? (S.PT_STATE || {})[key.slice(key.indexOf('_') + 1)] : '';
      body = '<span class="sc-bed">' + BED_SVG + (st ? '<em class="sc-state">' + esc(st) + '</em>' : '') + '</span>';
    }
    var sub = who.name ? [who.age, who.room].filter(Boolean).join('　') : '';
    var plate = '<span class="sc-plate"><b>' + esc(who.name || t.place || '') + '</b>' + (sub ? '<i>' + esc(sub) + '</i>' : '') + '</span>';
    var cast = '';
    if (o.cast) {
      var rc = R.react || { doc: 'normal', puku: 'happy' };
      cast = (o.nurse ? '<img class="sc-ns" src="' + art('nurse_minami') + '" alt="">' : '') +
        '<img class="sc-doc" src="' + art('doctor_' + rc.doc) + '" alt="">' +
        '<img class="sc-puku" src="' + art('mascot_' + rc.puku) + '" alt="">';
    }
    return '<div class="sscene ' + (o.band ? 'in-band' : 'in-panel') + (o.compact ? ' compact' : '') + (o.cast ? ' cast' : '') + '">' +
      '<span class="sc-bg" style="background-image:' + bgCss(o.bgKey || 'room') + '"></span>' +
      '<span class="sc-pt' + (src ? ' has-img' : key ? ' ph' : ' item') + '" data-pt="' + esc(key || '') + '">' + body + plate + '</span>' +
      cast + (chips ? '<span class="sc-chips">' + chips + '</span>' : '') + '</div>';
  }
  /* 業務の場面の いぶき先生 と ぷくぷく の顔を替える（準備・手順・判断の答え合わせのあと）。 */
  function react(doc, puku) {
    if (!R) return;
    R.react = { doc: doc, puku: puku };
    var p = q('#sPanel'), d = p.querySelector('.sc-doc'), m = p.querySelector('.sc-puku');
    if (d) d.src = art('doctor_' + doc);
    if (m) { m.src = art('mascot_' + puku); if (!reduced()) { m.classList.remove('hop'); void m.offsetWidth; m.classList.add('hop'); } }
  }

  /* ---------- 業務：共通の見出し ---------- */
  var STAGES = [['prep', '準備'], ['order', '手順'], ['judge', '判断'], ['result', '結果']];
  function headHTML(t, stage) {
    var b = R.beats[R.bi], role = playerRole(), r = S.ROLES[role];
    var act = t.act ? (t.act[role] || t.act.doc || '') : '';
    var steps = STAGES.map(function (s) {
      var i = STAGES.findIndex(function (x) { return x[0] === stage; }), k = STAGES.findIndex(function (x) { return x[0] === s[0]; });
      return '<i class="' + (k < i ? 'done' : k === i ? 'now' : '') + '">' + s[1] + '</i>';
    }).join('');
    var p = ptAt();
    var scene = sceneHTML(t, { pt: p.key, after: p.after || stage === 'result', bgKey: bgAt().key, cast: true,
      compact: !!stage && stage !== 'result' });
    return '<div class="tk-head ssheet has-scene">' + scene +
      '<div class="tk-top"><span class="tk-no">業務 ' + (b.t + 1) + '/' + R.ep.tasks.length + '</span><span class="tk-mod">' + esc(modTitle(t.mod)) + '</span></div>' +
      '<h2 class="tk-title">' + esc(fill(t.title)) + '</h2>' +
      (t.pt ? '<p class="tk-pt"><b>' + esc(t.pt.name) + '</b>' + esc(fill(t.pt.info)) + '</p>' : '') +
      (act ? '<p class="tk-act"><i>' + esc(r.label) + 'として</i>' + esc(fill(act)) + '</p>' : '') +
      (stage ? '<div class="tk-steps">' + steps + '</div>' : '') +
      '</div>';
  }
  function coachHTML(mood, html, cls, tag) {
    var a = A();
    if (a && a.coach) return a.coach(mood, html, cls, tag);
    return '<div class="coach ' + (cls || '') + '"><div class="cbub">' + html + '</div></div>';
  }
  function navBtn(label, solid, id) { return '<button class="btn' + (solid ? ' solid' : '') + '" type="button" id="' + id + '" data-go="">' + esc(label) + '</button>'; }

  function paintHead(panel, t) {
    panel.innerHTML = '<div class="sin">' + headHTML(t, null) +
      coachHTML('normal', t.lead ? esc(fill(t.lead)) : '患者さんの話を聞いてから、物品をそろえます。間違えても、そのつど説明します。', '', '業務') +
      '<div class="snav">' + navBtn('業務をはじめる', true, 'tkGo') + '</div></div>';
    panel.querySelector('#tkGo').addEventListener('click', function () { sfx('confirm'); haptic(); nextBeat(); });
  }

  /* ---------- 準備：トレーから選ぶ ---------- */
  function findCard(m, k) {
    var mod = modOf(m); if (!mod || !Array.isArray(mod.parts)) return null;
    var strip = function (s) { return String(s).replace(/（.*?）/g, '').trim(); }, hit = null;
    mod.parts.forEach(function (s) { if (s.type !== 'cards' || hit) return; s.items.forEach(function (it) { if (!hit && it[0] === k) hit = it; }); });
    if (!hit) mod.parts.forEach(function (s) { if (s.type !== 'cards' || hit) return; s.items.forEach(function (it) { if (!hit && strip(it[0]) === strip(k)) hit = it; }); });
    return hit;
  }
  function trayItem(it) {
    var name = it.name || it.k || '', pic = it.pic || null;
    if (!pic && it.m && it.k) { var c = findCard(it.m, it.k); if (c) { pic = c[2] || null; if (!it.name) name = c[0]; } }
    return { name: name, pic: pic, m: it.m, ok: !!it.ok, why: it.why || '' };
  }
  function iconFor(m) { var a = A(); return a && a.icon ? a.icon(m || '') : ''; }
  function paintPrep(panel, t) {
    var spec = t.prep || { items: [] };
    var items = spec.items.map(trayItem), order = shuffled(items.map(function (_, i) { return i; }), t.id + ':prep');
    var st = R.st || (R.st = { sel: {}, checked: false });
    panel.innerHTML = '<div class="sin">' + headHTML(t, 'prep') +
      '<section class="ssheet"><h3 class="sh3">準備　必要な物を選ぶ</h3><p class="slead">' + esc(fill(spec.lead || '')) + '</p>' +
      '<div class="tray">' + order.map(function (i) {
        var it = items[i];
        return '<button type="button" class="tray-c" data-i="' + i + '" aria-pressed="' + (!!st.sel[i]) + '">' +
          '<span class="tray-img">' + (it.pic ? '<img src="' + esc(it.pic) + '" alt="" loading="lazy">' : '<span class="tray-ic">' + iconFor(it.m) + '</span>') + '</span>' +
          '<span class="tray-n">' + esc(it.name) + '</span><span class="tray-mk" aria-hidden="true"></span></button>';
      }).join('') + '</div>' +
      '<div class="tray-fb" id="trayFb" hidden></div></section>' +
      '<div class="snav">' + navBtn('これでそろえた', true, 'prepCheck') + '</div></div>';
    var btns = panel.querySelectorAll('.tray-c'), chk = panel.querySelector('#prepCheck');
    function refresh() { chk.disabled = !st.checked && !Object.keys(st.sel).some(function (k) { return st.sel[k]; }); }
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        if (st.checked) return;
        var i = +b.dataset.i; st.sel[i] = !st.sel[i]; b.setAttribute('aria-pressed', String(!!st.sel[i])); haptic(); refresh();
      });
    });
    function check() {
      st.checked = true;
      var miss = [], extra = [];
      items.forEach(function (it, i) {
        var b = panel.querySelector('.tray-c[data-i="' + i + '"]'), s = !!st.sel[i];
        b.classList.add(it.ok ? (s ? 'is-ok' : 'is-miss') : (s ? 'is-extra' : 'is-off'));
        b.querySelector('.tray-mk').textContent = it.ok ? (s ? '✓' : '足りない') : (s ? 'いらない' : '');
        if (it.ok && !s) miss.push(it); if (!it.ok && s) extra.push(it);
      });
      var n = miss.length + extra.length;
      R.sc.prep = n;
      var fb = panel.querySelector('#trayFb'); fb.hidden = false;
      var list = '';
      items.forEach(function (it, i) {
        var s = !!st.sel[i];
        if (it.ok && !s) list += '<li class="miss"><b>足りない：' + esc(it.name) + '</b>' + esc(it.why) + '</li>';
        else if (!it.ok && s) list += '<li class="extra"><b>いらない：' + esc(it.name) + '</b>' + esc(it.why) + '</li>';
      });
      items.forEach(function (it, i) { if (it.ok && st.sel[i]) list += '<li class="ok"><b>' + esc(it.name) + '</b>' + esc(it.why) + '</li>'; });
      fb.innerHTML = coachHTML(n ? 'think' : 'happy', n ? '惜しい。下の説明を見てから、手順に進みましょう。' : 'ぴったりです。必要な物だけがそろいました。', n ? 'ng' : 'ok', '準備') + '<ul class="tray-why">' + list + '</ul>';
      sfx(n ? 'miss' : 'confirm'); haptic(n ? 'error' : 'success');
      var a = A(); if (a && a.puku) a.puku(n ? 'sad' : 'happy');
      react(n ? 'think' : 'happy', n ? 'sad' : 'excited');
      chk.textContent = '手順へ';
      savePos();
      fb.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    }
    chk.addEventListener('click', function () { if (!st.checked) check(); else { sfx('tap'); nextBeat(); } });
    refresh();
  }

  /* ---------- 手順：並べる ---------- */
  function orderItems(t) {
    var mod = modOf(t.mod), spec = t.order || { steps: [] }, src = (mod && mod.steps) || [];
    return spec.steps.map(function (si, k) {
      var s = src[si] || { t: '（手順 ' + si + '）', do: [] };
      return { si: si, t: (spec.labels && spec.labels[k]) || s.t, d: (spec.dos && spec.dos[k]) || s.do || [] };
    });
  }
  function paintOrder(panel, t) {
    var items = orderItems(t), n = items.length;
    var pool = shuffled(items.map(function (_, i) { return i; }), t.id + ':order');
    if (pool.every(function (v, i) { return v === i; }) && n > 1) pool.push(pool.shift());
    var st = R.st || (R.st = { ans: [], checked: false });
    panel.innerHTML = '<div class="sin">' + headHTML(t, 'order') +
      '<section class="ssheet"><h3 class="sh3">手順　順に並べる</h3><p class="slead">' + esc(fill((t.order && t.order.lead) || '手順を、行う順にタップする。')) + '</p>' +
      '<ol class="ord-ans" id="ordAns"></ol><div class="ord-pool" id="ordPool"></div><div id="ordFb" hidden></div></section>' +
      '<div class="snav"><button class="btn" type="button" id="ordUndo">やり直す</button>' + navBtn('確かめる', true, 'ordCheck') + '</div></div>';
    var ans = panel.querySelector('#ordAns'), poolEl = panel.querySelector('#ordPool'), chk = panel.querySelector('#ordCheck'), undo = panel.querySelector('#ordUndo');
    function draw() {
      ans.innerHTML = '';
      for (var k = 0; k < n; k++) {
        var i = st.ans[k], li = el('li', 'ord-slot' + (i == null ? ' empty' : ''));
        if (i == null) li.innerHTML = '<span class="ord-no">' + (k + 1) + '</span><span class="ord-t">　</span>';
        else {
          var cls = st.checked ? (i === k ? ' right' : ' wrong') : '';
          li.className += cls;
          li.innerHTML = '<span class="ord-no">' + (k + 1) + '</span><button type="button" class="ord-t" data-k="' + k + '"' + (st.checked ? ' disabled' : '') + '>' + esc(items[i].t) + '</button>' +
            (st.checked ? '<span class="ord-mk">' + (i === k ? '✓' : '✗') + '</span>' : '');
        }
        ans.appendChild(li);
      }
      poolEl.innerHTML = '';
      pool.forEach(function (i) {
        if (st.ans.indexOf(i) >= 0) return;
        var b = el('button', 'ord-opt', esc(items[i].t)); b.type = 'button'; b.setAttribute('data-i', i);
        b.addEventListener('click', function () { if (st.checked) return; st.ans.push(i); haptic(); draw(); });
        poolEl.appendChild(b);
      });
      poolEl.hidden = st.ans.length >= n;
      ans.querySelectorAll('button[data-k]').forEach(function (b) {
        b.addEventListener('click', function () { if (st.checked) return; st.ans.splice(+b.dataset.k, 1); haptic(); draw(); });
      });
      chk.disabled = !st.checked && st.ans.length < n;
      undo.hidden = st.checked; undo.disabled = !st.ans.length;
    }
    undo.addEventListener('click', function () { st.ans = []; draw(); });
    function check() {
      st.checked = true;
      var wrong = 0; for (var k = 0; k < n; k++) if (st.ans[k] !== k) wrong++;
      R.sc.order = wrong;
      draw();
      var fb = panel.querySelector('#ordFb'); fb.hidden = false;
      fb.innerHTML = coachHTML(wrong ? 'think' : 'happy', wrong ? '順番が入れ替わっています。正しい順と、それぞれですることを確かめましょう。' : 'そのとおりの順番です。それぞれで何をするかも、もう一度見ておきましょう。', wrong ? 'ng' : 'ok', '手順') +
        '<ol class="ord-right">' + items.map(function (it) {
          return '<li><b>' + esc(it.t) + '</b>' + (it.d.length ? '<ul>' + it.d.slice(0, 2).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') + '</li>';
        }).join('') + '</ol><p class="snote2">手順の文は「' + esc(modTitle(t.mod)) + '」の手技タブから。</p>';
      sfx(wrong ? 'miss' : 'confirm'); haptic(wrong ? 'error' : 'success');
      var a = A(); if (a && a.puku) a.puku(wrong ? 'sad' : 'happy');
      react(wrong ? 'think' : 'happy', wrong ? 'sad' : 'excited');
      chk.textContent = '判断へ';
      savePos();
    }
    chk.addEventListener('click', function () { if (!st.checked) check(); else { sfx('tap'); nextBeat(); } });
    draw();
  }

  /* ---------- 判断：ベッドサイドの問い ---------- */
  function judgeOf(t) {
    var mod = modOf(t.mod), j = t.judge || {};
    if (j.quiz != null && mod && mod.quiz && mod.quiz[j.quiz]) { var z = mod.quiz[j.quiz]; return { ask: z.ask, opts: z.opts, why: z.why }; }
    if (j.step != null && mod && mod.steps && mod.steps[j.step] && mod.steps[j.step].q) {
      var s = mod.steps[j.step], qq = s.q; return { ask: qq.ask, opts: qq.opts, ok: qq.ok, ng: qq.ng, why: s.why };
    }
    return { ask: j.ask || '', opts: j.opts || [], why: j.why || '' };
  }
  function paintJudge(panel, t) {
    var J = judgeOf(t), st = R.st || (R.st = { pick: null });
    panel.innerHTML = '<div class="sin">' + headHTML(t, 'judge') +
      '<section class="ssheet q"><h3 class="sh3">判断　ベッドサイドで</h3><b class="jask">' + esc(fill(J.ask)) + '</b>' +
      '<div class="opts">' + J.opts.map(function (o, k) { return '<button type="button" data-k="' + k + '">' + esc(o[0]) + '</button>'; }).join('') + '</div>' +
      '<div id="jFb" hidden></div></section>' +
      '<div class="snav">' + navBtn('結果へ', true, 'jNext') + '</div></div>';
    var nx = panel.querySelector('#jNext'); nx.disabled = true;
    function reveal(k, fresh) {
      st.pick = k;
      var right = J.opts[k] && J.opts[k][1] === 1;
      R.sc.judge = right ? 1 : 0;
      panel.querySelectorAll('.opts button').forEach(function (b) {
        var kk = +b.dataset.k; b.disabled = true;
        if (J.opts[kk][1] === 1) b.classList.add('right'); else if (kk === k) b.classList.add('wrong');
      });
      var txt = right ? (J.ok || J.why) : (J.ng || J.why);
      var extra = (J.ok || J.ng) && J.why ? '<p class="jwhy">' + esc(J.why) + '</p>' : '';
      var fb = panel.querySelector('#jFb'); fb.hidden = false;
      fb.innerHTML = coachHTML(right ? 'happy' : 'alert', esc(txt) + extra, right ? 'ok' : 'ng', right ? '正解' : '解説');
      nx.disabled = false;
      react(right ? 'happy' : 'alert', right ? 'excited' : 'sad');
      if (fresh) {
        sfx(right ? 'confirm' : 'miss'); haptic(right ? 'success' : 'error');
        var a = A(); if (a && a.puku) a.puku(right ? 'happy' : 'sad');
        savePos();
      }
    }
    panel.querySelectorAll('.opts button').forEach(function (b) { b.addEventListener('click', function () { if (st.pick == null) reveal(+b.dataset.k, true); }); });
    nx.addEventListener('click', function () { sfx('tap'); nextBeat(); });
    if (st.pick != null) reveal(st.pick, false);
  }

  /* ---------- 結果 ---------- */
  function record(t) {
    var sc = R.sc || {};
    var perfect = (sc.prep || 0) === 0 && (sc.order || 0) === 0 && sc.judge === 1;
    var first = !P.tasks[t.id];
    P.tasks[t.id] = { ep: R.ep.id, mod: t.mod, at: Date.now(), prep: sc.prep || 0, order: sc.order || 0, judge: sc.judge ? 1 : 0, ok: perfect ? 1 : 0 };
    var newExp = !P.exp[t.mod];
    if (newExp) P.exp[t.mod] = t.id;
    persist();
    return { perfect: perfect, first: first, newExp: newExp };
  }
  function paintResult(panel, t) {
    var sc = R.sc || {};
    var fresh = !(R.st && R.st.res);
    var res = fresh ? record(t) : R.st.res;
    R.st = { res: res };
    var perfect = res.perfect;
    var stars = (!sc.prep ? 1 : 0) + (!sc.order ? 1 : 0) + (sc.judge === 1 ? 1 : 0);
    R.react = perfect ? { doc: 'happy', puku: 'excited' } : { doc: stars >= 2 ? 'happy' : 'think', puku: 'happy' };
    var badge = '<div class="res-badge' + (perfect ? ' perfect' : '') + (fresh && !reduced() ? ' pop' : '') + '"><b>' + (perfect ? 'パーフェクト！' : '業務完了') + '</b>' +
      '<span class="res-stars" aria-label="3 つ中 ' + stars + ' つ">' + [0, 1, 2].map(function (k) { return '<i' + (k < stars ? '' : ' class="off"') + '>★</i>'; }).join('') + '</span></div>';
    var row = function (label, good, text) { return '<li class="' + (good ? 'good' : 'soso') + '"><span>' + label + '</span><b>' + (good ? '◎' : '△') + '</b><i>' + esc(text) + '</i></li>'; };
    var nTr = (t.prep && t.prep.items) ? t.prep.items.length : 0;
    panel.innerHTML = '<div class="sin">' + headHTML(t, 'result') +
      '<section class="ssheet">' + badge + coachHTML(perfect ? 'happy' : 'think', esc(fill(perfect ? t.done.ok : t.done.ng)), perfect ? 'ok' : '', '結果') +
      '<ul class="res-rows">' +
      row('準備', !sc.prep, sc.prep ? '選び違い ' + sc.prep + ' 個（' + nTr + ' 個中）' : '必要な物だけを選べた') +
      row('手順', !sc.order, sc.order ? '入れ替わり ' + sc.order + ' か所' : '正しい順に並べられた') +
      row('判断', sc.judge === 1, sc.judge === 1 ? '正しく判断できた' : '解説で確かめた') +
      '</ul>' +
      '<div class="res-note"><i>研修手帳に書きました</i><b>' + esc(fill(t.note ? t.note.title : t.title)) + '</b><span>' + esc(fill(t.note ? t.note.text : '')) + '</span>' +
      '<em class="expd">現場で経験：' + esc(modTitle(t.mod)) + '</em></div>' +
      '</section>' +
      '<div class="snav col"><button class="btn" type="button" id="resPractice">この手技を練習する</button>' + navBtn('次へ', true, 'resNext') + '</div></div>';
    panel.querySelector('#resPractice').addEventListener('click', function () { practice(t.mod); });
    panel.querySelector('#resNext').addEventListener('click', function () { sfx('tap'); nextBeat(); });
    if (fresh) {
      var a = A();
      if (perfect && a && a.celebrate) a.celebrate('現場で経験：' + modTitle(t.mod), 'note');
      else if (a && a.toast) { a.toast('研修手帳に書きました'); sfx('confirm'); }
    }
  }

  /* 手技を開く。戻るボタンで、この結果の画面に帰ってくる。 */
  var opening = false, RET = load(RKEY, null);
  function practice(mod) {
    var a = A(); if (!a || !a.openMod || !modOf(mod)) return;
    savePos();
    RET = { ep: R.ep.id, bi: R.bi, li: R.li, replay: R.replay, mod: mod, sc: R.sc };
    save(RKEY, RET);
    R.keep = true;
    hide();
    opening = true; try { a.openMod(mod); } finally { opening = false; }
    bgmNow();
  }
  function back() {
    if (!RET) return false;
    var r = RET; RET = null; drop(RKEY);
    show();
    if (R && R.keep && R.ep.id === r.ep) { R.keep = false; paint(); bgmNow(); return true; }
    loadEp(r.ep).then(function (ep) { startEp(ep, { bi: r.bi, li: r.li, sc: r.sc }, r.replay); }).catch(function () { hub(); });
    return true;
  }
  function onOpenMod(id) {
    if (opening) return;
    RET = null; drop(RKEY); drop(LKEY);
  }

  /* ---------- 勤務の終わり ---------- */
  function paintEpDone(panel) {
    var ep = R.ep, m = epMeta(ep.id), wasDone = !!P.epDone[ep.id];
    if (!R.replay) { P.epDone[ep.id] = true; if (P.pos && P.pos.ep === ep.id) P.pos = null; persist(); }
    var next = S.EPISODES[epIndex(ep.id) + 1];
    var rows = ep.tasks.map(function (t) {
      var r = P.tasks[t.id];
      return '<li><span class="ed-mk ' + (r && r.ok ? 'ok' : 'so') + '">' + (r ? (r.ok ? '◎' : '○') : '・') + '</span><b>' + esc(fill(t.title)) + '</b><i>' + esc(modTitle(t.mod)) + '</i></li>';
    }).join('');
    var nOk = ep.tasks.filter(function (t) { var r = P.tasks[t.id]; return r && r.ok; }).length;
    panel.innerHTML = '<div class="sin"><section class="ssheet ed">' +
      '<div class="ed-cg">' + cgHTML(epCgName(), ep.bg || 'station', false) + '</div>' +
      '<p class="ed-kick">' + esc(m ? m.label : '') + '</p><h2>おつかれさまでした</h2>' +
      '<p class="ed-score"><span>パーフェクト</span><b class="mono">' + nOk + '</b><i class="mono">/ ' + ep.tasks.length + '</i></p>' +
      '<p class="slead">「' + esc(m ? m.title : '') + '」の業務を終えました。経験した手技 <b>' + expCount() + '</b> / ' + allMods().length + '</p>' +
      '<ul class="ed-list">' + rows + '</ul>' +
      (ep.memo ? '<div class="res-note memo"><i>研修手帳「ことば」</i><b>' + esc(fill(ep.memo.title)) + '</b><span>' + esc(fill(ep.memo.text)) + '</span></div>' : '') +
      '</section><div class="snav col">' +
      (next && next.ready ? navBtn('次の勤務へ（' + next.label + '）', true, 'edNext') : '') +
      '<button class="btn" type="button" id="edNote">研修手帳を見る</button><button class="btn" type="button" id="edHub">勤務表へ</button></div>' +
      (next && !next.ready ? '<p class="snote2 c">次の勤務（' + esc(next.label + '「' + next.title + '」') + '）は準備中です。</p>' : '') + '</div>';
    if (!wasDone && !R.replay) { var a = A(); if (a && a.celebrate) a.celebrate(m.label + '　おつかれさまでした！', 'chapter'); }
    var nb = panel.querySelector('#edNext');
    if (nb) nb.addEventListener('click', function () { sfx('confirm'); R = null; beginEp(next.id, false); });
    panel.querySelector('#edNote').addEventListener('click', function () { notebook(); });
    panel.querySelector('#edHub').addEventListener('click', function () { R = null; hub(); });
  }

  /* ---------- 勤務表（ストーリーの入口） ---------- */
  /* 勤務の札の絵。その勤務の CG があれば使い、無ければ昼・夜の色に勤務の名前。 */
  function epThumb(m) {
    var u = sArt('cg_' + m.id);
    return '<span class="ep-thumb' + (m.time === 'night' ? ' night' : '') + (u ? ' has' : '') + '">' +
      (u ? '<img src="' + u + '" alt="" loading="lazy">' : '') + '<i>' + esc(m.label) + '</i></span>';
  }
  function hub() {
    show(); R = null;
    clearInterval(TY.timer);
    setBg('station', false);
    q('#sCard').hidden = true; q('#sBox').hidden = true; q('#sStage').innerHTML = '';
    q('#sBand').hidden = true; q('#sBand').innerHTML = ''; root.classList.remove('banded', 'carded');
    q('#sSkip').hidden = true; q('#sRef').hidden = true; refClose(true); q('#sPlace').textContent = 'ストーリー　病棟ローテーション';
    q('#sClose').setAttribute('aria-label', 'タイトルへ');
    var panel = q('#sPanel'); panel.hidden = false; root.classList.add('paneled'); panel.scrollTop = 0;
    var role = S.ROLES[playerRole()], cur = currentEp();
    var mainLabel = !seen('prologue') ? 'はじめる' : (cur && cur.ready ? (P.pos && P.pos.ep === cur.id ? 'つづきから' : (doneCount(cur.id) ? 'つづきから' : '次の勤務へ')) : '');
    var rows = S.EPISODES.map(function (m, i) {
      var prevDone = i === 0 ? seen('prologue') : !!P.epDone[S.EPISODES[i - 1].id];
      var done = !!P.epDone[m.id], isCur = cur && cur.id === m.id;
      var st = !m.ready ? 'wait' : done ? 'done' : (prevDone ? 'cur' : 'lock');
      var tag = { wait: '準備中', done: '完了', cur: (doneCount(m.id) ? '途中 ' + doneCount(m.id) + '/' + m.mods.length : 'つぎ'), lock: 'まだ' }[st];
      return '<li><button type="button" class="ep-row ' + st + (isCur ? ' now' : '') + '" data-ep="' + m.id + '"' + (st === 'wait' || st === 'lock' ? ' disabled' : '') + '>' +
        epThumb(m) + '<span class="ep-t"><b>' + esc(m.title) + '</b><i>' + m.mods.map(modTitle).map(esc).join('・') + '</i></span>' +
        '<span class="ep-tag">' + tag + '</span></button></li>';
    }).join('');
    var mods = allMods(), ex = expCount();
    panel.innerHTML = '<div class="sin">' +
      '<section class="ssheet hub-top' + (hasArt('cg_prologue') ? ' has-hero' : '') + '">' +
      (hasArt('cg_prologue') ? '<span class="hub-hero"><img src="' + sArt('cg_prologue') + '" alt=""></span>' : '') +
      '<img class="hub-doc" src="' + art('doctor_happy') + '" alt="">' +
      '<p class="ed-kick">ストーリー</p><h2>病棟ローテーション</h2>' +
      '<p class="slead">小児病棟で、受け持ちのこどもたちの業務をこなしながら手技を覚える。</p>' +
      (seen('prologue') ? '<p class="hub-me"><b>' + esc(playerName()) + esc(role.call) + '</b><i>' + esc(role.label) + '</i><button type="button" class="hbtn" id="hubWho">名前・役割</button></p>' : '') +
      '<div class="hub-prog"><span>経験した手技</span><div class="bar2"><i style="width:' + Math.round(ex / Math.max(1, mods.length) * 100) + '%"></i></div><b class="mono">' + ex + '/' + mods.length + '</b></div>' +
      '</section>' +
      (mainLabel ? '<div class="snav col">' + navBtn(mainLabel + (seen('prologue') && cur ? '（' + progressLabel() + '）' : ''), true, 'hubGo') + '</div>' : '') +
      '<section class="ssheet"><h3 class="sh3">勤務表</h3><ol class="ep-list">' + rows + '</ol>' +
      '<p class="snote2">終えた勤務は、もう一度最初から遊べます（記録は新しい結果に置き換わります）。</p></section>' +
      '<div class="snav grid"><button class="btn" type="button" id="hubNote">研修手帳</button><button class="btn" type="button" id="hubRead">物語を読み返す</button>' +
      '<button class="btn" type="button" id="hubTitle">タイトルへ</button></div></div>';
    var go = panel.querySelector('#hubGo');
    if (go) go.addEventListener('click', function () {
      sfx('confirm');
      if (!seen('prologue')) { startEp(prologueEp(), { bi: 0, li: 0 }); return; }
      if (cur) beginEp(cur.id, false);
    });
    panel.querySelectorAll('.ep-row').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.ep, done = !!P.epDone[id];
        sfx('confirm');
        if (done) beginEp(id, true); else beginEp(id, false);
      });
    });
    var who = panel.querySelector('#hubWho'); if (who) who.addEventListener('click', whoDialog);
    panel.querySelector('#hubNote').addEventListener('click', function () { notebook(); });
    panel.querySelector('#hubRead').addEventListener('click', readList);
    panel.querySelector('#hubTitle').addEventListener('click', function () { closeBtn(); });
    bgmNow();
  }

  /* ---------- ダイアログ（index.html の .modal の見た目を使う） ---------- */
  function modal(title, body, cls) {
    var m = el('div', 'modal' + (cls ? ' ' + cls : ''));
    m.innerHTML = '<div class="mbox" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="mhead"><h3>' + esc(title) + '</h3><button type="button" class="mclose">とじる</button></div><div class="mbody"></div></div>';
    var close = function () { m.remove(); };
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    m.querySelector('.mclose').addEventListener('click', close);
    body(m.querySelector('.mbody'), close);
    document.body.appendChild(m);
    try { m.querySelector('.mclose').focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
    return m;
  }
  function whoDialog() {
    modal('名前と役割', function (b, close) {
      b.innerHTML = '<p>いぶき先生は「' + esc(playerName() + S.ROLES[playerRole()].call) + '」と呼びます。役割で、業務のなかでの立場（行う・介助する）と呼び方が変わります。</p>' +
        '<div class="sname-row"><input type="text" id="whoName" maxlength="' + S.NAME_MAX + '" aria-label="名前" value="' + esc(playerName()) + '"></div>' +
        '<div class="who-roles">' + Object.keys(S.ROLES).map(function (k) { return '<button type="button" class="btn' + (k === playerRole() ? ' solid' : '') + '" data-role="' + k + '">' + esc(S.ROLES[k].label) + '</button>'; }).join('') + '</div>' +
        '<div class="snav"><button type="button" class="btn solid" id="whoSave">これにする</button></div>';
      var role = playerRole();
      b.querySelectorAll('[data-role]').forEach(function (x) {
        x.addEventListener('click', function () { role = x.dataset.role; b.querySelectorAll('[data-role]').forEach(function (y) { y.classList.toggle('solid', y === x); }); });
      });
      b.querySelector('#whoSave').addEventListener('click', function () { setPlayer(b.querySelector('#whoName').value, role, true); close(); hub(); });
    });
  }

  var NB_TAB = 'log';
  function notebook() {
    var mods = allMods();
    modal('研修手帳', function (b) {
      var tabs = [['log', '業務の記録'], ['map', '手技マップ'], ['memo', 'ことば']];
      b.innerHTML = '<p class="note nb-lead">' + esc(playerName() + S.ROLES[playerRole()].call) + 'の手帳。病棟で経験したことを書き留めていく。</p>' +
        '<div class="nbtabs">' + tabs.map(function (x) { return '<button type="button" class="nbtab" data-tab="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div><div class="nblist" id="nbList"></div>';
      var list = b.querySelector('#nbList');
      function paintNb() {
        b.querySelectorAll('.nbtab').forEach(function (x) { x.classList.toggle('on', x.dataset.tab === NB_TAB); x.setAttribute('aria-pressed', String(x.dataset.tab === NB_TAB)); });
        var h = '';
        if (NB_TAB === 'log') {
          var recs = [];
          S.EPISODES.forEach(function (m) {
            var ep = EPS[m.id]; if (!ep) return;
            ep.tasks.forEach(function (t) { var r = P.tasks[t.id]; if (r) recs.push({ m: m, t: t, r: r }); });
          });
          if (!recs.length) h = '<p class="nbhint">まだ何も書いていない。ストーリーの業務を終えると、ここに書き足される。</p>';
          recs.forEach(function (x) {
            h += '<div class="nbitem"><div class="nbh"><span class="nbday">' + esc(x.m.label) + '</span><b>' + esc(fill(x.t.note ? x.t.note.title : x.t.title)) + '</b><span class="nbmk ' + (x.r.ok ? 'ok' : '') + '">' + (x.r.ok ? '◎' : '○') + '</span></div>' +
              '<p class="nbsub">' + esc(fill(x.t.title)) + '　／　' + esc(x.t.pt ? x.t.pt.name : '') + '　／　' + esc(modTitle(x.t.mod)) + '</p>' +
              '<p>' + esc(fill(x.t.note ? x.t.note.text : '')) + '</p>' +
              '<button type="button" class="hbtn nbgo" data-mod="' + x.t.mod + '">この手技を練習する</button></div>';
          });
        } else if (NB_TAB === 'map') {
          var a = A();
          h = '<p class="nbhint">色のついた手技は「現場で経験」済み。' + expCount() + ' / ' + mods.length + '</p>';
          (a && a.CHAPTERS || []).forEach(function (c, ci) {
            h += '<div class="nbchap" data-chap="' + ci + '"><b>' + esc(c.cat) + '</b><div class="nbchips">' + c.items.map(function (it) {
              var got = !!P.exp[it.id];
              return '<button type="button" class="nbchip' + (got ? ' got' : '') + '" data-mod="' + it.id + '"' + (modOf(it.id) ? '' : ' disabled') + '>' + (got ? '✓ ' : '') + esc(it.name) + '</button>';
            }).join('') + '</div></div>';
          });
        } else {
          S.EPISODES.forEach(function (m) {
            var ep = EPS[m.id], got = P.epDone[m.id] && ep && ep.memo;
            if (!m.ready && !got) return;
            h += '<div class="nbitem' + (got ? '' : ' locked') + '"><div class="nbh"><span class="nbday">' + esc(m.label) + '</span><b>' + (got ? esc(fill(ep.memo.title)) : '？？？') + '</b></div>' +
              (got ? '<p>' + esc(fill(ep.memo.text)) + '</p>' : '<p class="nbhint">まだ書いていない（' + esc(m.label) + 'の終わりに）</p>') + '</div>';
          });
        }
        list.innerHTML = h;
        list.querySelectorAll('[data-mod]').forEach(function (x) {
          x.addEventListener('click', function () {
            var id = x.dataset.mod, mm = document.querySelector('.modal.nbmodal'); if (mm) mm.remove();
            fromNotebook(id);
          });
        });
      }
      b.querySelectorAll('.nbtab').forEach(function (x) { x.addEventListener('click', function () { NB_TAB = x.dataset.tab; paintNb(); }); });
      paintNb();
    }, 'nbmodal');
  }
  /* 手帳から手技を開く。戻ると勤務表に帰る。 */
  function fromNotebook(id) {
    var a = A(); if (!a || !a.openMod || !modOf(id)) return;
    if (R && !R.read) savePos();
    RET = { hub: true }; save(RKEY, RET);
    R = null; hide(); opening = true; try { a.openMod(id); } finally { opening = false; } bgmNow();
  }

  function readList() {
    var items = [{ id: 'prologue', label: 'プロローグ', title: S.PROLOGUE.card.title }];
    S.EPISODES.forEach(function (m) {
      items.push({ id: m.id + '-open', ep: m.id, key: 'open', label: m.label, title: '始まり　' + m.title });
      items.push({ id: m.id + '-close', ep: m.id, key: 'close', label: m.label, title: '終わり　' + m.title });
    });
    modal('物語を読み返す', function (b, close) {
      b.innerHTML = '<p class="note">一度読んだ場面だけを読み返せます。業務もやり直すときは、勤務表から終えた勤務を選びます。</p><div class="rd-list"></div>';
      var box = b.querySelector('.rd-list');
      items.forEach(function (it) {
        var ok = seen(it.id) && (it.id === 'prologue' || EPS[it.ep]);
        var bt = el('button', 'rd-row' + (ok ? '' : ' locked'), '<span>' + esc(it.label) + '</span><b>' + esc(ok ? it.title : 'まだ読んでいない') + '</b>');
        bt.type = 'button'; bt.disabled = !ok;
        bt.addEventListener('click', function () {
          close();
          if (it.id === 'prologue') { var p = prologueEp(); startEp(p, { bi: 0, li: 0 }, true, { beats: beatsOf(p) }); return; }
          var ep = EPS[it.ep];
          startEp(ep, { bi: 0, li: 0 }, true, { beats: it.key === 'open' ? [{ k: 'card' }, { k: 'lines', key: 'open' }] : [{ k: 'lines', key: 'close' }] });
        });
        box.appendChild(bt);
      });
    });
  }

  /* ---------- 資料（ストーリーの途中で、この勤務の手技の資料を見る） ----------
   * 上の帯の「資料」から開く覆い。ストーリーの画面（#story）の外に置き、R にも #story の中身にも触らない。
   * なので閉じれば、同じ行・同じトレーの選択・同じ並べ途中にそのまま戻る（描き直さない）。
   * 中身は手技の画面と同じ見た目：手順（t・do・why・upd）／物品（parts）／根拠（updates）／図（fig の iframe）。
   * 判断の答えが分からないように、確認問題（quiz）と手順の問い（q・ok・ng）は出さない。保存はしない。 */
  var REF_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M12 6.5C10 5 7 4.6 3.5 5v13c3.5-.4 6.5 0 8.5 1.5 2-1.5 5-1.9 8.5-1.5V5C17 4.6 14 5 12 6.5z"/><path d="M12 6.5v13"/></svg>';
  var REF_TABS = [['steps', '手順'], ['parts', '物品'], ['news', '根拠'], ['fig', '図を見る']];
  var RV = { el: null, mod: null, tab: 'steps', from: null };
  function refIsOpen() { return !!(RV.el && !RV.el.hidden); }
  /* この勤務の業務で使う手技（重なりなし、業務の順） */
  function refMods() {
    if (!R || !R.ep || !Array.isArray(R.ep.tasks)) return [];
    var out = [];
    R.ep.tasks.forEach(function (t) { if (t && t.mod && modOf(t.mod) && out.indexOf(t.mod) < 0) out.push(t.mod); });
    return out;
  }
  /* 開いたときに出す手技：いまの業務。業務の外の会話なら、このあとの業務、無ければ直前の業務。 */
  function refDefault() {
    var t = task(), i, b, tt;
    if (t && modOf(t.mod)) return t.mod;
    for (i = R.bi; i < R.beats.length; i++) { b = R.beats[i]; tt = b && b.t != null ? R.ep.tasks[b.t] : null; if (tt && modOf(tt.mod)) return tt.mod; }
    for (i = Math.min(R.bi, R.beats.length - 1); i >= 0; i--) { b = R.beats[i]; tt = b && b.t != null ? R.ep.tasks[b.t] : null; if (tt && modOf(tt.mod)) return tt.mod; }
    var ms = refMods(), cb = R.beats[R.bi];
    return (cb && (cb.key === 'close' || cb.k === 'epdone')) ? ms[ms.length - 1] : ms[0];
  }
  function refChap(id) {
    var a = A(), cs = (a && a.CHAPTERS) || [];
    for (var i = 0; i < cs.length; i++) if (cs[i].items.some(function (it) { return it.id === id; })) return i % 4;
    return 0;
  }
  function refBuild() {
    if (RV.el) return RV.el;
    injectCss();
    var w = el('div', 'rv');
    w.id = 'sRv'; w.hidden = true;
    w.innerHTML = '<div class="rv-bd" data-rvclose=""></div>' +
      '<div class="rv-sheet" role="dialog" aria-modal="true" aria-labelledby="rvTitle">' +
      '<div class="rv-head"><div class="rv-bar"><span class="rv-kick">資料</span><h2 id="rvTitle"></h2><span class="badge" id="rvBadge"></span>' +
      '<button type="button" class="rv-x" id="rvX" aria-label="資料を閉じて、ストーリーに戻る">✕</button></div>' +
      '<div class="rv-mods" id="rvMods" role="group" aria-label="この勤務の手技"></div>' +
      '<div class="tabs rv-tabs" role="tablist">' + REF_TABS.map(function (x) { return '<button type="button" role="tab" data-rvtab="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="rv-body" id="rvBody"></div></div>';
    document.body.appendChild(w);
    w.querySelector('.rv-bd').addEventListener('click', function () { refClose(); });
    w.querySelector('#rvX').addEventListener('click', function () { refClose(); });
    w.querySelectorAll('[data-rvtab]').forEach(function (b) {
      b.addEventListener('click', function () { if (RV.tab === b.dataset.rvtab) return; RV.tab = b.dataset.rvtab; haptic(); refPaint(); });
    });
    /* 覆いの中のタップは、下のストーリーに届かせない */
    w.addEventListener('click', function (ev) { ev.stopPropagation(); });
    RV.el = w;
    return w;
  }
  function refOpen() {
    if (!R) return;
    var ms = refMods(); if (!ms.length) return;
    RV.from = document.activeElement;
    RV.mod = refDefault() || ms[0];
    if (RV.tab === 'fig') RV.tab = 'steps';
    refBuild(); RV.el.hidden = false;
    var sh = RV.el.querySelector('.rv-sheet');
    if (!reduced()) { RV.el.classList.remove('in'); void RV.el.offsetWidth; RV.el.classList.add('in'); }
    refPaint();
    q('#sRef').setAttribute('aria-expanded', 'true');
    try { RV.el.querySelector('#rvX').focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
    return sh;
  }
  function refClose(quiet) {
    if (!refIsOpen()) return;
    RV.el.hidden = true;
    RV.el.querySelector('#rvBody').innerHTML = '';   // 図の iframe も止める
    if (root) { var rb = q('#sRef'); if (rb) rb.setAttribute('aria-expanded', 'false'); }
    if (!quiet) {
      var back = RV.from && RV.from.isConnected && RV.from !== document.body ? RV.from : (root && q('#sRef'));
      try { if (back && back.focus) back.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
    }
    RV.from = null;
  }
  function refPaint() {
    var w = RV.el, id = RV.mod, m = modOf(id);
    if (!w || !m) return;
    w.querySelector('.rv-sheet').setAttribute('data-chap', refChap(id));
    w.querySelector('#rvTitle').textContent = modTitle(id);
    var bd = typeof m.badge === 'function' ? m.badge() : m.badge, bdg = w.querySelector('#rvBadge');
    bdg.textContent = bd || ''; bdg.hidden = !bd;
    var ms = refMods(), mods = w.querySelector('#rvMods');
    mods.hidden = ms.length < 2;
    mods.innerHTML = ms.length < 2 ? '' : ms.map(function (k) {
      var cur = task(), here = cur && cur.mod === k;
      return '<button type="button" class="chip" data-rvmod="' + esc(k) + '" aria-pressed="' + (k === id) + '">' + (here ? '<i class="rv-now">いま</i>' : '') + esc(modTitle(k)) + '</button>';
    }).join('');
    mods.querySelectorAll('[data-rvmod]').forEach(function (b) {
      b.addEventListener('click', function () { if (RV.mod === b.dataset.rvmod) return; RV.mod = b.dataset.rvmod; haptic(); refPaint(); });
    });
    var on = mods.querySelector('[aria-pressed="true"]');
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* 無視 */ } }
    w.querySelectorAll('[data-rvtab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.rvtab === RV.tab)); });
    var body = w.querySelector('#rvBody');
    body.innerHTML = '';
    body.scrollTop = 0;
    var fn = { steps: refSteps, parts: refParts, news: refNews, fig: refFig }[RV.tab] || refSteps;
    fn(body, m, id);
  }
  /* 手順：題・すること・なぜ・最新の推奨。問い（q・ok・ng）は出さない。 */
  function refSteps(body, m) {
    var ss = Array.isArray(m.steps) ? m.steps : [];
    body.innerHTML = '<section class="sheet rv-sec"><p class="lead">手技の手順と、それぞれの理由。答え合わせの問いは出しません。</p>' +
      (ss.length ? '<ol class="rv-steps">' + ss.map(function (s, i) {
        return '<li><div class="stephead"><span class="stepno">STEP ' + (i + 1) + '/' + ss.length + '</span><h3>' + (s.t || '') + '</h3></div>' +
          (s.do && s.do.length ? '<ol class="do">' + s.do.map(function (d) { return '<li>' + d + '</li>'; }).join('') + '</ol>' : '') +
          (s.why ? '<div class="rv-why"><b>なぜ</b><span>' + s.why + '</span></div>' : '') +
          (s.upd ? '<div class="upd"><b>最新の推奨：</b>' + s.upd + '</div>' : '') + '</li>';
      }).join('') + '</ol>' : '<p class="note">手順の資料はまだありません。</p>') + '</section>';
  }
  /* 物品：parts の配列（cards・table・kit・text）を、読むだけの形で並べる。 */
  function refCell(c) { var mm = /^(#[0-9a-fA-F]{3,8})\|(.*)$/.exec(String(c)); return mm ? '<span class="sw" style="background:' + mm[1] + '"></span>' + mm[2] : c; }
  function refParts(body, m) {
    var ps = m.parts;
    if (typeof ps === 'function') {
      /* 留置針・採血は手技の画面の物品タブ（関数）をそのまま使う。画面を描き直す行のタップと、チェック欄は止める。 */
      var node = null;
      try { node = ps(); } catch (e) { node = null; }
      if (!node) { body.innerHTML = '<section class="sheet rv-sec"><p class="note">物品の資料を開けませんでした。</p></section>'; return; }
      var box = el('div', 'rv-fparts');
      box.appendChild(node);
      box.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('tr[data-g]')) { ev.stopPropagation(); ev.preventDefault(); } }, true);
      box.querySelectorAll('.check input').forEach(function (x) { x.disabled = true; });
      box.querySelectorAll('.sheet .lead').forEach(function (x) { if (/チェックはこの端末に保存/.test(x.textContent)) x.remove(); x.textContent = x.textContent.replace('行をタップすると上の図の色が変わります。', ''); });
      box.querySelectorAll('tr[data-g]').forEach(function (x) { x.removeAttribute('data-g'); });
      body.appendChild(box);
      return;
    }
    if (!Array.isArray(ps) || !ps.length) { body.innerHTML = '<section class="sheet rv-sec"><p class="note">物品の資料はまだありません。</p></section>'; return; }
    body.innerHTML = ps.map(function (s) {
      var head = '<h3 class="rv-h">' + (s.h || (s.type === 'kit' ? 'そろえる物品' : '')) + '</h3>' + (s.lead && s.type !== 'kit' ? '<p class="lead">' + s.lead + '</p>' : '');
      if (s.type === 'cards') {
        return '<section class="sheet rv-sec">' + head + (s.pic ? '<img class="rv-over" src="' + esc(s.pic) + '" alt="" loading="lazy">' : '') +
          '<ul class="rv-cards">' + (s.items || []).map(function (it) {
            return '<li>' + (it[2] ? '<img src="' + esc(it[2]) + '" alt="" loading="lazy">' : '') + '<div><b>' + it[0] + '</b><p>' + (it[1] || '') + '</p></div></li>';
          }).join('') + '</ul></section>';
      }
      if (s.type === 'table') {
        return '<section class="sheet rv-sec">' + head + '<div class="tablewrap"><table class="gtable gen"><thead><tr>' + (s.head || []).map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>' +
          (s.rows || []).map(function (r) { return '<tr>' + r.map(function (c, k) { return '<td class="' + (k === 0 ? 'mono' : '') + '">' + (k === 0 ? '<b>' + refCell(c) + '</b>' : refCell(c)) + '</td>'; }).join('') + '</tr>'; }).join('') +
          '</tbody></table></div>' + (s.note ? '<p class="note">' + s.note + '</p>' : '') + '</section>';
      }
      if (s.type === 'kit') {
        return '<section class="sheet rv-sec">' + head + '<ul class="rv-kit">' + (s.items || []).map(function (k) { return '<li><b>' + k[0] + '</b>' + (k[1] ? '<small>' + k[1] + '</small>' : '') + '</li>'; }).join('') + '</ul></section>';
      }
      return '<section class="sheet rv-sec">' + head + (s.html ? '<div class="rv-text">' + s.html + '</div>' : '') + '</section>';
    }).join('');
  }
  /* 根拠：updates（見出し・いまの推奨・補足・出典） */
  function refNews(body, m) {
    var us = Array.isArray(m.updates) ? m.updates : [];
    body.innerHTML = '<section class="sheet rv-sec"><h3 class="rv-h">根拠と出典</h3><p class="lead">手技の内容の根拠です。2026年10月時点の資料で確認しました。</p>' +
      (us.length ? us.map(function (u) {
        return '<div class="chg"><h3>' + (u.h || '') + '</h3><div>' + (u.now || '') + '</div>' + (u.note ? '<div class="note">' + u.note + '</div>' : '') +
          (u.src && u.src.length ? '<div class="src">出典：' + u.src.map(function (s) { return '<a href="' + esc(s[1]) + '" target="_blank" rel="noopener">' + s[0] + '</a>'; }).join('／') + '</div>' : '') + '</div>';
      }).join('') : '<p class="note">根拠の資料はまだありません。</p>') + '</section>';
  }
  /* 図：手技の画面の Fig 1（modules/<id>.html）を、この覆いの中に出す。 */
  function refFig(body, m) {
    if (!m.fig || !m.fig[0]) { body.innerHTML = '<section class="sheet rv-sec"><p class="note">この手技の図はまだありません。</p></section>'; return; }
    body.innerHTML = '<section class="simcard rv-fig"><div class="simhead"><b>' + esc(m.fig[1] || '') + '</b><span>' + esc(m.figHint || '図をドラッグ、またはボタンで段階を進める') + '</span></div>' +
      '<iframe src="' + esc(m.fig[0]) + '" title="' + esc(m.fig[1] || '図') + '" style="height:' + (+m.figH || 760) + 'px"></iframe></section>';
    var ifr = body.querySelector('iframe');
    ifr.addEventListener('load', function () {
      try {
        var d = ifr.contentDocument, fit = function () { var hh = d.documentElement.scrollHeight; if (hh > 200) ifr.style.height = hh + 'px'; };
        fit(); if (window.ResizeObserver) new ResizeObserver(fit).observe(d.body);
      } catch (e) { /* 読めなければ figH のまま */ }
    });
  }

  /* ---------- index.html から呼ばれる入口 ---------- */
  function titleButton() {
    return '<button class="tbtn" data-t="story"><img src="' + art('mascot_happy') + '" alt=""><span><b>勤務表</b><i>' + (seen('prologue') ? '勤務を選んで遊ぶ・ふりかえる' : 'ストーリーの勤務の一覧') + '</i></span></button>';
  }
  function isLast() { return !!load(LKEY, null) && seen('prologue'); }
  /* タイトルの「つづきから」はいつもストーリーの続き（2026-10-20 ユーザー）。下の「勤務表」は勤務を選ぶ入口。 */
  function goInfo() { return seen('prologue') ? { b: 'つづきから', i: 'ストーリー　' + progressLabel() } : { b: 'はじめる', i: 'ストーリーのプロローグから' }; }
  function retLabel() { return RET ? (RET.hub ? '‹ 勤務表' : '‹ ストーリー') : ''; }
  function backFromMod() {
    if (!RET) return false;
    if (RET.hub) { RET = null; drop(RKEY); hub(); return true; }
    return back();
  }

  window.SHUGI_STORY_UI = {
    titleButton: titleButton, goInfo: goInfo, isLast: isLast,
    open: open, resume: resume,
    active: function () { return !!root && !root.hidden; },
    track: track, back: backFromMod, retLabel: retLabel, onOpenMod: onOpenMod,
    exp: function (id) { return !!P.exp[id]; },
    /* 動作確認用 */
    _state: function () { return { P: P, PL: PL, R: R ? { ep: R.ep.id, bi: R.bi, li: R.li, mode: R.mode, beat: R.beats[R.bi] } : null, RET: RET }; },
    _notebook: notebook,
    _ref: function () { return refIsOpen() ? { mod: RV.mod, tab: RV.tab } : null; }
  };

  /* ---------- 見た目 ---------- */
  function injectCss() {
    if (document.getElementById('storyCss')) return;
    var css = [
      '.story{--sbT:calc(50px + env(safe-area-inset-top,0px));--sbW:min(620px,calc(100vw - 24px));--sbH:min(calc(var(--sbW) * .5625),34vh);position:fixed;inset:0;z-index:95;overflow:hidden;background:#2A2440;cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:var(--ink);font:500 15px/1.7 var(--f-body)}',
      '.story[hidden]{display:none}',
      '.sbg{position:absolute;inset:0;background-color:#FFF1E4;background-size:cover;background-position:center;background-repeat:no-repeat}',
      '.sbg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,248,238,.22) 0%,rgba(255,240,244,.08) 45%,rgba(46,37,69,.38) 100%)}',
      '.story.paneled .sbg::after{background:linear-gradient(180deg,rgba(255,248,238,.55),rgba(255,240,244,.72))}',
      '.story[data-night="1"] .sbg::after{background:linear-gradient(180deg,rgba(12,16,48,.6),rgba(24,18,56,.74))}',
      '.story[data-night="1"].paneled .sbg::after{background:linear-gradient(180deg,rgba(12,16,48,.72),rgba(24,18,56,.82))}',
      '.stop{position:absolute;z-index:6;top:max(8px,env(safe-area-inset-top,0px));left:max(10px,env(safe-area-inset-left,0px));right:max(10px,env(safe-area-inset-right,0px));display:flex;align-items:center;gap:6px}',
      '.splace{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:800;color:#fff;background:rgba(46,37,69,.72);padding:5px 12px;border-radius:999px}',
      '.ssnd .sndbtn{width:34px;height:34px;border-width:2.5px}.ssnd .sndbtn svg{width:18px;height:18px}',
      '.sskip,.sclose{flex:none;font:800 12px/1 var(--f-body);color:#fff;background:rgba(46,37,69,.72);border:2px solid rgba(255,255,255,.7);border-radius:999px;padding:7px 11px;cursor:pointer}',
      '.sclose{width:34px;height:34px;padding:0;font-size:17px;display:grid;place-items:center}',
      '.sskip[hidden]{display:none}',
      '.sstage{position:absolute;z-index:1;left:0;right:0;top:52px;bottom:170px;display:flex;justify-content:center;align-items:flex-end;pointer-events:none;transition:opacity .25s,filter .25s}',
      '.sstage.dim{filter:brightness(.78) saturate(.75)}.sstage.away{opacity:0}',
      '.sfig{height:100%;max-height:430px;display:flex;align-items:flex-end;justify-content:center}',
      '.sfig img{display:block;height:100%;width:auto;max-width:86vw;object-fit:contain;filter:drop-shadow(0 10px 14px rgba(30,20,60,.35))}',
      '.sfig.mascot{height:46%;max-height:220px}',
      '.sfig.duo{position:relative;display:block;width:100%;max-width:400px}',
      '.sfig.duo .cs{position:absolute;bottom:0;height:86%;display:flex;align-items:flex-end;transform-origin:50% 100%;transition:filter .25s,transform .25s}',
      '.sfig.duo .cs img{max-width:none}.sfig.duo .cs-nurse{left:2px}.sfig.duo .cs-doc{right:2px}',
      '.sfig.duo .cs:not(.on){filter:brightness(.72) saturate(.7);transform:scale(.93)}.sfig.duo .cs.on{z-index:1}',
      '.sfig.duo .cs.in{animation:sfigIn .35s cubic-bezier(.2,1.3,.4,1)}',
      '.sfig.nametag{height:auto;margin-bottom:40px}',
      '.sbadge{display:flex;flex-direction:column;align-items:center;gap:6px}',
      '.sbadge b{display:grid;place-items:center;width:118px;height:118px;border-radius:50%;background:#fff;border:4px solid var(--gline);color:var(--bc);font:800 54px/1 var(--f-display);box-shadow:0 6px 0 rgba(46,37,69,.25),inset 0 0 0 8px color-mix(in srgb,var(--bc) 18%,#fff)}',
      '.sbadge i{font-style:normal;font-size:13px;font-weight:800;color:#fff;background:var(--bc);border:3px solid var(--gline);border-radius:999px;padding:2px 12px;white-space:nowrap}',
      '.sfig.enter{animation:sfigIn .35s cubic-bezier(.2,1.3,.4,1)}',
      '@keyframes sfigIn{from{transform:translateY(24px) scale(.96);opacity:0}to{transform:none;opacity:1}}',
      '.sbox{position:absolute;z-index:5;left:50%;transform:translateX(-50%);bottom:max(12px,env(safe-area-inset-bottom,0px));width:min(620px,calc(100% - 24px));min-height:142px;max-height:calc(100% - 70px);overflow-y:auto;background:rgba(255,253,248,.97);border:3px solid var(--gline);border-radius:20px;padding:22px 16px 16px;box-shadow:0 6px 0 rgba(46,37,69,.25),0 18px 40px rgba(20,10,40,.35)}',
      '.sbox[hidden]{display:none}',
      '.sname{position:absolute;top:-3px;left:14px;transform:translateY(-50%);padding:3px 13px;border-radius:999px;font-weight:800;font-size:13px;line-height:1.4;color:#fff;background:#8B6BFF;border:3px solid var(--gline);white-space:nowrap;max-width:calc(100% - 28px);overflow:hidden;text-overflow:ellipsis}',
      '.sbox{overflow:visible}',
      '.sname[hidden]{display:none}',
      '.sname.w-doc{background:#12A877}.sname.w-puku{background:#5B7CFA}.sname.w-me{background:#E0457A}.sname.w-nurse{background:#E07A2E}.sname.w-surg{background:#3D8FE0}.sname.w-pt,.sname.w-fam{background:#7B5BEF}',
      '.stext{font-size:16px;line-height:1.75;min-height:3.5em;white-space:pre-wrap;color:#262745;font-weight:500;overflow-wrap:anywhere}',
      '.stext.scene{color:#4A4C6E;border-left:3px solid #DCCFE8;padding-left:10px}',
      '.snext{position:absolute;right:16px;bottom:6px;color:var(--accent-t);font-size:13px;animation:snext 1s ease-in-out infinite}.snext[hidden]{display:none}',
      '@keyframes snext{50%{transform:translateY(3px);opacity:.45}}',
      '.sact{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;cursor:default}.sact[hidden]{display:none}.sact.stack .sbtn{flex-basis:100%}',
      '.sbtn{flex:1 1 130px;min-width:0;padding:10px 12px;border-radius:14px;border:2.5px solid var(--gline);background:#fff;font:inherit;font-weight:800;font-size:14.5px;line-height:1.4;color:#262745;box-shadow:0 3px 0 var(--gline);cursor:pointer;text-align:center}',
      '.sbtn.go{background:#E0457A;color:#fff}.sbtn:active{transform:translateY(3px);box-shadow:none}',
      '.sbtn.role{display:flex;flex-direction:column;align-items:flex-start;text-align:left}.sbtn.role b{font-size:16px}.sbtn.role i{font-style:normal;font-size:12px;font-weight:700;color:#55577A}',
      '.sform{display:flex;flex-wrap:wrap;gap:8px;width:100%;align-items:center}',
      '.sform input,.sname-row input{flex:1 1 140px;min-width:0;font:inherit;font-size:17px;font-weight:700;padding:9px 12px;border-radius:12px;border:2.5px solid var(--gline);background:#FFF8EE;color:#262745;-webkit-user-select:text;user-select:text}',
      '.sform .sbtn{flex:0 0 auto}.snote{flex-basis:100%;font-style:normal;font-size:11.5px;color:#55577A}',
      '.scard{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:calc(var(--sbT) + var(--sbH) + 14px) 20px 64px;background:linear-gradient(180deg,rgba(255,243,228,.5) 0%,rgba(255,240,236,.86) 45%,rgba(255,236,242,.94) 100%);color:var(--ink);text-align:center;animation:scardIn .6s ease}',
      '.story[data-night="1"] .scard{background:linear-gradient(180deg,rgba(18,16,50,.45) 0%,rgba(22,18,56,.82) 45%,rgba(24,18,56,.92) 100%);color:#fff}',
      '.scard[hidden]{display:none}',
      '.scard i{font-style:normal;font-family:var(--f-logo);font-size:15px;letter-spacing:.14em;color:var(--accent-t);background:#fff;padding:3px 16px;border-radius:999px;border:3px solid var(--gline)}',
      '.scard b{font-family:var(--f-logo);font-weight:400;font-size:clamp(30px,9vw,48px);letter-spacing:.06em;line-height:1.25;-webkit-text-stroke:6px var(--gline);paint-order:stroke fill;text-shadow:0 4px 0 rgba(0,0,0,.25)}',
      '.scard span{order:-1;font:700 17px/1.3 var(--f-mono);letter-spacing:.04em;color:var(--accent-t);padding:0 8px}',
      '.story[data-night="1"] .scard span{color:#FF9DBA}',
      '.scard::before{content:"";order:1;width:min(220px,60%);height:4px;border-radius:4px;background:linear-gradient(90deg,transparent,#FF7FA4 20%,#FFC53D 50%,#4FD8B4 80%,transparent)}',
      '.scard i{order:2}',
      '.scard::after{content:"▼ タップで進む";position:absolute;bottom:max(30px,env(safe-area-inset-bottom,0px));font-size:12px;font-weight:800;color:var(--accent-t);opacity:.9;animation:snext 1.4s ease-in-out infinite}',
      '.story[data-night="1"] .scard::after{color:#FF9DBA}',
      '@keyframes scardIn{from{opacity:0}to{opacity:1}}',
      '.spanel{position:absolute;z-index:3;left:0;right:0;top:calc(52px + env(safe-area-inset-top,0px));bottom:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;cursor:default;-webkit-user-select:text;user-select:text;padding:4px max(16px,env(safe-area-inset-right,0px)) calc(28px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}',
      '.spanel[hidden]{display:none}',
      '.sin{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:12px}',
      '.ssheet{background:#fff;border:3px solid var(--gline);border-radius:20px;box-shadow:0 5px 0 var(--glip);padding:14px;min-width:0}',
      '.ssheet h2{font-size:20px}.sh3{font-size:16px;margin:0}',
      '.slead{margin:4px 0 0;color:var(--ink-2);font-size:13.5px;line-height:1.6}',
      '.snote2{margin:8px 0 0;font-size:11.5px;color:var(--ink-3);line-height:1.5}.snote2.c{text-align:center;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.4)}',
      '.story[data-night="1"] .snote2.c{color:#fff}',
      '.snav{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}.snav .btn{flex:1 1 auto}.snav.col{flex-direction:column}.snav.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.snav.grid .btn:last-child{grid-column:1/-1}',
      '.snav .btn[hidden]{display:none}',
      '.tk-head{padding:12px 14px;border-left-width:8px;border-left-color:var(--accent)}',
      '.tk-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.tk-no{font:800 12px/1 var(--f-body);color:#fff;background:var(--accent-t);border:2px solid var(--gline);border-radius:999px;padding:4px 10px}',
      '.tk-mod{font:800 12px/1.3 var(--f-body);color:var(--ink-2);background:var(--panel2);border:2px solid var(--gline);border-radius:999px;padding:2px 10px}',
      '.tk-title{font-size:19px;margin-top:6px}',
      '.tk-pt{margin:6px 0 0;font-size:13.5px;line-height:1.6;color:var(--ink-2)}.tk-pt b{color:var(--ink);margin-right:6px}',
      '.tk-act{margin:6px 0 0;font-size:13px;line-height:1.55;color:var(--ink);background:var(--blue-soft);border-radius:12px;padding:6px 10px}.tk-act i{display:block;font-style:normal;font-size:11px;font-weight:800;color:#3557D6}',
      '.tk-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-top:10px}',
      '.tk-steps i{font-style:normal;text-align:center;font-size:12px;font-weight:800;color:var(--ink-3);background:#F3E6EC;border:2px solid var(--gline);border-radius:999px;padding:1px 0}',
      '.tk-steps i.done{background:var(--ok);color:#fff}.tk-steps i.now{background:#FFC53D;color:var(--ink)}',
      '.tray{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}',
      '.tray-c{position:relative;display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:6px 6px 8px;border:2.5px solid var(--gline);border-radius:14px;background:#f6f6f3;cursor:pointer;color:#1d2530;box-shadow:0 3px 0 var(--glip);text-align:center;min-width:0}',
      '.tray-c:active{transform:translateY(3px);box-shadow:none}',
      '.tray-img{display:grid;place-items:center;aspect-ratio:4/3;border-radius:10px;background:#fff;overflow:hidden}',
      '.tray-img img{display:block;width:100%;height:100%;object-fit:contain}',
      '.tray-ic svg{width:48px;height:48px}',
      '.tray-n{font-size:12.5px;font-weight:800;line-height:1.35;overflow-wrap:anywhere}',
      '.tray-c[aria-pressed="true"]{background:#E3EAFE;box-shadow:0 0 0 3px #1f4fd1}',
      '.tray-c[aria-pressed="true"]::before{content:"✓";position:absolute;top:4px;left:4px;z-index:1;width:22px;height:22px;border-radius:50%;background:#1f4fd1;color:#fff;font-size:13px;font-weight:800;display:grid;place-items:center}',
      '.tray-mk{font-size:11.5px;font-weight:800;line-height:1.2;min-height:0}',
      '.tray-mk:empty{display:none}',
      '.tray-c.is-ok{background:var(--ok-soft);box-shadow:0 0 0 3px var(--ok)}.tray-c.is-ok .tray-mk{color:var(--ok)}.tray-c.is-ok::before{background:var(--ok)}',
      '.tray-c.is-miss{background:var(--warn-soft);box-shadow:0 0 0 3px #E0A040}.tray-c.is-miss .tray-mk{color:var(--warn)}',
      '.tray-c.is-extra{background:var(--blood-soft);box-shadow:0 0 0 3px var(--blood)}.tray-c.is-extra .tray-mk{color:var(--blood)}.tray-c.is-extra::before{content:"✗";background:var(--blood)}',
      '.tray-c.is-off{opacity:.55}',
      '.tray-fb[hidden]{display:none}',
      '.tray-why{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.tray-why li{font-size:13px;line-height:1.55;padding:6px 10px;border-radius:12px;background:var(--panel2);border:2px solid var(--line)}',
      '.tray-why li b{display:block;font-size:13px}.tray-why li.miss b{color:var(--warn)}.tray-why li.extra b{color:var(--blood)}.tray-why li.ok b{color:var(--ok)}',
      '.ord-ans{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.ord-slot{display:flex;align-items:center;gap:8px;min-height:44px;padding:4px 8px 4px 6px;border-radius:14px;border:2.5px dashed #C9BCD9;background:var(--panel2)}',
      '.ord-slot:not(.empty){border-style:solid;border-color:var(--gline);background:#fff}',
      '.ord-slot.right{background:var(--ok-soft);border-color:var(--ok)}.ord-slot.wrong{background:var(--blood-soft);border-color:var(--blood)}',
      '.ord-no{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:700 13px var(--f-mono);color:#fff;background:var(--accent-t);border:2px solid var(--gline)}',
      '.ord-t{flex:1;min-width:0;text-align:left;font:inherit;font-size:14px;font-weight:800;line-height:1.4;color:var(--ink);background:none;border:0;padding:4px 0;cursor:pointer}',
      '.ord-t:disabled{cursor:default;color:var(--ink)}',
      '.ord-mk{flex:none;font-weight:800}.ord-slot.right .ord-mk{color:var(--ok)}.ord-slot.wrong .ord-mk{color:var(--blood)}',
      '.ord-pool{display:flex;flex-direction:column;gap:7px;margin-top:12px}.ord-pool[hidden]{display:none}',
      '.ord-opt{text-align:left;font:inherit;font-size:14px;font-weight:800;line-height:1.4;padding:9px 12px;border-radius:14px;border:2.5px solid var(--gline);background:#fff;box-shadow:0 3px 0 var(--glip);cursor:pointer;color:var(--ink)}',
      '.ord-opt:active{transform:translateY(3px);box-shadow:none}',
      '.ord-right{margin:10px 0 0;padding-left:1.4em;display:flex;flex-direction:column;gap:6px}',
      '.ord-right>li{font-size:13.5px}.ord-right>li::marker{font-family:var(--f-mono);font-weight:700;color:var(--accent-t)}',
      '.ord-right ul{margin:2px 0 0;padding-left:1.1em;color:var(--ink-2);font-size:12.5px;line-height:1.55}',
      '.jask{display:block;margin-top:8px;font-size:15px;line-height:1.55}',
      '.ssheet.q .opts{margin-top:4px}',
      '.ssheet.q .opts button{color:var(--ink)}',
      '.jwhy{margin:6px 0 0;font-size:12.5px;color:var(--ink-2)}',
      '.res-rows{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.res-rows li{display:grid;grid-template-columns:3.2em 1.6em minmax(0,1fr);align-items:center;gap:6px;font-size:13.5px;padding:6px 10px;border-radius:12px;background:var(--panel2);border:2px solid var(--line)}',
      '.res-rows li span{font-weight:800}.res-rows li b{font-size:16px;text-align:center}.res-rows li i{font-style:normal;color:var(--ink-2)}',
      '.res-rows li.good b{color:var(--ok)}.res-rows li.soso b{color:var(--warn)}',
      '.res-note{margin-top:12px;display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:14px;background:#FFF4E2;border:2.5px solid var(--gline)}',
      '.res-note i{font-style:normal;font-size:11px;font-weight:800;color:#fff;background:#C8902E;border-radius:999px;padding:1px 10px;align-self:flex-start}',
      '.res-note b{font-size:15px}.res-note span{font-size:13px;line-height:1.6;color:var(--ink-2)}',
      '.expd{display:inline-block;font-style:normal;font-size:11px;font-weight:800;color:#0B8F66;background:#E8FBF3;border:1.5px solid #0B8F66;border-radius:999px;padding:0 8px;line-height:1.6;margin-left:4px;vertical-align:1px;white-space:nowrap}',
      '.res-note .expd{align-self:flex-start;margin:4px 0 0}',
      '.ed{text-align:center}.ed h2{font-size:24px}.ed-kick{margin:0;font:400 14px/1.3 var(--f-logo);color:var(--accent-t);letter-spacing:.06em}',
      '.ed-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;text-align:left}',
      '.ed-list li{display:grid;grid-template-columns:1.8em minmax(0,1fr);gap:2px 6px;align-items:center;padding:6px 10px;border-radius:12px;background:var(--panel2);border:2px solid var(--line)}',
      '.ed-list li b{font-size:14px}.ed-list li i{grid-column:2;font-style:normal;font-size:12px;color:var(--ink-3)}',
      '.ed-mk{grid-row:1/3;font-size:18px;font-weight:800;text-align:center}.ed-mk.ok{color:var(--ok)}.ed-mk.so{color:var(--warn)}',
      '.ed .res-note{text-align:left}',
      '.hub-top{position:relative;padding-right:118px;overflow:hidden;min-height:170px}',
      '.hub-doc{position:absolute;right:-4px;bottom:-40px;height:200px;width:auto;pointer-events:none}',
      '.hub-me{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 0}.hub-me b{font-size:16px}.hub-me i{font-style:normal;font-size:12px;font-weight:800;color:#fff;background:var(--blue);border-radius:999px;padding:1px 10px}',
      '.hub-prog{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;font-weight:800;color:var(--ink-2)}',
      '.hub-prog .bar2{flex:1;height:12px;border-radius:999px;background:#F3E6EC;border:2px solid var(--gline);overflow:hidden}.hub-prog .bar2 i{display:block;height:100%;background:linear-gradient(90deg,#FF5E8A,#FFB020 45%,#12C48B)}',
      '.ep-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}',
      '.ep-row{width:100%;display:grid;grid-template-columns:88px minmax(0,1fr) auto;align-items:center;gap:8px;text-align:left;padding:8px 10px;border-radius:14px;border:2.5px solid var(--gline);background:#fff;box-shadow:0 3px 0 var(--glip);cursor:pointer;color:var(--ink);font:inherit}',
      '.ep-row:active{transform:translateY(3px);box-shadow:none}.ep-row:disabled{cursor:default;opacity:.55;box-shadow:none;transform:none}',
      '.ep-row.now{background:var(--accent-soft);border-color:var(--accent-t)}.ep-row.done{background:linear-gradient(90deg,rgba(43,217,160,.14),#fff 70%)}',
      '.ep-day{font-size:12px;font-weight:800;line-height:1.3;color:#fff;background:#4FA8FF;border:2px solid var(--gline);border-radius:10px;padding:3px 6px;text-align:center}.ep-day.night{background:#4B3F8F}',
      '.ep-t{min-width:0}.ep-t b{display:block;font-size:14.5px;line-height:1.35}.ep-t i{display:block;font-style:normal;font-size:11px;line-height:1.45;color:var(--ink-3);font-weight:700}',
      '.ep-tag{font-size:11.5px;font-weight:800;white-space:nowrap;padding:2px 8px;border-radius:999px;border:2px solid var(--gline);background:#fff}',
      '.ep-row.done .ep-tag{background:var(--ok);color:#fff}.ep-row.cur .ep-tag{background:var(--accent-t);color:#fff}',
      '.nb-lead{margin-bottom:8px}.nbtabs{display:flex;gap:6px;margin-bottom:10px}',
      '.nbtab{flex:1 1 0;min-width:0;padding:7px 4px;border-radius:12px;border:2.5px solid var(--gline);background:#fff;font:inherit;font-size:13px;font-weight:800;color:var(--ink-2);cursor:pointer}',
      '.nbtab.on{background:#C8902E;color:#fff}',
      '.nblist{display:flex;flex-direction:column;gap:8px}',
      '.nbitem{border-radius:14px;border:2.5px solid var(--gline);padding:9px 12px;background:#fff}',
      '.nbitem.locked{opacity:.6;border-style:dashed;background:transparent}',
      '.nbh{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.nbh b{flex:1;min-width:0;font-size:14.5px}',
      '.nbday{font-size:11px;font-weight:800;color:#fff;background:#4FA8FF;border-radius:999px;padding:1px 8px}',
      '.nbmk{font-weight:800;color:var(--warn)}.nbmk.ok{color:var(--ok)}',
      '.mbody .nbitem p{margin:4px 0 0;font-size:13px;line-height:1.6}.mbody .nbitem p.nbsub{font-size:11.5px;color:var(--ink-3);font-weight:700}',
      '.nbhint{font-size:12.5px;color:var(--ink-3)}',
      '.nbgo{margin-top:6px}',
      '.nbchap{margin-top:4px}.nbchap>b{display:block;font-size:13px;color:#fff;background:var(--chap);border:2px solid var(--gline);border-radius:10px;padding:2px 10px}',
      '.nbchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}',
      '.nbchip{font:inherit;font-size:12px;font-weight:700;line-height:1.35;padding:3px 10px;border-radius:999px;border:2px solid #D8CCE4;background:#fff;color:var(--ink-3);cursor:pointer;text-align:left}',
      '.nbchip.got{border-color:var(--gline);background:var(--ok-soft);color:var(--ok);font-weight:800}',
      '.rd-list{display:flex;flex-direction:column;gap:6px;margin-top:8px}',
      '.rd-row{display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:7px 12px;border-radius:12px;border:2.5px solid var(--gline);background:#fff;font:inherit;cursor:pointer;color:var(--ink)}',
      '.rd-row span{font-size:11px;font-weight:800;color:var(--ink-3)}.rd-row b{font-size:14px}.rd-row.locked{opacity:.5;border-style:dashed;cursor:default}',
      '.sname-row{display:flex;gap:8px;margin:10px 0}',
      '.who-roles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}',
      /* タイトルのボタンが 4 つになったぶん、立ち絵を少し小さくして進み具合の帯まで 1 画面に収める */
      '.tstage:has(.tbtn[data-t="story"]){gap:8px}',
      '.tstage:has(.tbtn[data-t="story"]) .tcast{height:clamp(110px,19vh,190px)}',
      '.tstage:has(.tbtn[data-t="story"]) .tmenu{gap:8px}',
      '.tstage:has(.tbtn[data-t="story"]) .tbtn{padding-top:7px;padding-bottom:7px}',
      '.tstage:has(.tbtn[data-t="story"]) .tbtn img{width:40px;height:40px}',
      /* ---- 背景の切り替え・場面の出入り ---- */
      '.sbg.swap{animation:bgSwap .55s ease}',
      '@keyframes bgSwap{from{filter:blur(6px) brightness(1.08);transform:scale(1.03)}to{filter:none;transform:none}}',
      '.story.banded .sbg::after{background:linear-gradient(180deg,rgba(46,37,69,.30) 0%,rgba(255,240,244,.10) 40%,rgba(46,37,69,.42) 100%)}',
      '.story.banded .sstage{top:calc(var(--sbT) + var(--sbH) + 2px)}',
      '.story.banded .sfig.mascot{height:52%}',
      '.sbox.enter{animation:sboxIn .32s cubic-bezier(.2,1.2,.4,1)}',
      '@keyframes sboxIn{from{transform:translate(-50%,16px);opacity:0}to{transform:translateX(-50%);opacity:1}}',
      '.spanel .sin{animation:sinIn .34s cubic-bezier(.2,1,.4,1) both}',
      '@keyframes sinIn{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}',
      /* ---- 上の帯（イベント CG／患者さんの場面） ---- */
      '.sband{position:absolute;z-index:4;top:var(--sbT);left:50%;transform:translateX(-50%);width:var(--sbW);height:var(--sbH);border-radius:18px;overflow:hidden;border:3px solid var(--gline);background:#3A3158;box-shadow:0 5px 0 rgba(46,37,69,.3),0 16px 34px rgba(20,10,40,.32);pointer-events:none}',
      '.sband[hidden]{display:none}',
      '.sband.swap>*{animation:bandIn .45s ease}',
      '@keyframes bandIn{from{opacity:0;transform:scale(1.03)}to{opacity:1;transform:none}}',
      '.story.carded .sband{animation:cardBand .7s cubic-bezier(.2,1.1,.4,1)}',
      '@keyframes cardBand{from{opacity:0;transform:translate(-50%,-14px) scale(.96)}to{opacity:1;transform:translateX(-50%)}}',
      '.cg-img,.cg-ph{position:absolute;inset:0;background-color:#3A3158;background-size:cover;background-position:center;background-repeat:no-repeat}',
      '.cg-img{animation:kb 18s ease-in-out infinite alternate}',
      '@keyframes kb{from{transform:scale(1.02)}to{transform:scale(1.08) translate(-1%,-1%)}}',
      '.cg-ph::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 38%,rgba(255,250,244,.0) 35%,rgba(46,37,69,.32) 100%)}',
      '.story[data-night="1"] .cg-ph::after{background:linear-gradient(180deg,rgba(14,18,60,.5),rgba(20,16,56,.62))}',
      '.cg-plate{position:absolute;z-index:1;left:50%;bottom:12px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;max-width:calc(100% - 24px);background:rgba(255,253,248,.94);border:3px solid var(--gline);border-radius:16px;padding:4px 18px 6px;box-shadow:0 4px 0 rgba(46,37,69,.28)}',
      '.cg-plate i{font-style:normal;font-size:11px;font-weight:800;line-height:1.4;color:var(--accent-t);letter-spacing:.06em}',
      '.cg-plate b{font:400 clamp(17px,5vw,22px)/1.25 var(--f-logo);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
      '.sband.talk{box-shadow:0 0 0 4px #B79BFF,0 5px 0 rgba(46,37,69,.3),0 16px 34px rgba(20,10,40,.32)}',
      '.sband.talk .sc-plate{animation:talk 1.1s ease-in-out infinite}',
      '@keyframes talk{50%{transform:translateY(-3px)}}',
      /* ---- 業務の場面（帯と、業務の札の上） ---- */
      '.sscene{position:relative;overflow:hidden;background:#FFF1E4;display:block}',
      '.sscene.in-band{position:absolute;inset:0}',
      '.tk-head.has-scene{border-left-width:3px;border-left-color:var(--gline);padding-top:0;overflow:hidden}',
      '.sscene.in-panel{height:196px;margin:0 -14px 10px;border-bottom:3px solid var(--gline)}',
      '.sscene.in-panel.compact{height:150px}',
      '.sc-bg{position:absolute;inset:-2px;background-size:cover;background-position:center;background-color:#FFE9DA}',
      '.sc-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,250,244,.05) 50%,rgba(46,37,69,.22))}',
      '.story[data-night="1"] .sc-bg::after{background:linear-gradient(180deg,rgba(14,18,60,.42),rgba(20,16,56,.55))}',
      '.sc-pt{position:absolute;z-index:2;left:2%;bottom:-5%;height:110%;aspect-ratio:1/1;display:block}',
      '.in-band .sc-pt{left:50%;transform:translateX(-50%)}',
      '.sc-ptimg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 100%;filter:drop-shadow(0 6px 8px rgba(40,20,70,.28))}',
      '.sc-bed{position:absolute;left:7%;right:7%;top:12%;bottom:14%;display:grid;place-items:center;background:rgba(255,255,255,.8);border:2.5px solid rgba(46,37,69,.5);border-radius:18px;box-shadow:0 4px 0 rgba(46,37,69,.14)}',
      '.sc-bed svg{width:86%;height:auto;margin-top:-14%}',
      '.sc-state{position:absolute;top:6px;left:50%;transform:translateX(-50%);font-style:normal;font-size:10.5px;font-weight:800;line-height:1.5;color:#3557D6;background:var(--blue-soft);border:2px solid #9FB3FF;border-radius:999px;padding:0 8px;white-space:nowrap}',
      '.sc-item{position:absolute;left:12%;right:12%;top:16%;bottom:20%;display:grid;place-items:center;background:rgba(255,255,255,.88);border:2.5px solid var(--gline);border-radius:20px;box-shadow:0 4px 0 rgba(46,37,69,.2)}',
      '.sc-item svg{width:54%;height:54%}',
      '.sc-plate{position:absolute;z-index:3;left:6%;bottom:calc(5% + 8px);display:flex;flex-direction:column;max-width:150%;background:#fff;border:2.5px solid var(--gline);border-radius:12px;padding:1px 10px 2px;box-shadow:0 3px 0 rgba(46,37,69,.25);white-space:nowrap;line-height:1.35}',
      '.sc-pt.has-img .sc-plate{left:0}',
      '.sc-plate b{font-size:13px;font-weight:800;color:var(--ink)}.sc-plate i{font-style:normal;font-size:10.5px;font-weight:700;color:var(--ink-3)}',
      '.sc-chips{position:absolute;z-index:5;left:8px;top:8px;max-width:46%;display:flex;flex-direction:column;align-items:flex-start;gap:4px}',
      '.sc-chip{max-width:100%;overflow:hidden;text-overflow:ellipsis}',
      '.sc-chip{font-size:11.5px;font-weight:800;line-height:1.55;padding:0 9px;border-radius:999px;background:#fff;color:var(--ink);border:2px solid var(--gline);box-shadow:0 2px 0 rgba(46,37,69,.22);white-space:nowrap}',
      '.sc-chip.bad{background:#F0446A;color:#fff}.sc-chip.ok{background:#0FA372;color:#fff}',
      '.sc-doc{position:absolute;z-index:3;right:2%;bottom:-44%;height:150%;width:auto;filter:drop-shadow(0 4px 6px rgba(60,30,80,.22))}',
      '.sc-ns{position:absolute;z-index:1;right:23%;bottom:-52%;height:136%;width:auto;filter:drop-shadow(0 4px 6px rgba(60,30,80,.18))}',
      '.sc-puku{position:absolute;z-index:4;right:31%;top:10px;height:52px;width:auto;animation:scFloat 3s ease-in-out infinite}',
      '.compact .sc-puku{height:44px;top:6px}',
      '.sc-puku.hop{animation:scHop .6s cubic-bezier(.2,1.6,.4,1),scFloat 3s ease-in-out .6s infinite}',
      '@keyframes scFloat{50%{transform:translateY(-6px)}}',
      '@keyframes scHop{0%{transform:scale(.8) translateY(8px)}60%{transform:scale(1.12) translateY(-6px)}100%{transform:none}}',
      /* ---- 結果・勤務の終わり・勤務表 ---- */
      '.res-badge{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin:0 0 2px}',
      '.res-badge b{font:400 25px/1.2 var(--f-logo);color:#fff;-webkit-text-stroke:5px var(--gline);paint-order:stroke fill;letter-spacing:.04em;text-shadow:0 3px 0 rgba(46,37,69,.25)}',
      '.res-badge.perfect b{color:#FFC53D}',
      '.res-stars{display:flex;gap:2px}.res-stars i{font-style:normal;font-size:24px;line-height:1;color:#FFB020;-webkit-text-stroke:1.5px var(--gline)}.res-stars i.off{color:#EFE5DC}',
      '.res-badge.pop{animation:badgePop .55s cubic-bezier(.2,1.5,.4,1)}',
      '.res-badge.pop .res-stars i{animation:starIn .4s cubic-bezier(.2,1.6,.4,1) both}.res-badge.pop .res-stars i:nth-child(2){animation-delay:.12s}.res-badge.pop .res-stars i:nth-child(3){animation-delay:.24s}',
      '@keyframes badgePop{from{transform:scale(.7);opacity:0}to{transform:none;opacity:1}}',
      '@keyframes starIn{from{transform:scale(0) rotate(-30deg)}to{transform:none}}',
      '.ed{overflow:hidden}.ed-cg{position:relative;aspect-ratio:16/9;margin:-14px -14px 12px;border-bottom:3px solid var(--gline);overflow:hidden;background:#3A3158}',
      '.ed-score{display:flex;align-items:baseline;justify-content:center;gap:6px;margin:4px 0 0}.ed-score span{font-size:12px;font-weight:800;color:var(--ink-3)}.ed-score b{font-size:30px;line-height:1;color:var(--accent-t)}.ed-score i{font-style:normal;font-size:16px;color:var(--ink-3)}',
      '.ep-thumb{position:relative;display:block;width:88px;aspect-ratio:16/9;border-radius:10px;overflow:hidden;border:2px solid var(--gline);background:linear-gradient(135deg,#9FD3FF 0%,#4FA8FF 55%,#FFB3C8 100%)}',
      '.ep-thumb.night{background:linear-gradient(135deg,#2A2F6B 0%,#4B3F8F 55%,#8B6BFF 100%)}',
      '.ep-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
      '.ep-thumb i{position:absolute;inset:0;display:grid;place-items:center;font-style:normal;font-size:11.5px;font-weight:800;line-height:1.25;color:#fff;text-align:center;padding:2px;text-shadow:0 1px 2px rgba(30,20,50,.55)}',
      '.ep-thumb.has i{inset:auto 0 0 0;display:block;font-size:10px;padding:8px 2px 1px;background:linear-gradient(transparent,rgba(30,20,50,.72))}',
      '.ep-row.lock .ep-thumb,.ep-row.wait .ep-thumb{filter:grayscale(.85)}',
      '.hub-top.has-hero{padding-top:0}.hub-hero{display:block;aspect-ratio:16/9;margin:0 -14px 10px;border-bottom:3px solid var(--gline);overflow:hidden;margin-right:-132px}',
      '.hub-hero img{display:block;width:100%;height:100%;object-fit:cover}',
      '.hub-top.has-hero .hub-doc{height:150px;bottom:-30px}',
      '@media (max-height:700px){.sstage{bottom:150px}.stext{font-size:15px;line-height:1.65}.sbox{min-height:124px}}',
      /* ---- 資料（上の帯のボタンと、覆い） ---- */
      '.sref{flex:none;display:inline-flex;align-items:center;gap:3px;font:800 12px/1 var(--f-body);color:var(--ink);background:#FFF8EE;border:2px solid var(--gline);border-radius:999px;padding:0 10px 0 8px;height:34px;cursor:pointer;box-shadow:0 2px 0 rgba(46,37,69,.35)}',
      '.sref svg{width:15px;height:15px;color:#3557D6}.sref:active{transform:translateY(2px);box-shadow:none}.sref[hidden]{display:none}',
      '.rv{position:fixed;inset:0;z-index:98;cursor:default;color:var(--ink);font:500 15px/1.7 var(--f-body);-webkit-tap-highlight-color:transparent}',
      '.rv[hidden]{display:none}',
      '.rv-bd{position:absolute;inset:0;background:rgba(40,26,58,.5)}',
      '.rv-sheet{position:absolute;left:50%;transform:translateX(-50%);bottom:0;top:max(30px,calc(env(safe-area-inset-top,0px) + 12px));width:min(640px,100%);display:flex;flex-direction:column;background:var(--bg,#FFF3E4);border:3px solid var(--gline);border-bottom:0;border-radius:22px 22px 0 0;box-shadow:0 -10px 34px rgba(20,10,40,.35);overflow:hidden}',
      '.rv-head{flex:none;background:#fff;border-bottom:3px solid var(--gline);padding:10px 12px 10px;display:flex;flex-direction:column;gap:8px;box-shadow:0 3px 0 rgba(46,37,69,.1)}',
      '.rv-bar{display:flex;align-items:center;gap:8px;min-width:0}',
      '.rv-kick{flex:none;font-size:11px;font-weight:800;color:#fff;background:#3557D6;border:2px solid var(--gline);border-radius:999px;padding:1px 8px;line-height:1.5}',
      '.rv-bar h2{flex:1;min-width:0;margin:0;font-size:17px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.rv-bar .badge[hidden]{display:none}',
      '.rv-x{flex:none;width:36px;height:36px;border-radius:50%;border:2.5px solid var(--gline);background:#fff;color:var(--ink);font:800 16px/1 var(--f-body);display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 0 var(--glip)}',
      '.rv-x:active{transform:translateY(2px);box-shadow:none}',
      '.rv-mods{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin:0 -12px;padding:2px 12px 4px}',
      '.rv-mods::-webkit-scrollbar{display:none}.rv-mods[hidden]{display:none}',
      '.rv-mods .chip{flex:none;white-space:nowrap;margin:0;font-size:12.5px;display:inline-flex;align-items:center;gap:4px}',
      '.rv-mods .chip[aria-pressed="true"]{background:var(--chap);color:#fff}',
      '.rv-now{font-style:normal;font-size:10px;font-weight:800;line-height:1.4;color:#fff;background:#E0457A;border-radius:999px;padding:0 5px}',
      '.rv-tabs button{font-size:13px;padding:5px 2px;white-space:nowrap}',
      '.rv-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:12px 12px calc(24px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:12px;-webkit-user-select:text;user-select:text}',
      '.rv-body>*{flex:none;min-width:0}.rv-fparts>.sec{display:flex;flex-direction:column;gap:12px;margin:0;padding:0}',
      '.rv-sec{padding:14px}.rv-h{margin:0;font-size:16px}',
      '.rv-steps{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column}',
      '.rv-steps>li{padding:4px 0 14px;border-bottom:2px dashed var(--line)}.rv-steps>li:last-child{border-bottom:0;padding-bottom:0}',
      '.rv-steps .stephead h3{margin:0;font-size:16px;line-height:1.35;min-width:0}',
      '.rv-steps .do{font-size:14px;line-height:1.6}.rv-steps .do li{margin:2px 0;overflow-wrap:anywhere}',
      '.rv-why{margin-top:8px;padding:8px 12px;border-radius:14px;background:var(--panel2);border:2.5px solid var(--gline);font-size:13.5px;line-height:1.65}',
      '.rv-why b{display:inline-block;margin-right:6px;font-size:11px;font-weight:800;color:#fff;background:var(--ok,#12A877);border-radius:999px;padding:0 8px;line-height:1.6;vertical-align:1px}',
      '.rv-cards{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.rv-cards li{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:14px;background:var(--panel2);border:2px solid var(--line)}',
      '.rv-cards img{flex:none;width:68px;height:52px;object-fit:contain;border-radius:8px;background:#fff;border:1.5px solid var(--line)}',
      '.rv-cards div{min-width:0}.rv-cards b{display:block;font-size:14px;line-height:1.4}.rv-cards p{margin:2px 0 0;font-size:13px;line-height:1.55;color:var(--ink-2);overflow-wrap:anywhere}',
      '.rv-over{display:block;width:100%;max-height:200px;object-fit:contain;margin-top:8px;border-radius:12px;background:#f6f6f3}',
      '.rv-kit{list-style:none;margin:6px 0 0;padding:0}.rv-kit li{padding:7px 2px;border-bottom:2px dashed var(--line);font-size:14px;line-height:1.5}.rv-kit li:last-child{border-bottom:0}',
      '.rv-kit b{font-weight:700}.rv-kit small{display:block;color:var(--ink-3);font-size:12px}',
      '.rv-text{margin-top:8px;font-size:14px}',
      '.rv-body .tablewrap{max-width:100%}.rv-body .chg{overflow-wrap:anywhere}',
      '.rv-fparts .check input:disabled{opacity:.35}.rv-fparts .check label{cursor:default}',
      '.rv-fig iframe{display:block;width:100%;border:0;background:#f2f2ef}',
      '.rv.in .rv-bd{animation:rvFade .2s ease-out}.rv.in .rv-sheet{animation:rvUp .3s cubic-bezier(.2,1,.4,1)}',
      '@keyframes rvFade{from{opacity:0}to{opacity:1}}',
      '@keyframes rvUp{from{transform:translate(-50%,40px);opacity:0}to{transform:translateX(-50%);opacity:1}}',
      '@media (max-width:360px){.sref{padding:0 8px 0 6px}.sref svg{display:none}}',
      '@media (prefers-reduced-motion:reduce){.rv.in .rv-bd,.rv.in .rv-sheet{animation:none}}',
      '@media (prefers-reduced-motion:reduce){.sfig.enter,.sfig.duo .cs.in,.scard,.snext,.scard::after,.sbg.swap,.sbox.enter,.spanel .sin,.sband,.sband.swap>*,.cg-img,.sband.talk .sc-plate,.sc-puku,.sc-puku.hop,.res-badge.pop,.res-badge.pop .res-stars i{animation:none}}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'storyCss'; st.textContent = css;
    document.head.appendChild(st);
  }
  /* 手技の一覧の「現場で経験」の札にも同じ見た目を使うので、最初に入れておく。 */
  if (document.head) injectCss(); else document.addEventListener('DOMContentLoaded', injectCss);
})();
