/* 手技・物品マスター — ストーリー（病棟ローテーション）の共通データ。
 * 主人公（プレイヤー）は、小児病棟（内科と外科のこどもが半分ずつ）に来た 研修医 か 新人看護師。
 * いぶき先生は病棟の手技指導の担当で、主人公の指導医。ぷくぷくが「なんで？」を代わりに聞く。
 * 看護師のミナミさんは、病棟の先輩看護師で、患者さんのことをいちばん知っている人（新人看護師ならプリセプター）。
 * 外科の日には たける先生 が出てくる。
 *
 * ここにはデータだけを置く。描画と進行は story/engine.js。
 *   PROLOGUE        … 最初にストーリーを開いたとき（名前と役割を決める）
 *   EPISODES        … 勤務表。1 行が 1 勤務（エピソード）。中身は story/ep<N>.js が登録する
 *                     （書式は docs/story-plan.md）。ready:false の勤務は「準備中」と出て、ファイルも読まない。
 *
 * 行（line）の書き方
 *   { who, say }      who: 'scene'（ト書き）/ 'doc'（いぶき先生）/ 'puku' / 'me'（主人公）/ 'nurse'（ミナミさん）
 *                     / 'surg'（たける先生）/ 'pt'（患者。name に呼び名）/ 'fam'（家族。name に呼び名）
 *   mood              … doc は normal / happy / think / alert、puku は happy / excited / sad
 *   bg                … この行から背景を替える（BG の名前）
 *   bgm               … この行から幕の終わりまで曲を替える（'day' / 'night' / 'alarm'）
 *   role: 'doc'|'ns'  … その役割を選んだときだけ出す行（研修医 / 新人看護師）
 *   input: 'name'     … 名前を入れてもらう行。input: 'role' … 役割を選んでもらう行
 *   choose: [{ label, reply, who?, mood?, name? }]  … 主人公の返事を選ぶ。reply は返しの 1 行
 *   pick: 'key'       … 選んだ番号を key で覚える。when: 'key:n' … その番号を選んだときだけ出す行
 *   pt: 'okawa_hfnc'  … この行から、場面の患者さんの絵を pt_<この名前> に替える（業務の中だけ）
 *   cg: 'ep9'         … この行から、上の帯にイベント CG（cg_<この名前>）を出す。cg: false で消す
 * 置き換え：{名前} 主人公の名前 ／ {呼} 先生・さん ／ {役} 研修医・新人看護師
 *
 * 業務（task）の絵の欄（docs/story-art.json の "tasks" と対応）
 *   ptImg: 'okawa_o2'   … 業務の場面に出す患者さん（assets/story/pt_okawa_o2.webp）。無ければ患者さんなしの場面
 *   ptAfter: 'okawa_hfnc' … 結果の画面から先（終わりの会話も）で替える絵
 *   cond: ['!SpO₂ 89%', '呼吸 26 回/分'] … 場面の左上の札。先頭 ! は赤（悪い）、+ は緑（よくなった）
 *   condAfter: [...]    … 結果の画面から先の札（無ければ cond のまま）
 *   cg: 'ep1'           … 終わりの会話（outro）の上の帯に cg_ep1 を出す
 */
