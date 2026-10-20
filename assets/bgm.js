/* 「触って覚える！」シリーズ共通の BGM。こどもの人工呼吸器トレーニング（VentSim）の bgm.js を流用した。
 * 2026-10-17: 人工呼吸器ゲームの Suno の曲（title・day・night・alarm・morning・epilogue）とジングル 2 つを assets/bgm/ に入れて使う。
 *   FILES は人工呼吸器ゲームの assets/bgm/bgm.json と同じ値。iPhone 版（file://）は XMLHttpRequest で読む（WKWebView の allowFileAccessFromFileURLs）。
 *   読めないときは今までどおり合成の曲に落ちる。
 * 保存キーは手技マスター用。以下は元の説明。 */
/* VentSim — BGM。タイトルの曲、昼の曲・夜の曲、アラームの曲の 4 曲を、音のファイルを持たずにその場で合成する。
 *
 *   title … タイトル。ハ長調・118 BPM。弾むベース、裏拍で跳ねるエレピ、マリンバの旋律が頭から鳴る。
 *            後半はオルゴールが旋律を 1 オクターブ上で重ねる。明るく元気に迎える。
 *
 *   day   … 昼。ハ長調・88 BPM。エレピの和音（王道進行 Fmaj7→G→Em7→Am7）、やわらかいベース、
 *            うしろで小さなシェイカー。後半 8 小節でマリンバの旋律が入る。明るく、でも忙しくない。
 *   night … 夜。ハ長調・72 BPM。ゆっくり立ち上がるパッド、低いベース、オルゴールの高い音がぽつぽつ。
 *            後半 8 小節でオルゴールの旋律。静かで、でも不穏にならない夜のナースステーション。
 *   alarm … アラームが鳴っているあいだだけ。イ短調・100 BPM。8 分で刻むベース、パッド、マリンバの分散和音、
 *            後半 8 小節でオルゴールの旋律。暗く緊迫した曲はこれだけにする。
 * どれも 16 小節で継ぎ目なくループする（音の尾と残響は先頭へ回り込ませてある）。
 *
 * 録音した曲（Suno で作った曲）があれば、合成の代わりにそれを流す。assets/bgm/bgm_<曲>.m4a（44.1 kHz・ステレオ）。
 * 小節の頭で切ってループにしてあり、音量は合成の曲にそろえてある。FILES は曲ごとのフレーム数で、
 * AAC の末尾に付く詰め物を切り落とすのに使う（assets/bgm/bgm.json と同じ値。test.js が確かめる）。
 * 読めない（file:// で開いた・ファイルが無い）ときは合成の曲に落ちる。
 *
 * 流す場所と時刻（app.js が決め、VentBGM.want(track) で伝える）
 *   タイトル … タイトルの曲（title）
 *   物語の幕 … 幕ごとの時刻（story.js の time）。午後 8 時の扉なら夜、夜明けなら昼。
 *   レッスン … 章の時刻（story.js の CHAPTER_TIME）。第1章＝初日の夜、第5章＝当直の夜、ほかは昼。
 *   症例で練習 … 端末の時計。6 時〜17 時台は昼、それ以外は夜。
 *   レッスン・症例でアラーム（黄・赤）が出ているあいだ … アラームの曲。消音の 2 分間もアラームが続くあいだはそのまま。
 *     アラームが HOLD 秒続けて消えたら元の曲へ戻る。
 * 切り替えは 2.5 秒のクロスフェード。
 *
 * 聞き分けを損なわないために
 *   - 音量はアラームやパルス音よりずっと小さい（GAIN）。アラームが鳴っているあいだはさらに下げる（DUCK）。
 *   - 旋律はアラーム（ド・ラ・ファ＝349〜523 Hz）の音域を避け、昼は 1 オクターブ上、夜とアラームの曲は 2 オクターブ上で鳴らす。
 *   - パルス音と同じ短い純音は使わない（エレピ・マリンバ・オルゴールは倍音と残響を持つ）。
 * 音全体（VentSound）を切ると BGM も止まる。BGM だけを切ることもできる（メニュー、ventsim.bgm.v1）。
 *
 * 合成はデータ（SONGS・INST）と render() だけで決まり、node でも同じ波形が作れる。
 * iPhone 版は web/tools/bgm-swift.js がこの楽譜と音色を App/BGMScore.swift に書き出し、
 * App/BGMPlayer.swift が同じ手順で合成する（web/test.js の 27 番が一致を確かめる）。
 */
