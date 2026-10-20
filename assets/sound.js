/* 「触って覚える！」シリーズ共通の操作音。こどもの人工呼吸器トレーニング（VentSim）の sound.js をそのまま流用し、
 * 保存キーを手技マスター用にし、まちがえたときの音（miss）を足した。以下は元の説明。 */
/* VentSim — 操作音とアラーム音。音のファイルは持たず、Web Audio でその場で合成する。
 *
 * 操作音は 4 種類。
 *   click   … 機器のキー（設定キー・ハードキー・モード・消音など）。硬くて短い打鍵音。
 *   tick    … ダイヤルが 1 目盛り動いた。ごく小さく高い音。
 *   confirm … 「確定」で設定が患者に反映された。上がる 2 音。
 *   tap     … 機器の外のボタン（ダイアログ・学習帯）。丸く柔らかい音。
 *
 * アラーム音は IEC 60601-1-8 の考え方に寄せる（ド・ラ・ファの 3 音の並びで優先度を分ける）。
 *   high   … 赤（危険）。3 音＋2 音を 2 回、計 10 音の速い連打を 8 秒ごと。
 *   medium … 黄（注意）。3 音をゆっくり 1 回、15 秒ごと。
 * 優先度が上がった瞬間は待たずにすぐ鳴らす。消音中・音をオフにしたときは鳴らさない。
 * 時刻はシミュレーション内ではなく実時間で数える（早送り中に連打にならないように）。
 *
 * パルス音は、パルスオキシメータの「ピッ」。心拍 1 拍に 1 回、実時間で鳴らす。
 * 音の高さは SpO₂ で決まり、100% で A5（880 Hz）、1% 下がるごとに半音下がる（90% で 494 Hz、80% で 277 Hz）。
 * 値は画面の表示と同じく整数に丸めてから音にする（1% の変化が 1 段の音程差として聞こえる）。
 * アラームとは音色で分ける。パルス音は倍音のない短い純音（60 ms）で音量も小さく、
 * アラームは倍音を足した長めの音の並び。消音 2 分はアラームだけを止め、パルス音は止めない（実機と同じ）。
 * パルス音だけを消すこともできる（メニュー）。
 *
 * iPhone 版 App/SoundBoard.swift が同じ音程・長さ・間隔を持つ。片方を変えたらもう片方も。
 */