(function (root) {
  'use strict';
  var S = root.SHUGI_STORY = root.SHUGI_STORY || {};

  S.DEFAULT_NAME = '日向';
  S.NAME_MAX = 8;

  /* 役割。call は呼び方（{名前}{呼}）。 */
  S.ROLES = {
    doc: { label: '研修医', call: '先生', note: '初期研修。小児科のローテーション' },
    ns: { label: '新人看護師', call: 'さん', note: 'この春に配属。病棟の看護師として' }
  };

  /* 名札。me は主人公の名前、pt / fam は行の name を使う。 */
  S.SPEAKER = { scene: '', doc: 'いぶき先生', puku: 'ぷくぷく', me: '{名前}', nurse: '看護師 ミナミ', surg: '外科 たける先生' };
  /* 立ち絵を持たない人は丸い名札で出す。ミナミさん（nurse）は立ち絵 nurse_minami（engine.js の CAST）。 */
  S.BADGE = { surg: { mark: '外', color: '#4FA8FF' }, pt: { color: '#8B6BFF' }, fam: { color: '#8B6BFF' } };

  /* 背景。左から順に、届いている画像（HAVE にある名前）を使う。
   * 新しい背景は Codex が作る（docs/codex-image-prompts.md の 4〜7）。置いたら HAVE に名前を足す。
   * night は夜の色をかぶせて使う。 */
  S.BG = {
    ward: ['bg_story_ward', 'bg_title_shugi', 'bg_title'],
    station: ['bg_story_station', 'bg_title_shugi', 'bg_title'],
    room: ['bg_story_room', 'bg_story_ward', 'bg_title_shugi', 'bg_title'],
    proc: ['bg_story_room', 'bg_title_shugi', 'bg_title'],
    night: ['bg_story_night', 'bg_story_station', 'bg_title_shugi', 'bg_title']
  };
  S.HAVE = ['bg_title_shugi', 'bg_title'];

  /* ストーリーの絵（web/assets/story/<名前>.webp。仕様は docs/story-art.json）。
   * ここに名前のある絵だけを読む（無い絵は読みに行かない＝404 を出さない）。無いあいだは、
   * 患者さんはベッドの札（名前・年齢・部屋）、イベント CG はその場所の背景と勤務の札で代わりに出す。
   * 絵が届いたら名前を 1 つ足す。figs/scripts/story-have.mjs を走らせると、フォルダを見てこの行を書き直す。
   *   pt_<患者>[_<状態>] … 業務の場面の患者さん（task.ptImg / task.ptAfter / 行の pt）
   *   cg_ep<N> / cg_prologue / cg_epilogue … イベント CG（勤務の始まりと終わり、task.cg、行の cg）
   *   bg_story_ward / station / room / night … 場所の背景（上の S.BG） */
  S.ART = [
    'bg_story_night', 'bg_story_room', 'bg_story_station', 'bg_story_ward', 'cg_ep1', 'cg_ep10', 'cg_ep2',
    'cg_ep3', 'cg_ep4', 'cg_ep5', 'cg_ep6', 'cg_ep7', 'cg_ep8', 'cg_ep9', 'cg_epilogue', 'cg_prologue',
    'fam_aoi_father', 'fam_daichi_father', 'fam_haru_mother', 'fam_hina_mother', 'fam_kaito_mother',
    'fam_kenta_mother', 'fam_kotone_mother', 'fam_mei_father', 'fam_mio_father', 'fam_mio_mother',
    'fam_misaki_mother', 'fam_ren_mother', 'fam_ryo_mother', 'fam_sakura_mother', 'fam_shun_mother',
    'fam_sota_father', 'fam_sota_mother', 'fam_takumi_mother', 'fam_yuto_grandma', 'kid_aoi', 'kid_daichi',
    'kid_hina', 'kid_kaito', 'kid_kenta', 'kid_kotone', 'kid_mei', 'kid_misaki', 'kid_sakura', 'kid_shun',
    'kid_sota', 'kid_takumi', 'pt_aoi', 'pt_daichi', 'pt_daichi_nppv', 'pt_haru', 'pt_haru_hfnc',
    'pt_haru_ng', 'pt_hina', 'pt_hina_arrest', 'pt_hina_monitor', 'pt_hina_rosc', 'pt_kaito',
    'pt_kaito_splint', 'pt_kenta', 'pt_kenta_tf', 'pt_kotone', 'pt_mei', 'pt_mio', 'pt_mio_lp', 'pt_misaki',
    'pt_ren', 'pt_ren_lateral', 'pt_ryo', 'pt_ryo_lines', 'pt_sakura', 'pt_sakura_o2', 'pt_shun',
    'pt_shun_drain', 'pt_sota', 'pt_sota_dka', 'pt_takumi', 'pt_takumi_foley', 'pt_yuto', 'surg_takeru'
  ];

  /* 患者さんの状態（pt_<患者>_<状態> の <状態>）。絵が無いときの札に出す。 */
  S.PT_STATE = {
    o2: '鼻カニュラで酸素', hfnc: '高流量鼻カニュラ', bad: '息が苦しい', nppv: 'NPPV マスク', foley: '尿道カテーテル',
    valve: 'スピーチバルブ', splint: '副子で固定', drain: '胸腔ドレーン', arrest: '心肺蘇生', rosc: '自己心拍 再開・挿管'
  };

  /* 勤務表。mods は各業務で使う手技（docs/story-plan.md と同じ。52 の手技がどこかで 1 回は出る）。 */
  S.EPISODES = [
    { id: 'ep1', label: '1日目 日勤', title: '入院の日', time: 'day', file: 'story/ep1.js', ready: true,
      mods: ['ppe', 'steth', 'oxygen', 'culture', 'iv'] },
    { id: 'ep2', label: '2日目 日勤', title: '点滴と採血の朝', time: 'day', file: 'story/ep2.js', ready: true,
      mods: ['draw', 'ivset', 'syringe', 'pump', 'transfusion'] },
    { id: 'ep3', label: '3日目 日勤', title: 'ベッドサイドの検査', time: 'day', file: 'story/ep3.js', ready: true,
      mods: ['poct', 'insulin', 'injection', 'ecg', 'specimen'] },
    { id: 'ep4', label: '4日目 日勤', title: '管とケア', time: 'day', file: 'story/ep4.js', ready: true,
      mods: ['foley', 'ngtube', 'suction', 'enema', 'trach'] },
    { id: 'ep5', label: '4日目 夜勤', title: 'はじめての夜', time: 'night', file: 'story/ep5.js', ready: true,
      mods: ['cart', 'monitor', 'hfnc', 'abg', 'nppv'] },
    { id: 'ep6', label: '5日目 日勤', title: '処置室', time: 'day', file: 'story/ep6.js', ready: true,
      mods: ['antisepsis', 'sterile', 'localanes', 'scalpel', 'forceps', 'suture'] },
    { id: 'ep7', label: '6日目 日勤', title: '手術のあと', time: 'day', file: 'story/ep7.js', ready: true,
      mods: ['clamps', 'hemostasis', 'scissors', 'closure', 'dressing', 'drain'] },
    { id: 'ep8', label: '7日目 日勤', title: '創と固定', time: 'day', file: 'story/ep8.js', ready: true,
      mods: ['retractor', 'bandage', 'tape', 'splint', 'chest'] },
    { id: 'ep9', label: '8日目 当直', title: '急変の夜', time: 'night', file: 'story/ep9.js', ready: true,
      mods: ['bvm', 'airway', 'defib', 'io', 'sga', 'intubation'] },
    { id: 'ep10', label: '最終日 日勤', title: 'ローテーション最終日', time: 'day', file: 'story/ep10.js', ready: true,
      mods: ['foreign', 'cvc', 'aline', 'puncture'] }
  ];

  /* ===================== プロローグ ===================== */
  S.PROLOGUE = {
    id: 'prologue', title: 'プロローグ　はじめての病棟',
    card: { kicker: 'プロローグ', title: 'はじめての病棟', sub: 'ローテーション初日　午前 8 時' },
    bg: 'ward', time: 'morning',
    lines: [
      { who: 'scene', say: '4 月。3 階の小児病棟。内科と外科の子どもが半分ずつの、30 床。同じ階に、処置室とプレイルームと PICU がある。' },
      { who: 'scene', say: 'ナースステーションでは夜勤の申し送りが終わるところ。廊下の向こうで、点滴台を押した小さな女の子が、お母さんと歩いている。' },
      { who: 'doc', mood: 'happy', say: 'おはようございます。今日からこの病棟に来た人ですね。' },
      { who: 'doc', say: 'いぶきです。小児科医で、この病棟の手技の指導を担当しています。採血から急変の対応まで、ひととおり一緒にやっていきます。' },
      { who: 'doc', say: 'まず、呼び方を決めさせてください。お名前は？', input: 'name' },
      { who: 'doc', say: 'それから、ここでの立場も教えてください。', input: 'role' },
      { who: 'doc', mood: 'happy', role: 'doc', say: '{名前}先生。初期研修の、小児科のローテーションですね。よろしくお願いします。' },
      { who: 'doc', mood: 'happy', role: 'ns', say: '{名前}さん。この春に小児病棟に配属された新人さんですね。看護部から聞いています。よろしくお願いします。' },
      { who: 'me', say: 'よろしくお願いします。…授業や実習では習ったんですが、実物はほとんど触ったことがなくて。' },
      { who: 'doc', say: '最初はみんなそうです。子どもの物は、サイズも量も大人と違います。病棟の仕事をこなしながら、一つずつ手で覚えていきましょう。' },
      { who: 'scene', say: 'いぶき先生の白衣のポケットから、白くて丸いものが、ふわりと浮かび上がった。' },
      { who: 'puku', mood: 'excited', say: 'ねえねえ、この人が新しい人？' },
      { who: 'doc', mood: 'happy', say: 'ぷくぷくです。この病棟の「なんで？」から生まれた…ということに、なっています。' },
      { who: 'puku', mood: 'happy', say: 'わからないことがあったら、ぼくが代わりに「なんで？」って聞いてあげる！' },
      { who: 'scene', bg: 'station', say: 'ナースステーションから、カルテを抱えた看護師が顔を出した。' },
      { who: 'nurse', role: 'doc', say: 'いぶき先生、おはようございます！ あっ、新しい研修医の先生ですか？ 病棟のことなら、お手伝いしますね。' },
      { who: 'nurse', role: 'ns', say: 'いぶき先生、おはようございます！ あっ、新人さんですね。プリセプターは私が担当します！' },
      { who: 'nurse', say: '看護師の ミナミです。困ったことがあったら、まず私に聞いてくださいね。子どもたちのことなら、だいたい分かりますから！' },
      { who: 'doc', say: 'ミナミさんは、この病棟でいちばん子どもたちと家族のことを知っている人です。わたしも毎朝、頼りにしています。' },
      {
        who: 'puku', mood: 'excited', say: '{名前}{呼}、いまどんな気持ち？', pick: 'nerves',
        choose: [
          { label: '正直、緊張しています', reply: 'いい緊張です。こわいと思える人のほうが、手順を守れます。' },
          { label: '早く子どもたちを受け持ちたいです', reply: '頼もしい。その気持ちのまま、確かめることだけは省かないでいきましょう。' }
        ]
      },
      { who: 'doc', say: 'ここでの約束は 3 つだけです。わからないことは聞く。手指衛生をする。名前は、リストバンドと、本人か家族に名乗ってもらって確かめる。' },
      { who: 'doc', mood: 'happy', say: 'それから、子どもにも、わかる言葉で先に説明します。うそはつきません。「痛くないよ」ではなく「ちょっとちくっとするよ」と。' },
      { who: 'puku', mood: 'happy', say: '3 つと、もう 1 つ！ ぼくでも覚えられる！' },
      { who: 'nurse', say: 'それじゃあ、勤務表をお渡ししますね。今日は 1 日目の日勤からです！' },
      { who: 'doc', mood: 'happy', say: '行きましょう、{名前}{呼}。最初の子どもたちと、そのご家族が待っています。' }
    ]
  };

  /* エピソードのファイルは window.SHUGI_STORY_EP[id] に登録する（読む順に依存しない）。 */
  root.SHUGI_STORY_EP = root.SHUGI_STORY_EP || {};
})(typeof window !== 'undefined' ? window : globalThis);