(function (root) {
  'use strict';

  var KEY = 'shugi.bgm.v1';
  var RATE = 24000;          // BGM は 24 kHz で作る（メモリを抑える。中身は 8 kHz より下）
  var FILES = { title: 3617874, day: 4330165, night: 3041544, alarm: 1693495, morning: 1746120, epilogue: 3512661 }, FILE_RATE = 44100;
  /* 録音しかない曲が読めないときに代わりに合成する曲。 */
  var FALLBACK = { breath: 'day', nicu: 'night', memory: 'night', epilogue: 'day', morning: 'day', urgent: 'day', dawn: 'day', notebook: 'day' };
  var GAIN = 0.15;           // 仕上がりのピークを 0.8 にそろえたうえで掛ける（ピーク 0.12）。パルス音 0.16・アラーム 0.26〜0.34 より小さい
  var DUCK = 0.5;            // アラームが鳴っているあいだの倍率（アラームの曲ごと下げる）
  var FADE = 2.5;            // 曲の切り替え（秒）
  var HOLD = 3;              // アラームが消えてから元の曲へ戻るまで（秒）

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /* ---- 音色 ----
   * kind: fm（エレピ）/ mallet（マリンバ・オルゴール）/ bass / pad / noise
   * a = 立ち上がり、tau = 減衰の時定数、rel = 音の終わりからの消え方（すべて秒）、pan は -1（左）〜 1（右） */
  var INST = {
    ep:     { kind: 'fm', a: 0.006, tau: 1.3, rel: 0.35, gain: 0.16, pan: -0.18, index: 1.5, indexTau: 0.4, indexBase: 0.2 },
    mallet: { kind: 'mallet', a: 0.003, tau: 0.55, rel: 0.2, gain: 0.20, pan: 0.28, partial: 4, partialGain: 0.3, partialTau: 0.06 },
    box:    { kind: 'mallet', a: 0.002, tau: 1.4, rel: 0.4, gain: 0.13, pan: 0.3, partial: 3, partialGain: 0.25, partialTau: 0.25 },
    bass:   { kind: 'bass', a: 0.02, tau: 1.8, rel: 0.12, gain: 0.30, pan: 0 },
    pad:    { kind: 'pad', a: 1.4, tau: 0, rel: 1.6, gain: 0.06, pan: 0, detune: 7 },
    shaker: { kind: 'noise', a: 0.002, tau: 0.035, rel: 0.02, gain: 0.05, pan: 0.4 }
  };

  /* ---- 楽譜 ----
   * 和音は小節ごと [ベースの音, [和音の音…]]（MIDI 番号）。旋律は [拍, 音, 長さ（拍）]、拍は曲の頭から数える。 */
  var DAY_CHORDS = [
    [41, [57, 60, 64, 67]],   // Fmaj7(9)
    [43, [59, 62, 64, 67]],   // G6
    [40, [55, 59, 62, 64]],   // Em7
    [45, [57, 60, 64, 67]],   // Am7
    [50, [57, 60, 62, 65]],   // Dm7
    [43, [59, 62, 65, 67]],   // G7
    [48, [55, 59, 60, 64]],   // Cmaj7
    [45, [55, 57, 60, 64]]    // Am7
  ];
  var DAY_MELODY = [   // 後半 8 小節（33 拍目から）。C ペンタトニック。アラームの最高音（ド = C5）には降りない
    [0, 81, 1.5], [1.5, 79, 0.5], [2, 76, 1], [3, 76, 1],
    [4, 74, 1.5], [5.5, 76, 0.5], [6, 79, 2],
    [8, 79, 1], [9, 76, 1], [10, 74, 1], [11, 76, 1],
    [12, 76, 3], [15.5, 79, 0.5],
    [16, 81, 1], [17, 84, 1], [18, 81, 0.5], [18.5, 79, 0.5], [19, 81, 1],
    [20, 79, 2], [22, 74, 1], [23, 76, 1],
    [24, 76, 1.5], [25.5, 74, 0.5], [26, 76, 1], [27, 74, 1],
    [28, 76, 3]
  ];

  var NIGHT_CHORDS = [  // ハ長調。暗くならないよう短調の和音で終わらず、G7sus4 から頭の Cmaj9 へ戻る
    [48, [52, 55, 59, 62]],   // Cmaj9
    [48, [52, 55, 59, 62]],
    [41, [53, 57, 60, 64]],   // Fmaj7
    [41, [53, 57, 60, 64]],
    [45, [55, 57, 60, 64]],   // Am7
    [40, [52, 55, 59, 62]],   // Em7
    [41, [53, 57, 60, 64]],   // Fmaj7
    [43, [55, 60, 62, 65]]    // G7sus4
  ];
  var NIGHT_SPARSE = [ // 前半：ぽつぽつと 1 音ずつ（オルゴール、2 オクターブ上）
    [1, 88, 2], [9, 86, 2], [17, 84, 2], [26, 83, 2]
  ];
  var NIGHT_MELODY = [ // 後半 8 小節（33 拍目から）。C ペンタトニックを中心に、ゆっくり下りて上がる
    [0, 88, 1], [1, 86, 1], [2, 84, 2],
    [4, 79, 3], [7.5, 81, 0.5],
    [8, 84, 1], [9, 88, 1], [10, 86, 1.5], [11.5, 84, 0.5],
    [12, 81, 4],
    [16, 84, 1], [17, 81, 1], [18, 79, 2],
    [20, 83, 1], [21, 79, 1], [22, 76, 2],
    [24, 81, 2], [26, 84, 1], [27, 86, 1],
    [28, 86, 3]
  ];

  /* アラームの曲。イ短調・100 BPM。低いベースの 8 分の刻み、パッド、マリンバの分散和音、後半にオルゴールの旋律。
   * 和音はアラームの音（ファ・ラ・ド＝F4〜C5）より下に置き、分散和音と旋律は 2 オクターブ上に逃がす。 */
  var ALARM_CHORDS = [
    [45, [52, 57, 60, 64]],   // Am
    [45, [52, 57, 60, 64]],
    [41, [48, 53, 57, 60]],   // F
    [41, [48, 53, 57, 60]],
    [38, [50, 53, 57, 62]],   // Dm
    [38, [50, 53, 57, 62]],
    [40, [52, 56, 59, 64]],   // E
    [40, [50, 52, 56, 59]]    // E7
  ];
  var ALARM_MELODY = [ // 後半 8 小節（33 拍目から）
    [0, 88, 1.5], [1.5, 89, 0.5], [2, 88, 2],
    [4, 84, 2], [6, 83, 2],
    [8, 84, 1.5], [9.5, 86, 0.5], [10, 84, 2],
    [12, 81, 4],
    [16, 86, 1.5], [17.5, 88, 0.5], [18, 86, 2],
    [20, 81, 2], [22, 77, 2],
    [24, 80, 2], [26, 83, 2],
    [28, 76, 4]
  ];

  var TITLE_CHORDS = [
    [48, [55, 60, 64, 67]],   // C
    [47, [55, 59, 62, 67]],   // G/B
    [45, [57, 60, 64, 69]],   // Am
    [41, [57, 60, 65, 69]],   // F
    [48, [55, 60, 64, 67]],   // C
    [43, [55, 59, 62, 67]],   // G
    [41, [57, 60, 65, 69]],   // F
    [43, [55, 59, 62, 65]]    // G7
  ];
  var TITLE_MELODY = [ // 8 小節（32 拍）。C ペンタトニック、E5 から上（アラームの音域には降りない）
    [0, 76, 0.5], [0.5, 79, 0.5], [1, 84, 1], [2, 81, 0.5], [2.5, 79, 0.5], [3, 76, 1],
    [4, 74, 0.5], [4.5, 76, 0.5], [5, 79, 1], [6, 79, 0.5], [6.5, 81, 0.5], [7, 79, 1],
    [8, 76, 0.5], [8.5, 79, 0.5], [9, 81, 1], [10, 84, 0.5], [10.5, 81, 0.5], [11, 79, 1],
    [12, 81, 1.5], [13.5, 79, 0.5], [14, 76, 2],
    [16, 76, 0.5], [16.5, 79, 0.5], [17, 84, 1], [18, 86, 0.5], [18.5, 84, 0.5], [19, 81, 1],
    [20, 79, 0.5], [20.5, 81, 0.5], [21, 79, 0.5], [21.5, 76, 0.5], [22, 74, 2],
    [24, 81, 0.5], [24.5, 79, 0.5], [25, 76, 1], [26, 79, 0.5], [26.5, 81, 0.5], [27, 84, 1]
  ];
  var TITLE_END_A = [[28, 86, 1], [29, 84, 0.5], [29.5, 86, 0.5], [30, 88, 2]];   // 前半の終わり：上がって次へ
  var TITLE_END_B = [[28, 86, 0.5], [28.5, 84, 0.5], [29, 79, 1], [30, 84, 2]];   // 後半の終わり：ドに落ち着いて頭へ

  var SONGS = {
    title: { bpm: 118, bars: 16, beats: 4, reverb: { feedback: 0.7, damp: 0.3, wet: 0.18 } },
    day: { bpm: 88, bars: 16, beats: 4, reverb: { feedback: 0.76, damp: 0.35, wet: 0.22 } },
    night: { bpm: 72, bars: 16, beats: 4, reverb: { feedback: 0.82, damp: 0.42, wet: 0.3 } },
    alarm: { bpm: 100, bars: 16, beats: 4, reverb: { feedback: 0.72, damp: 0.4, wet: 0.2 } }
  };

  /* 楽譜を音の並びにする。返すのは [{ i: 音色, t: 秒, d: 秒, f: Hz, v: 強さ }]（t の順）。 */
  function score(name) {
    var s = SONGS[name];
    if (!s) return [];
    var b = 60 / s.bpm, out = [];
    function add(inst, beat, midi, len, vel) {
      out.push({ i: inst, t: +(beat * b).toFixed(6), d: +(len * b).toFixed(6), f: +mtof(midi).toFixed(4), v: vel });
    }
    var bar, k, ch, beat0;
    // パッドは和音が変わる小節から、同じ和音のあいだ伸ばす
    function pads(chords, bar, vel) {
      var c = chords[bar % 8], len = 4, j;
      if (bar !== 0 && same(chords[(bar + 7) % 8], c)) return;
      while (bar + len / 4 < s.bars && same(chords[(bar + len / 4) % 8], c)) len += 4;
      for (j = 0; j < 4; j++) add('pad', bar * 4, c[1][j], len, vel);
    }
    if (name === 'title') {
      for (bar = 0; bar < s.bars; bar++) {
        ch = TITLE_CHORDS[bar % 8]; beat0 = bar * 4;
        // エレピ：頭と、2 拍目の裏・3 拍目の裏・4 拍目の裏で短く跳ねる
        for (k = 0; k < 4; k++) add('ep', beat0, ch[1][k], 0.9, 0.7);
        [1.5, 2.5, 3.5].forEach(function (o) { for (k = 0; k < 4; k++) add('ep', beat0 + o, ch[1][k], 0.4, 0.45); });
        // ベース：根音・5 度・オクターブで弾む
        add('bass', beat0, ch[0], 0.9, 0.9);
        add('bass', beat0 + 1.5, ch[0], 0.5, 0.55);
        add('bass', beat0 + 2, ch[0] + 7, 0.9, 0.75);
        add('bass', beat0 + 3, ch[0] + 12, 0.5, 0.6);
        add('bass', beat0 + 3.5, ch[0] + 7, 0.5, 0.55);
        // シェイカー：8 分音符、裏を強く
        for (k = 0; k < 8; k++) add('shaker', beat0 + k * 0.5, 96, 0.25, k % 2 ? 1 : 0.5);
      }
      // 旋律は頭から。後半はオルゴールを 1 オクターブ上に小さく重ねる
      TITLE_MELODY.concat(TITLE_END_A).forEach(function (n) { add('mallet', n[0], n[1], n[2], 0.9); });
      TITLE_MELODY.concat(TITLE_END_B).forEach(function (n) {
        add('mallet', 32 + n[0], n[1], n[2], 0.9);
        add('box', 32 + n[0], n[1] + 12, n[2], 0.35);
      });
    } else if (name === 'day') {
      for (bar = 0; bar < s.bars; bar++) {
        ch = DAY_CHORDS[bar % 8]; beat0 = bar * 4;
        // エレピ：1 拍目と 2 拍目の裏（シンコペーション）。7 小節目の裏は休む
        for (k = 0; k < 4; k++) add('ep', beat0, ch[1][k], 1.5, 0.8);
        if (bar % 8 !== 7) for (k = 0; k < 4; k++) add('ep', beat0 + 2.5, ch[1][k], 1.5, 0.5);
        // ベース：1 拍目に根音、3 拍目の裏に 5 度上
        add('bass', beat0, ch[0], 2.2, 0.9);
        add('bass', beat0 + 2.5, ch[0] + 7, 1.2, 0.6);
        // シェイカー：8 分音符、裏を強く
        for (k = 0; k < 8; k++) add('shaker', beat0 + k * 0.5, 96, 0.25, k % 2 ? 1 : 0.45);
        // 前半はマリンバで和音をなぞる（2 オクターブ上に 1 小節 3 音）
        if (bar < 8) {
          add('mallet', beat0 + 1, ch[1][3] + 12, 0.5, 0.45);
          add('mallet', beat0 + 1.5, ch[1][2] + 12, 0.5, 0.35);
          add('mallet', beat0 + 3.5, ch[1][1] + 12, 0.5, 0.35);
        }
      }
      DAY_MELODY.forEach(function (n) { add('mallet', 32 + n[0], n[1], n[2], 0.9); });
    } else if (name === 'alarm') {
      for (bar = 0; bar < s.bars; bar++) {
        ch = ALARM_CHORDS[bar % 8]; beat0 = bar * 4;
        pads(ALARM_CHORDS, bar, 0.7);
        // ベース：8 分音符で根音を刻み、頭を強く
        for (k = 0; k < 8; k++) add('bass', beat0 + k * 0.5, ch[0], 0.4, k % 2 ? 0.5 : 0.8);
        // マリンバ：上の 3 音を 2 オクターブ上で 8 分の分散和音に（小さく）
        [1, 2, 3, 2, 1, 2, 3, 2].forEach(function (idx, q) { add('mallet', beat0 + q * 0.5, ch[1][idx] + 24, 0.4, q % 4 ? 0.3 : 0.45); });
        // シェイカー：16 分音符で細かく
        for (k = 0; k < 16; k++) add('shaker', beat0 + k * 0.25, 96, 0.15, k % 4 === 2 ? 1 : 0.4);
      }
      ALARM_MELODY.forEach(function (n) { add('box', 32 + n[0], n[1], n[2], 0.9); });
    } else {
      for (bar = 0; bar < s.bars; bar++) {
        ch = NIGHT_CHORDS[bar % 8]; beat0 = bar * 4;
        pads(NIGHT_CHORDS, bar, 0.8);
        // 低いベースを小節の頭に長く
        add('bass', beat0, ch[0], 3.6, 0.7);
        // エレピで和音を 4 分音符でゆっくりなぞる（小さく）
        [0, 2, 1, 3].forEach(function (idx, q) { add('ep', beat0 + q, ch[1][idx], 1.2, 0.32); });
      }
      NIGHT_SPARSE.forEach(function (n) { add('box', n[0], n[1], n[2], 0.8); });
      NIGHT_MELODY.forEach(function (n) { add('box', 32 + n[0], n[1], n[2], 0.9); });
    }
    out.sort(function (a, b2) { return a.t - b2.t; });
    return out;
  }

  function same(a, b) { return a[0] === b[0] && a[1].join() === b[1].join(); }

  function length(name) { var s = SONGS[name]; return s ? s.bars * s.beats * 60 / s.bpm : 0; }

  /* ---- 合成 ----
   * 波形は表引きで作る（Math.sin を毎サンプル呼ばない）。表の中身は iPhone 版と同じ式。 */
  var TABLE = 4096;
  var SINE = new Float32Array(TABLE + 1), SOFTSAW = new Float32Array(TABLE + 1);
  (function () {
    var i, h, x, peak = 0;
    for (i = 0; i <= TABLE; i++) {
      x = i / TABLE;
      SINE[i] = Math.sin(2 * Math.PI * x);
      var s = 0;
      for (h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * h * x) / Math.pow(h, 1.3);
      SOFTSAW[i] = s;
      if (Math.abs(s) > peak) peak = Math.abs(s);
    }
    for (i = 0; i <= TABLE; i++) SOFTSAW[i] /= peak;
  })();
  /* 表を引く。ph は 0〜1 の位相（周期の何割か）。 */
  function look(tab, ph) { return tab[((ph - Math.floor(ph)) * TABLE) | 0]; }

  /* 決まった種の雑音（毎回同じ波形になる）。 */
  function noiseGen(seed) {
    var x = seed >>> 0 || 1;
    return function () { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2147483648 - 1; };
  }

  /* 1 音を L・R に足し込む。ループの長さを超えた分は頭へ回り込む。
   * 音量の形：a 秒で直線に立ち上がり、そこから時定数 tau で減衰（tau = 0 なら平ら）、
   * 長さ d を過ぎたら rel 秒で直線に消える。減衰は毎サンプル同じ倍率を掛けて作る（exp を毎回呼ばない）。 */
  function voiceInto(L, R, n, rate) {
    var p = INST[n.i], N = L.length;
    var start = Math.round(n.t * rate), aN = Math.max(1, Math.round(p.a * rate));
    var dN = Math.round(n.d * rate), relN = Math.max(1, Math.round(p.rel * rate)), count = dN + relN;
    var kb = p.tau > 0 ? Math.exp(-1 / (p.tau * rate)) : 1;
    var amp = p.gain * n.v, gl = Math.sqrt((1 - p.pan) / 2) * amp, gr = Math.sqrt((1 + p.pan) / 2) * amp;
    var inc = n.f / rate, ph = 0, ph2 = 0, ph3 = 0, body = 1, i, j, e, s, sl, sr;
    var up = 1, dn = 1, kx = 1, x = 1, prev = 0, rnd = null;
    if (p.kind === 'pad') { up = Math.pow(2, p.detune / 1200); dn = 1 / up; gl = gr = amp; }
    if (p.kind === 'fm') { kx = Math.exp(-1 / (p.indexTau * rate)); x = p.index; }
    if (p.kind === 'mallet') { kx = Math.exp(-1 / (p.partialTau * rate)); x = p.partialGain; }
    if (p.kind === 'noise') rnd = noiseGen(start + 1);
    // 音色ごとに別のループにする（ループの中で分岐しないほうが速い）
    function envAt(i) {
      var v = i < aN ? i / aN : body;
      if (i >= aN) body *= kb;
      return i >= dN ? v * (1 - (i - dN) / relN) : v;
    }
    var TWO_PI = 2 * Math.PI, ib = p.indexBase, pg = p.partial, sw = 1;
    for (i = 0; i < count; i++) {
      e = envAt(i);
      j = start + i; if (j >= N) j -= N * Math.floor(j / N);
      switch (p.kind) {
        case 'fm':
          s = look(SINE, ph + (x + ib) * SINE[(ph * TABLE) | 0] / TWO_PI);
          x *= kx; ph += inc; if (ph >= 1) ph -= 1;
          break;
        case 'mallet':
          s = SINE[(ph * TABLE) | 0] + x * SINE[(ph2 * TABLE) | 0];
          x *= kx; ph += inc; if (ph >= 1) ph -= 1;
          ph2 += inc * pg; if (ph2 >= 1) ph2 -= Math.floor(ph2);
          break;
        case 'bass':
          s = SINE[(ph * TABLE) | 0] + 0.35 * SINE[(ph2 * TABLE) | 0] + 0.12 * SINE[(ph3 * TABLE) | 0];
          ph += inc; if (ph >= 1) ph -= 1;
          ph2 += 2 * inc; if (ph2 >= 1) ph2 -= 1;
          ph3 += 3 * inc; if (ph3 >= 1) ph3 -= 1;
          break;
        case 'pad':
          // 2 本を少しずらして左右に広げる
          sl = SOFTSAW[(ph * TABLE) | 0]; sr = SOFTSAW[(ph2 * TABLE) | 0];
          ph += inc * up; if (ph >= 1) ph -= 1;
          ph2 += inc * dn; if (ph2 >= 1) ph2 -= 1;
          L[j] += (sl * 0.8 + sr * 0.2) * e * gl; R[j] += (sr * 0.8 + sl * 0.2) * e * gr;
          continue;
        default:
          sw = rnd(); s = sw - prev; prev = sw;   // 差分で低い成分を落とす
      }
      L[j] += s * e * gl; R[j] += s * e * gr;
    }
  }

  /* 簡単な残響（くし形 4 本＋全域通過 2 本）。ループの継ぎ目が切れないよう、2 周回して 2 周目を使う。 */
  var COMBS = [0.0297, 0.0371, 0.0411, 0.0437], ALLPASS = [0.005, 0.0017], SPREAD = 0.0011;
  function Reverb(rate, rv, spread) {
    var k;
    this.cb = []; this.cp = [0, 0, 0, 0]; this.lp = [0, 0, 0, 0]; this.ab = []; this.ap = [0, 0];
    for (k = 0; k < 4; k++) this.cb.push(new Float32Array(Math.round((COMBS[k] + spread) * rate)));
    for (k = 0; k < 2; k++) this.ab.push(new Float32Array(Math.round(ALLPASS[k] * rate)));
    this.fb = rv.feedback; this.damp = rv.damp;
  }
  /* x[from..to) を通す。out があれば書き込む（1 周目は空回しで残響を満たすだけ）。 */
  Reverb.prototype.run = function (x, out, from, to) {
    var cb = this.cb, cp = this.cp, lp = this.lp, ab = this.ab, ap = this.ap, fb = this.fb, damp = this.damp;
    for (var i = from; i < to; i++) {
      var inp = x[i] * 0.25, y = 0, o, buf, k;
      for (k = 0; k < 4; k++) {
        buf = cb[k]; o = buf[cp[k]];
        lp[k] = o * (1 - damp) + lp[k] * damp;
        buf[cp[k]] = inp + lp[k] * fb;
        if (++cp[k] >= buf.length) cp[k] = 0;
        y += o;
      }
      for (k = 0; k < 2; k++) {
        buf = ab[k]; o = buf[ap[k]];
        buf[ap[k]] = y + o * 0.5;
        if (++ap[k] >= buf.length) ap[k] = 0;
        y = o - y * 0.5;
      }
      if (out) out[i] = y;
    }
  };

  /* 1 曲分の波形を少しずつ作る。step(ms) をくり返し呼び、true が返ったら result に { L, R, rate }（ピーク 0.8）。
   * ブラウザでは 1 回 20 ms ほどずつ進めて、画面を止めない。 */
  function Renderer(name, rate) {
    this.rate = rate = rate || RATE;
    this.song = SONGS[name];
    this.notes = score(name);
    this.N = Math.round(length(name) * rate);
    this.L = new Float32Array(this.N); this.R = new Float32Array(this.N);
    this.wl = new Float32Array(this.N); this.wr = new Float32Array(this.N);
    this.rl = new Reverb(rate, this.song.reverb, 0);
    this.rr = new Reverb(rate, this.song.reverb, SPREAD);
    this.stage = 0; this.k = 0; this.i = 0; this.result = null;
  }
  var CHUNK = 12000;
  Renderer.prototype.step = function (budgetMs) {
    var clock = root.performance && root.performance.now ? function () { return root.performance.now(); } : Date.now;
    var t0 = clock(), N = this.N;
    while (!this.result && (budgetMs == null || clock() - t0 < budgetMs)) {
      if (this.stage === 0) {
        if (this.k < this.notes.length) voiceInto(this.L, this.R, this.notes[this.k++], this.rate);
        else this.stage = 1;
      } else if (this.stage <= 2) {
        // 2 周回す。1 周目で残響を満たし、2 周目の出力を使う（ループの頭に前の周の尾が乗る）
        var to = Math.min(N, this.i + CHUNK), keep = this.stage === 2;
        this.rl.run(this.L, keep ? this.wl : null, this.i, to);
        this.rr.run(this.R, keep ? this.wr : null, this.i, to);
        this.i = to;
        if (to >= N) { this.stage++; this.i = 0; }
      } else {
        var L = this.L, R = this.R, wl = this.wl, wr = this.wr, wet = this.song.reverb.wet, peak = 1e-9, i;
        for (i = 0; i < N; i++) {
          L[i] = L[i] * (1 - wet) + wl[i] * wet * 3;
          R[i] = R[i] * (1 - wet) + wr[i] * wet * 3;
          var m = Math.max(Math.abs(L[i]), Math.abs(R[i]));
          if (m > peak) peak = m;
        }
        var g = 0.8 / peak;
        for (i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }
        this.result = { L: L, R: R, rate: this.rate };
        this.wl = this.wr = null;
      }
    }
    return !!this.result;
  };

  /* 1 曲分の波形を一度に作る（node のテスト用）。 */
  function render(name, rate) {
    if (!SONGS[name]) return null;
    var r = new Renderer(name, rate);
    r.step(null);
    return r.result;
  }

  /* ---- どの曲を流すか ---- */
  function clockTrack(date) {
    var h = (date || new Date()).getHours();
    return h >= 6 && h < 18 ? 'day' : 'night';
  }

  /* ---- 再生（ブラウザだけ） ---- */
  var on = true;
  try { on = root.localStorage ? root.localStorage.getItem(KEY) !== 'off' : true; } catch (e) { on = true; }

  var wanted = null, playing = null, ducked = false, hidden = false;
  var cache = {}, bus = null, mbus = null, nodes = {};   // nodes[track] = { src, gain }

  function soundOn() { return !root.VentSound || root.VentSound.enabled(); }
  function level() { return GAIN * (ducked ? DUCK : 1); }

  function context() {
    var S = root.VentSound;
    var io = S && S.audio ? S.audio() : null;
    if (!io) return null;
    if (!bus) {
      bus = io.ctx.createGain(); bus.gain.value = level(); bus.connect(io.master);
      mbus = io.ctx.createGain(); mbus.connect(bus);   // 曲だけの音量（ジングルのあいだ下げる）
    }
    return io.ctx;
  }

  /* 曲を少しずつ作る。できたら AudioBuffer にして cache に入れ、apply し直す。 */
  var jobs = {};
  function prepare(ctx, track) {
    if (cache[track] || jobs[track]) return;
    if (FILES[track]) { loadFile(ctx, track); return; }
    synth(ctx, track);
  }

  /* 音のファイルを ArrayBuffer で読む。http(s) は fetch、file://（iPhone 版）は XMLHttpRequest。 */
  function bytes(url) {
    var page = root.location ? root.location.protocol : 'file:';
    if (page !== 'file:' && root.fetch) return root.fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
    return new Promise(function (ok, ng) {
      if (!root.XMLHttpRequest) { ng(new Error('no xhr')); return; }
      var x = new root.XMLHttpRequest();
      x.open('GET', url); x.responseType = 'arraybuffer';
      x.onload = function () { if ((x.status === 0 || x.status === 200) && x.response && x.response.byteLength) ok(x.response); else ng(new Error(x.status)); };
      x.onerror = function () { ng(new Error('xhr')); };
      x.send();
    });
  }

  /* 録音した曲を読む。頭の詰め物はデコーダが除くので、末尾だけ FILES の長さに切る。 */
  function loadFile(ctx, track) {
    jobs[track] = true;
    bytes('assets/bgm/bgm_' + track + '.mp4')
      .then(function (a) { return ctx.decodeAudioData(a); })
      .then(function (b) {
        var n = Math.round(FILES[track] * b.sampleRate / FILE_RATE);
        if (b.length > n) {
          var c = ctx.createBuffer(b.numberOfChannels, n, b.sampleRate);
          for (var k = 0; k < b.numberOfChannels; k++) c.getChannelData(k).set(b.getChannelData(k).subarray(0, n));
          b = c;
        }
        cache[track] = b;
        delete jobs[track];
        apply();
      })
      .catch(function () { delete jobs[track]; synth(ctx, track); });
  }

  function synth(ctx, track) {
    var job = jobs[track] = new Renderer(SONGS[track] ? track : FALLBACK[track], RATE);
    (function tick() {
      if (!job.step(18)) { setTimeout(tick, 16); return; }
      var w = job.result, b = ctx.createBuffer(2, w.L.length, w.rate);
      b.getChannelData(0).set(w.L); b.getChannelData(1).set(w.R);
      cache[track] = b;
      delete jobs[track];
      apply();
    })();
  }

  function fadeOut(track, ctx) {
    var n = nodes[track];
    if (!n) return;
    delete nodes[track];
    var t = ctx.currentTime;
    n.gain.gain.cancelScheduledValues(t);
    n.gain.gain.setValueAtTime(n.gain.gain.value, t);
    n.gain.gain.linearRampToValueAtTime(0, t + FADE);
    try { n.src.stop(t + FADE + 0.05); } catch (e) { /* 止まっている */ }
  }

  function apply() {
    var target = on && soundOn() && !hidden ? wanted : null;
    if (target === playing) return;
    var ctx = context();
    if (!ctx) return;
    if (ctx.state !== 'running') return;       // 最初に触るまでは鳴らせない。触ったら次の apply で始まる
    if (target && !cache[target]) { prepare(ctx, target); return; }   // できあがったら apply し直す
    if (playing) fadeOut(playing, ctx);
    playing = target;
    if (!target) return;
    var src = ctx.createBufferSource(), g = ctx.createGain(), t = ctx.currentTime;
    src.buffer = cache[target]; src.loop = true;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + FADE);
    src.connect(g); g.connect(mbus);
    src.start(t);
    nodes[target] = { src: src, gain: g };
  }

  /* ジングル（章の扉・手帳に書き留めたとき）。1 回だけ鳴らし、そのあいだ曲を下げる。
   * assets/bgm/bgm_jingle_<名前>.m4a。読めなければ鳴らさない。 */
  var JINGLES = { chapter: true, note: true }, JINGLE_DIP = 0.35, jingles = {};
  /** 鳴らすつもりなら true（読めなかったときは黙る）。false なら呼び出し側がほかの音で代える。 */
  function jingle(name) {
    if (!JINGLES[name] || !on || !soundOn() || hidden) return false;
    var ctx = context();
    if (!ctx || ctx.state !== 'running') return false;
    var play = function (b) {
      var src = ctx.createBufferSource(), t = ctx.currentTime;
      src.buffer = b; src.connect(bus); src.start(t);
      mbus.gain.cancelScheduledValues(t);
      mbus.gain.setValueAtTime(mbus.gain.value, t);
      mbus.gain.linearRampToValueAtTime(JINGLE_DIP, t + 0.15);
      mbus.gain.setValueAtTime(JINGLE_DIP, t + b.duration - 0.6);
      mbus.gain.linearRampToValueAtTime(1, t + b.duration + 0.4);
    };
    if (jingles[name]) { if (jingles[name] !== 'loading') play(jingles[name]); return true; }
    jingles[name] = 'loading';
    bytes('assets/bgm/bgm_jingle_' + name + '.mp4')
      .then(function (a) { return ctx.decodeAudioData(a); })
      .then(function (b) { jingles[name] = b; play(b); })
      .catch(function () { delete jingles[name]; });
    return true;
  }

  /* アラームの曲から戻るのは、アラームが HOLD 秒続けて消えてから（鳴ったり止んだりで曲が行き来しないように）。 */
  var lastAlarm = -1e9;
  function now() { return root.performance && root.performance.now ? root.performance.now() / 1000 : Date.now() / 1000; }

  /** 流したい曲を伝える（'title' / 'day' / 'night' / 'alarm' / null）。毎フレーム呼んでよい。 */
  function want(track) {
    track = SONGS[track] || FILES[track] ? track : null;
    var t = now();
    if (track === 'alarm') lastAlarm = t;
    else if (wanted === 'alarm' && (track === 'day' || track === 'night') && t - lastAlarm < HOLD) return;
    wanted = track;
    apply();
  }

  /** アラームが鳴っているあいだは下げる。 */
  function duck(v) {
    v = !!v;
    if (v === ducked) return;
    ducked = v;
    if (bus) {
      var t = bus.context.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(level(), t + (v ? 0.3 : 1.5));
    }
  }

  function setEnabled(v) {
    on = !!v;
    try { if (root.localStorage) root.localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* 記録できなくても動く */ }
    apply();
  }

  if (root.document && root.addEventListener) {
    root.document.addEventListener('visibilitychange', function () { hidden = !!root.document.hidden; apply(); });
    // 最初に触ったとき（音が解禁されたあと）に始める
    root.addEventListener('pointerup', function () { setTimeout(apply, 0); }, { capture: true, passive: true });
  }

  var api = {
    want: want, duck: duck, jingle: jingle, JINGLES: JINGLES, enabled: function () { return on; }, setEnabled: setEnabled,
    playing: function () { return playing; }, wanted: function () { return wanted; },
    refresh: apply, clockTrack: clockTrack,
    score: score, render: render, Renderer: Renderer, length: length, mtof: mtof,
    SONGS: SONGS, INST: INST, RATE: RATE, FILES: FILES, FILE_RATE: FILE_RATE, FALLBACK: FALLBACK, GAIN: GAIN, DUCK: DUCK, FADE: FADE, HOLD: HOLD
  };
  root.VentBGM = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