(function (root) {
  'use strict';

  var KEY = 'shugi.sound.v1';

  /* ---- 音の設計（時刻は秒）。node のテストからも読めるよう、データとして持つ ---- */
  var C5 = 523.25, A4 = 440.0, F4 = 349.23;
  var ALARM = {
    high: {
      every: 8,
      pulses: (function () {
        // 3 音（ド・ラ・ファ）＋2 音（ラ・ファ）、少し空けてもう一度
        var notes = [C5, A4, F4, A4, F4], out = [], t = 0, k;
        for (var round = 0; round < 2; round++) {
          for (k = 0; k < notes.length; k++) {
            out.push({ f: notes[k], t: t, d: 0.13 });
            t += (k === 2 ? 0.34 : 0.19);       // 3 音と 2 音のあいだは長めに空ける
          }
          t += 0.55;
        }
        return out;
      })(),
      gain: 0.34
    },
    medium: {
      every: 15,
      pulses: [{ f: C5, t: 0, d: 0.2 }, { f: A4, t: 0.32, d: 0.2 }, { f: F4, t: 0.64, d: 0.2 }],
      gain: 0.26
    }
  };

  var PULSE = { top: 880, d: 0.06, gain: 0.16, floor: 50, hrMin: 30, hrMax: 250 };

  /* SpO₂ から音の高さ。100% で 880 Hz、1% ごとに半音。50% より下は同じ高さ。 */
  function pulseFreq(spo2) {
    var s = Math.round(spo2);
    if (!isFinite(s)) return 0;
    s = Math.max(PULSE.floor, Math.min(100, s));
    return PULSE.top * Math.pow(2, (s - 100) / 12);
  }

  var CUES = {
    click:   [{ f: 2300, t: 0, d: 0.018, type: 'square', g: 0.10 }, { f: 170, t: 0, d: 0.03, type: 'sine', g: 0.30 }],
    tick:    [{ f: 3400, t: 0, d: 0.008, type: 'square', g: 0.05 }],
    confirm: [{ f: 1046.5, t: 0, d: 0.07, type: 'sine', g: 0.26 }, { f: 1568, t: 0.085, d: 0.11, type: 'sine', g: 0.26 }],
    tap:     [{ f: 740, t: 0, d: 0.06, type: 'sine', g: 0.20, to: 1110 }],
    miss:    [{ f: 494, t: 0, d: 0.09, type: 'sine', g: 0.18, to: 392 }, { f: 370, t: 0.11, d: 0.14, type: 'sine', g: 0.16, to: 294 }]
  };

  /* ---- 設定 ---- */
  var on = true, pulseOn = true, PULSE_KEY = 'shugi.pulse.v1';
  try { on = root.localStorage ? root.localStorage.getItem(KEY) !== 'off' : true; } catch (e) { on = true; }
  try { pulseOn = root.localStorage ? root.localStorage.getItem(PULSE_KEY) !== 'off' : true; } catch (e) { pulseOn = true; }

  /* ---- Web Audio ---- */
  var ctx = null, master = null;
  function audio() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 次の操作で再開する */ } }
    return ctx;
  }

  /* 1 音。立ち上がり 4 ms、指数で減衰。to があれば音程を滑らせる。 */
  function voice(c, at, p, gainScale) {
    var o = c.createOscillator(), g = c.createGain();
    o.type = p.type || 'sine';
    o.frequency.setValueAtTime(p.f, at + p.t);
    if (p.to) o.frequency.exponentialRampToValueAtTime(p.to, at + p.t + p.d);
    var peak = (p.g || 0.3) * (gainScale || 1), t0 = at + p.t;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    g.gain.setValueAtTime(peak, t0 + Math.max(0.004, p.d * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.d + 0.03);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + p.d + 0.05);
  }

  /* アラームの 1 音。基音＋3 倍・5 倍の倍音で、機器らしい硬い音にする（純音だと方向が分かりにくい）。 */
  function alarmPulse(c, at, p, gain) {
    [[1, 1], [2, 0.35], [3, 0.22], [5, 0.12]].forEach(function (h) {
      voice(c, at, { f: p.f * h[0], t: p.t, d: p.d, type: 'sine', g: gain * h[1] });
    });
  }

  function play(name) {
    if (!on) return;
    var c = audio(), cue = CUES[name];
    if (!c || !cue) return;
    var at = c.currentTime + 0.005;
    cue.forEach(function (p) { voice(c, at, p); });
  }

  function playAlarm(level) {
    var c = audio(), a = ALARM[level];
    if (!c || !a) return;
    var at = c.currentTime + 0.01;
    a.pulses.forEach(function (p) { alarmPulse(c, at, p, a.gain); });
  }

  /* 毎フレーム呼ぶ。level は 0 / 1（注意）/ 2（危険）、now は実時間の秒。
   * 鳴らすべきなら鳴らし、鳴らした優先度を返す（テスト用）。 */
  var last = { level: 0, at: -1e9 };
  function alarmPlan(level, silenced, now, state) {
    state = state || last;
    if (!level || silenced) { state.level = 0; return null; }
    var name = level >= 2 ? 'high' : 'medium';
    var due = level > state.level || now - state.at >= ALARM[name].every;
    state.level = level;
    if (!due) return null;
    state.at = now;
    return name;
  }
  function alarm(level, silenced, now) {
    var name = alarmPlan(level, silenced || !on, now);
    if (name) playAlarm(name);
    return name;
  }

  /* 拍の時刻。hr は /分、now は実時間の秒。拍が来ていれば true を返す（テスト用に state を渡せる）。
   * 心拍が変わったら次の拍から間隔を変える。フレームが止まっていたら（タブの裏など）拍を溜めずに打ち直す。 */
  var beat = { next: null };
  function pulsePlan(hr, now, state) {
    state = state || beat;
    if (!(hr > 0) || !isFinite(hr)) { state.next = null; return false; }
    var iv = 60 / Math.max(PULSE.hrMin, Math.min(PULSE.hrMax, hr));
    if (state.next == null) { state.next = now; }
    if (now < state.next) return false;
    state.next += iv;
    if (state.next <= now) state.next = now + iv;
    return true;
  }

  /* 毎フレーム呼ぶ。拍が来たら（音を消していても）true を返す。画面の ♥ はこれに合わせて光らせる。 */
  function pulse(spo2, hr, now) {
    if (!pulsePlan(hr, now)) return false;
    var f = pulseFreq(spo2);
    if (on && pulseOn && f) {
      var c = audio();
      if (c) voice(c, c.currentTime + 0.005, { f: f, t: 0, d: PULSE.d, type: 'sine', g: PULSE.gain });
    }
    return true;
  }
  function pulseReset() { beat.next = null; }

  function setPulseEnabled(v) {
    pulseOn = !!v;
    try { if (root.localStorage) root.localStorage.setItem(PULSE_KEY, pulseOn ? 'on' : 'off'); } catch (e) { /* 記録できなくても動く */ }
  }

  function setEnabled(v) {
    on = !!v;
    try { if (root.localStorage) root.localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* 記録できなくても動く */ }
    if (on) play('tap');
  }

  /* ブラウザは利用者の操作があるまで音を出させない。最初に触ったときに起こしておく。 */
  if (root.addEventListener) {
    var unlock = function () { if (on) audio(); };
    root.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    root.addEventListener('keydown', unlock, { capture: true, passive: true });
  }

  var api = {
    audio: function () { var c = audio(); return c ? { ctx: c, master: master } : null; },
    play: play, alarm: alarm, alarmPlan: alarmPlan,
    pulse: pulse, pulsePlan: pulsePlan, pulseFreq: pulseFreq, pulseReset: pulseReset,
    pulseEnabled: function () { return pulseOn; }, setPulseEnabled: setPulseEnabled,
    enabled: function () { return on; }, setEnabled: setEnabled,
    ALARM: ALARM, CUES: CUES, PULSE: PULSE
  };
  root.VentSound = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
