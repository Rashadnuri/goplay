import type { Exercise, Lesson, Localized } from '../lib/types.ts';

const L = (az: string, en: string, ru: string): Localized => ({ az, en, ru });
const P = (x: number, y: number) => y * 9 + x;
const ex = (rows: string[], goal: Exercise['goal'], extra: Partial<Exercise> = {}): Exercise => ({ size: 9, rows, goal, ...extra });
const quiz = (q: Localized, options: Localized[], correct: number, extra: Partial<Exercise> = {}): Exercise => ({
  size: 9, rows: extra.rows ?? Array(9).fill('.........'), goal: { type: 'quiz', question: q, options, correct }, ...extra,
});
const EMPTY = Array(9).fill('.........');
const yes = L('Bəli', 'Yes', 'Да');
const no = L('Xeyr', 'No', 'Нет');

/** Bundled curriculum. Seeded into the `lessons` table (scripts/gen-seed.mjs); admins can edit it there. */
export const BASIC_LESSONS: Lesson[] = [
  {
    slug: 'intro', position: 1, level: 1,
    title: L('Qo oyununa giriş', 'Introduction to Go', 'Введение в го'),
    summary: L('Qo nədir və məqsəd nədir?', 'What is Go and what is the goal?', 'Что такое го и в чём цель?'),
    steps: [
      {
        text: L(
          'Qo (Baduk, Weiqi) 4000 ildən çox yaşı olan strateji oyundur. İki oyunçu növbə ilə qara və ağ daşlar qoyur. Məqsəd taxtanın daha çox hissəsini — ərazini — əhatə etməkdir.',
          'Go (Baduk, Weiqi) is a strategy game more than 4,000 years old. Two players take turns placing black and white stones. The goal is to surround more of the board — territory — than your opponent.',
          'Го (бадук, вэйци) — стратегическая игра возрастом более 4000 лет. Два игрока по очереди ставят чёрные и белые камни. Цель — окружить больше территории, чем соперник.',
        ),
      },
      {
        text: L(
          'Qaydalar sadədir: qara birinci gedir, daşlar xətlərin kəsişməsinə qoyulur və qoyulduqdan sonra yerindən tərpənmir. Sınaqdan keçirin — istənilən kəsişməyə daş qoyun.',
          'The rules are simple: Black goes first, stones go on the intersections of the lines and never move once placed. Try it — place a stone on any intersection.',
          'Правила просты: чёрные ходят первыми, камни ставятся на пересечения линий и после этого не двигаются. Попробуйте — поставьте камень на любое пересечение.',
        ),
        exercise: ex(EMPTY, { type: 'any' }, { success: L('Əla! İlk daşınızı qoydunuz.', 'Great! You placed your first stone.', 'Отлично! Вы поставили первый камень.') }),
      },
    ],
  },
  {
    slug: 'board-stones', position: 2, level: 1,
    title: L('Taxta və daşlar', 'The board and stones', 'Доска и камни'),
    summary: L('9×9, 13×13 və 19×19 taxtalar.', '9×9, 13×13 and 19×19 boards.', 'Доски 9×9, 13×13 и 19×19.'),
    steps: [
      {
        text: L(
          'Oyun 19×19 taxtada oynanır, amma başlamaq üçün 9×9 və 13×13 daha yaxşıdır. Daşlar xətlərin kəsişməsində dayanır. Kiçik qara nöqtələr (hoşi) istiqamət tapmağa kömək edir.',
          'The standard board is 19×19, but 9×9 and 13×13 are better for learning. Stones sit on the intersections. The small dots (star points) help you find your way.',
          'Стандартная доска — 19×19, но для обучения лучше 9×9 и 13×13. Камни стоят на пересечениях. Маленькие точки (хоси) помогают ориентироваться.',
        ),
      },
      {
        text: L('Qo-da kim birinci gedir?', 'Who plays first in Go?', 'Кто ходит первым в го?'),
        exercise: quiz(L('Qo-da kim birinci gedir?', 'Who plays first in Go?', 'Кто ходит первым в го?'), [L('Qara', 'Black', 'Чёрные'), L('Ağ', 'White', 'Белые')], 0, {
          success: L('Düzdür — qara birinci gedir. Ağ kompensasiya kimi komi alır.', 'Correct — Black moves first. White receives komi as compensation.', 'Верно — чёрные ходят первыми. Белые получают коми в качестве компенсации.'),
        }),
      },
    ],
  },
  {
    slug: 'liberties', position: 3, level: 1,
    title: L('Azadlıqlar', 'Liberties', 'Дамэ (свободы)'),
    summary: L('Daşın "nəfəs" aldığı boş nöqtələr.', 'The empty points a stone "breathes" through.', 'Пустые пункты, которыми камень «дышит».'),
    steps: [
      {
        text: L(
          'Daşın azadlığı — ona xətt boyunca bitişik boş nöqtədir. Ortadakı daşın 4 azadlığı var (işarələnib). Kənardakının 3, küncdəkinin isə yalnız 2 azadlığı var.',
          'A stone’s liberties are the empty points directly next to it along the lines. A stone in the middle has 4 liberties (marked). On an edge it has 3 and in a corner only 2.',
          'Свободы камня — пустые пункты, соседние с ним по линиям. У камня в центре 4 свободы (отмечены). На краю — 3, в углу — всего 2.',
        ),
        exercise: quiz(L('Küncdəki daşın neçə azadlığı var?', 'How many liberties does a corner stone have?', 'Сколько свобод у камня в углу?'), [L('2', '2', '2'), L('3', '3', '3'), L('4', '4', '4')], 0, {
          rows: ['X........', ...Array(8).fill('.........')], marks: [P(1, 0), P(0, 1)],
          success: L('Düzdür: küncdə yalnız 2 azadlıq.', 'Right: only 2 in a corner.', 'Верно: в углу только 2.'),
        }),
      },
      {
        text: L('Ortadakı daşa baxın.', 'Look at the stone in the middle.', 'Посмотрите на камень в центре.'),
        exercise: quiz(L('Ortadakı daşın neçə azadlığı var?', 'How many liberties does the centre stone have?', 'Сколько свобод у камня в центре?'), [L('2', '2', '2'), L('3', '3', '3'), L('4', '4', '4')], 2, {
          rows: ['.........', '.........', '.........', '.........', '....X....', '.........', '.........', '.........', '.........'], marks: [P(3, 4), P(5, 4), P(4, 3), P(4, 5)],
          success: L('Düzdür: 4 azadlıq.', 'Right: 4 liberties.', 'Верно: 4 свободы.'),
        }),
      },
    ],
  },
  {
    slug: 'capturing', position: 4, level: 1,
    title: L('Daşları tutmaq', 'Capturing stones', 'Взятие камней'),
    summary: L('Azadlığı qalmayan daş tutulur.', 'A stone with no liberties is captured.', 'Камень без свобод снимается с доски.'),
    steps: [
      {
        text: L(
          'Rəqibin daşının son azadlığını doldursanız, o daş tutulur və taxtadan götürülür. Ağ daşın yalnız bir azadlığı qalıb — onu tutun.',
          'If you fill the last liberty of an enemy stone, it is captured and removed from the board. The white stone has just one liberty left — capture it.',
          'Если вы занимаете последнюю свободу камня противника, он берётся и снимается с доски. У белого камня осталась одна свобода — возьмите его.',
        ),
        exercise: ex(['.........', '.........', '.........', '...X.....', '..XOX....', '.........', '.........', '.........', '.........'].map((r, i) => (i === 4 ? '...XOX...' : i === 3 ? '....X....' : r)), { type: 'capture' }, {
          hint: L('Ağ daşın altındakı boş nöqtəyə baxın.', 'Look at the empty point below the white stone.', 'Посмотрите на пустой пункт под белым камнем.'),
          success: L('Tutdunuz! Daş götürüldü.', 'Captured! The stone is removed.', 'Взято! Камень снят.'),
        }),
      },
      {
        text: L('Kənarda daşları tutmaq daha asandır — daha az azadlıq var.', 'Capturing is easier on the edge — fewer liberties.', 'На краю брать проще — свобод меньше.'),
        exercise: ex(['OX.......', '.........', ...Array(7).fill('.........')], { type: 'capture' }, {
          hint: L('Ağ daş küncdədir.', 'The white stone is in the corner.', 'Белый камень в углу.'),
          success: L('Əla!', 'Well done!', 'Отлично!'),
        }),
      },
      {
        text: L('İki daşdan ibarət qrupu da tutmaq olar. Son azadlığı tapın.', 'You can capture a group of two stones too. Find the last liberty.', 'Можно взять и группу из двух камней. Найдите последнюю свободу.'),
        exercise: ex(['..XOO....', '...XX....', ...Array(7).fill('.........')], { type: 'capture', min: 2 }, {
          hint: L('Qrupun sağında.', 'To the right of the group.', 'Справа от группы.'),
          success: L('İki daş birdən tutuldu!', 'Two stones captured at once!', 'Два камня взяты сразу!'),
        }),
      },
    ],
  },
  {
    slug: 'groups', position: 5, level: 2,
    title: L('Qruplar', 'Groups and connection', 'Группы и связь'),
    summary: L('Bitişik daşlar bir qrup yaradır.', 'Adjacent stones form a group.', 'Соседние камни образуют группу.'),
    steps: [
      {
        text: L(
          'Xətt boyunca bitişik eyni rəngli daşlar bir qrupdur: onlar azadlıqları paylaşır və birlikdə tutulur. Çəp qonşu daşlar bağlı deyil.',
          'Same-coloured stones next to each other along a line form a group: they share liberties and are captured together. Diagonal neighbours are NOT connected.',
          'Камни одного цвета, соседние по линии, образуют группу: у них общие свободы, и берутся они вместе. Диагональные соседи НЕ связаны.',
        ),
        exercise: quiz(L('Çəp yerləşən iki daş bir qrupdur?', 'Are two diagonally placed stones one group?', 'Образуют ли два диагональных камня одну группу?'), [yes, no], 1, {
          rows: ['.........', '.........', '.........', '...X.....', '....X....', ...Array(4).fill('.........')],
          success: L('Xeyr, bağlı deyillər.', 'No — they are not connected.', 'Нет, они не связаны.'),
        }),
      },
      {
        text: L('Rəqib iki daşınızı ayıra bilər. Onları bağlayın!', 'The opponent can cut your two stones apart. Connect them!', 'Соперник может разрезать ваши камни. Соедините их!'),
        exercise: ex(['.........', '.........', '.........', '....O....', '...X.X...', '....O....', ...Array(3).fill('.........')].map((r, i) => (i === 4 ? '...X.X...' : r)), { type: 'point', points: [P(4, 4)] }, {
          hint: L('İki qara daşın arasındakı nöqtə.', 'The point between the two black stones.', 'Пункт между двумя чёрными камнями.'),
          success: L('Bağlandı — indi bir qrupdur.', 'Connected — now they are one group.', 'Соединено — теперь это одна группа.'),
        }),
      },
    ],
  },
  {
    slug: 'ko', position: 6, level: 2,
    title: L('Ko qaydası', 'The ko rule', 'Правило ко'),
    summary: L('Sonsuz təkrarın qarşısını alır.', 'It prevents endless repetition.', 'Предотвращает бесконечные повторы.'),
    steps: [
      {
        text: L(
          'Bəzən iki tərəf bir daşı sonsuz tuta bilər. Bunun qarşısını ko qaydası alır: tutulan daşı dərhal geri tutmaq olmaz — əvvəlcə başqa yerdə gediş (ko təhdidi) etmək lazımdır. Qara indi daşı tuta bilər:',
          'Sometimes both sides could capture the same stone forever. The ko rule stops this: you may not immediately recapture — you must first play elsewhere (a ko threat). Black can capture now:',
          'Иногда стороны могли бы бесконечно брать один и тот же камень. Правило ко это запрещает: нельзя сразу брать обратно — сначала нужно сделать ход в другом месте (угроза ко). Чёрные могут взять сейчас:',
        ),
        exercise: ex(['.XO......', 'XO.O.....', '.XO......', ...Array(6).fill('.........')], { type: 'capture' }, {
          hint: L('Ağ daşın sağındakı boş nöqtə.', 'The empty point to the right of the white stone.', 'Пустой пункт справа от белого камня.'),
        }),
      },
      {
        text: L('İndi ağın növbəsidir.', 'Now it is White’s turn.', 'Теперь ход белых.'),
        exercise: quiz(L('Ağ tutulan yerə dərhal qayıda bilər?', 'May White immediately retake in the same spot?', 'Могут ли белые сразу взять обратно на том же месте?'), [yes, no], 1, {
          success: L('Xeyr — bu ko-dur. Əvvəlcə ko təhdidi lazımdır.', 'No — that is ko. A ko threat is needed first.', 'Нет — это ко. Сначала нужна угроза ко.'),
        }),
      },
    ],
  },
  {
    slug: 'territory', position: 7, level: 2,
    title: L('Ərazi və hesablama', 'Territory and scoring', 'Территория и подсчёт'),
    summary: L('Oyun necə sona çatır və qalib kim olur.', 'How a game ends and who wins.', 'Как заканчивается игра и кто побеждает.'),
    steps: [
      {
        text: L(
          'Hər iki oyunçu pas dedikdə oyun bitir. Ərazi — yalnız bir rəngin əhatə etdiyi boş nöqtələrdir. Yapon qaydasında ərazi + əsirlər, Çin qaydasında ərazi + taxtadakı daşlar sayılır. Ağa komi əlavə olunur.',
          'The game ends when both players pass. Territory is the empty points surrounded by one colour only. Japanese rules count territory + prisoners, Chinese rules count territory + stones on the board. White gets komi added.',
          'Игра заканчивается, когда оба игрока пасуют. Территория — пустые пункты, окружённые одним цветом. По японским правилам считают территорию + пленных, по китайским — территорию + камни на доске. Белым добавляется коми.',
        ),
        exercise: quiz(L('Qara neçə xal ərazi qazanıb?', 'How many points of territory does Black own?', 'Сколько пунктов территории у чёрных?'), [L('18', '18', '18'), L('27', '27', '27'), L('36', '36', '36')], 1, {
          rows: Array(9).fill('...X.O...'),
          success: L('Sol tərəfdə 3×9 = 27 boş nöqtə. Ortadakı sütun heç kimin deyil.', '3×9 = 27 empty points on the left. The middle column belongs to nobody.', 'Слева 3×9 = 27 пустых пунктов. Средний столбец ничей.'),
        }),
      },
    ],
  },
  {
    slug: 'life-death', position: 8, level: 3,
    title: L('Həyat və ölüm', 'Life and death', 'Жизнь и смерть'),
    summary: L('İki göz — qrupun ölməzliyi.', 'Two eyes — a group that cannot be killed.', 'Два глаза — группа, которую нельзя убить.'),
    steps: [
      {
        text: L(
          'Qrup iki "göz"ə (ayrı-ayrı əhatə olunmuş boş nöqtələr) malikdirsə, rəqib ona heç vaxt hücum edib tuta bilməz — çünki gözləri doldurmaq intiharçılıqdır. Bu, qrupun "diri" olması deməkdir.',
          'If a group has two "eyes" (separate surrounded empty points) the opponent can never capture it — filling an eye would be suicide. Such a group is "alive".',
          'Если у группы два «глаза» (отдельных окружённых пустых пункта), противник никогда не сможет её взять — заполнение глаза было бы самоубийством. Такая группа «жива».',
        ),
        exercise: quiz(L('Qrupun yaşaması üçün neçə göz lazımdır?', 'How many eyes does a group need to live?', 'Сколько глаз нужно группе, чтобы жить?'), [L('1', '1', '1'), L('2', '2', '2'), L('3', '3', '3')], 1),
      },
      {
        text: L(
          'Üç boş nöqtənin yan-yana olduğu bu formada "həyati nöqtə" ortadadır. Qara oynayır — iki göz yaradın!',
          'In this shape of three empty points in a row, the vital point is the middle one. Black to play — make two eyes!',
          'В этой форме с тремя пустыми пунктами в ряд жизненно важный пункт — средний. Ход чёрных — создайте два глаза!',
        ),
        exercise: ex(['X...X....', 'XXXXX....', ...Array(7).fill('.........')], { type: 'point', points: [P(2, 0)] }, {
          hint: L('Üç boş nöqtənin ortası.', 'The middle of the three empty points.', 'Середина трёх пустых пунктов.'),
          success: L('Düzdür! İndi iki ayrı gözünüz var: qrup diridir.', 'Correct! Now you have two separate eyes: the group lives.', 'Верно! Теперь у вас два отдельных глаза: группа жива.'),
        }),
      },
    ],
  },
  {
    slug: 'opening', position: 9, level: 3,
    title: L('Açılış strategiyası', 'Opening strategy', 'Стратегия дебюта'),
    summary: L('Künclər, kənarlar, mərkəz.', 'Corners, sides, centre.', 'Углы, стороны, центр.'),
    steps: [
      {
        text: L(
          'Qaydası: künc → kənar → mərkəz. Künclərdə az daşla çox ərazi əhatə etmək olar, ona görə açılış adətən künclərdən başlayır.',
          'The rule of thumb: corners → sides → centre. In corners you can claim territory with few stones, so openings usually start there.',
          'Правило: углы → стороны → центр. В углах можно занять территорию малым числом камней, поэтому дебют обычно начинается с них.',
        ),
        exercise: quiz(L('Açılışda adətən haradan başlanır?', 'Where do openings usually start?', 'С чего обычно начинается дебют?'), [L('Mərkəz', 'The centre', 'Центр'), L('Künclər', 'The corners', 'Углы'), L('Kənarın ortası', 'Middle of a side', 'Середина стороны')], 1),
      },
      {
        text: L('Boş 9×9 taxtada qara kimi künc nöqtəsinə daş qoyun.', 'On an empty 9×9 board, play a corner point as Black.', 'На пустой доске 9×9 поставьте камень в угловой пункт.'),
        exercise: ex(EMPTY, { type: 'point', points: [P(2, 2), P(6, 2), P(2, 6), P(6, 6), P(2, 3), P(3, 2), P(5, 2), P(6, 3), P(2, 5), P(3, 6), P(5, 6), P(6, 5)] }, {
          hint: L('Kənardan 3-cü xətdəki hoşi nöqtələrə baxın.', 'Look at the star points on the third line.', 'Посмотрите на пункты хоси на третьей линии.'),
          success: L('Yaxşı açılış!', 'A good opening move!', 'Хороший дебютный ход!'),
        }),
      },
    ],
  },
  {
    slug: 'tactics', position: 10, level: 3,
    title: L('Başlanğıc taktikası', 'Beginner tactics', 'Базовая тактика'),
    summary: L('Atari, qaçış və tutma.', 'Atari, escaping and capturing races.', 'Атари, побег и взятие.'),
    steps: [
      {
        text: L(
          '"Atari" — daşın yalnız bir azadlığının qalması deməkdir. Növbəti gedişdə tutula bilər. Ağ daşı atariyə salın!',
          '"Atari" means a stone has only one liberty left and can be captured next move. Put the white stone in atari!',
          '«Атари» значит, что у камня осталась одна свобода, и в следующий ход его можно взять. Поставьте белый камень в атари!',
        ),
        exercise: ex(['.........', '.........', '.........', '....X....', '...XO....', '.........', ...Array(3).fill('.........')], { type: 'point', points: [P(5, 4), P(4, 5)] }, {
          hint: L('Ağ daşın qalan iki azadlığından birini tutun.', 'Take one of the two remaining liberties.', 'Займите одну из двух оставшихся свобод.'),
          success: L('Atari! Ağ daş indi bir azadlıqla qalıb.', 'Atari! The stone is down to one liberty.', 'Атари! У камня осталась одна свобода.'),
        }),
      },
      {
        text: L('İndi sizin daşınız atari vəziyyətindədir. Qaçın — azadlıqlarınızı artırın!', 'Now YOUR stone is in atari. Escape — gain liberties!', 'Теперь в атари ВАШ камень. Убегайте — добавьте свободы!'),
        exercise: ex(['.........', '.........', '.........', '....O....', '...OXO...', '.........', ...Array(3).fill('.........')], { type: 'point', points: [P(4, 5)] }, {
          hint: L('Qara daşın yeganə azadlığına uzadın.', 'Extend into the stone’s only liberty.', 'Продлите камень на его единственную свободу.'),
          success: L('Qaçdınız — indi 3 azadlıq var.', 'Escaped — now it has 3 liberties.', 'Убежали — теперь три свободы.'),
        }),
      },
    ],
  },
];

const B19 = Array(19).fill('.'.repeat(19));
const Q = (x: number, y: number) => y * 19 + x;
const big = (goal: Exercise['goal'], extra: Partial<Exercise> = {}): Exercise => ({ size: 19, rows: B19, goal, ...extra });
const FOUR_FOUR = [Q(3, 3), Q(15, 3), Q(3, 15), Q(15, 15)];

/** Opening library — geometry-exact points on a 19×19 board (3rd/4th lines), no memorised joseki. */
export const OPENING_LESSONS: Lesson[] = [
  {
    slug: 'open-principles', track: 'openings', position: 101, level: 2,
    title: L('Açılışın əsas prinsipləri', 'Opening principles', 'Принципы дебюта'),
    summary: L('Künc → kənar → mərkəz.', 'Corner → side → centre.', 'Угол → сторона → центр.'),
    steps: [
      { text: L(
        'Qo-da açılışa "fuseki" deyilir. Taxtanın künclərində az daşla ərazini əldə etmək asandır, kənarlarda çətinləşir, mərkəzdə ən çətindir. Buna görə adətən əvvəl künclər, sonra kənarlar, ən axırda mərkəz tutulur.',
        'The opening is called "fuseki". Territory is easiest to secure in the corners with few stones, harder along the sides and hardest in the centre — so players usually take corners first, then sides, then the centre.',
        'Дебют в го называется «фусэки». В углах территорию проще всего занять малым числом камней, на сторонах сложнее, в центре сложнее всего — поэтому обычно сначала занимают углы, затем стороны и в последнюю очередь центр.'),
        exercise: quiz(L('Hansı sıra daha səmərəlidir?', 'Which order is usually more efficient?', 'Какой порядок обычно эффективнее?'), [L('Mərkəz → kənar → künc', 'Centre → side → corner', 'Центр → сторона → угол'), L('Künc → kənar → mərkəz', 'Corner → side → centre', 'Угол → сторона → центр')], 1, { rows: B19, size: 19 }) },
    ],
  },
  {
    slug: 'open-corner-points', track: 'openings', position: 102, level: 2,
    title: L('Künc nöqtələri: 3-3, 3-4, 4-4', 'Corner points: 3-3, 3-4, 4-4', 'Угловые пункты: 3-3, 3-4, 4-4'),
    summary: L('Xətt nömrələri ilə künc nöqtələri.', 'Corner points named by line numbers.', 'Угловые пункты по номерам линий.'),
    steps: [
      { text: L(
        'Künc nöqtələri kənardan sayılan xətt nömrələri ilə adlanır. 4-4 (hoşi, ulduz) — hər iki istiqamətdə 4-cü xətt: ərazi və təsir arasında tarazlıq. 3-4 (komoku) — bir istiqamətdə 3-cü, digərində 4-cü xətt. 3-3 (sansan) — ərazini sürətlə təmin edir. Yuxarı sağ küncdə 4-4 nöqtəsini seçin:',
        'Corner points are named by their distance from the edges. The 4-4 point (hoshi, "star") is on the 4th line both ways — a balance of territory and influence. The 3-4 point (komoku) is on the 3rd line one way and the 4th the other. The 3-3 point (sansan) secures territory quickly. Play the 4-4 point in the top-right corner:',
        'Угловые пункты называют по удалённости от краёв. 4-4 (хоси, «звезда») — 4-я линия в обоих направлениях: баланс территории и влияния. 3-4 (комоку) — 3-я линия в одном направлении и 4-я в другом. 3-3 (сансан) быстро обеспечивает территорию. Поставьте камень в пункт 4-4 в правом верхнем углу:'),
        exercise: big({ type: 'point', points: [Q(15, 3)] }, { hint: L('Yuxarı və sağ kənardan 4-cü xətt.', '4th line from the top and from the right.', '4-я линия сверху и справа.'), success: L('Bu 4-4 nöqtəsidir (hoşi).', 'That is the 4-4 point (hoshi).', 'Это пункт 4-4 (хоси).') }) },
      { text: L('İndi 3-3 nöqtəsini seçin (yuxarı sağ künc).', 'Now play the 3-3 point (top-right corner).', 'Теперь выберите пункт 3-3 (правый верхний угол).'),
        exercise: big({ type: 'point', points: [Q(16, 2)] }, { hint: L('Hər iki kənardan 3-cü xətt.', '3rd line from both edges.', '3-я линия от обоих краёв.'), success: L('Bu 3-3 nöqtəsidir (sansan).', 'That is the 3-3 point (sansan).', 'Это пункт 3-3 (сансан).') }) },
      { text: L('Sonda 3-4 nöqtəsi: iki variant doğrudur (ikisi də 3-4).', 'Finally the 3-4 point: both orientations are correct.', 'Наконец, пункт 3-4: верны обе ориентации.'),
        exercise: big({ type: 'point', points: [Q(16, 3), Q(15, 2)] }, { hint: L('Bir tərəfdən 3-cü, digərindən 4-cü xətt.', '3rd line one way, 4th the other.', '3-я линия в одну сторону, 4-я в другую.'), success: L('Bu 3-4 nöqtəsidir (komoku).', 'That is the 3-4 point (komoku).', 'Это пункт 3-4 (комоку).') }) },
    ],
  },
  {
    slug: 'open-sanrensei', track: 'openings', position: 103, level: 2,
    title: L('Sanrensei (üç ulduz)', 'Sanrensei (three stars)', 'Санрэнсэй (три звезды)'),
    summary: L('Bir kənarda üç hoşi nöqtəsi.', 'Three star points along one side.', 'Три звёздные точки вдоль одной стороны.'),
    steps: [
      { text: L(
        'Sanrensei — bir kənar boyunca üç ulduz nöqtəsinin tutulmasıdır: iki künc ulduzu və aralarındakı kənar ulduzu. Məqsəd — həmin kənarda böyük təsir və potensial ərazi qurmaqdır. Sol kənarda üç ulduzu qoyun:',
        'Sanrensei means taking three star points in a row along one side: the two corner stars and the side star between them. The aim is large influence and potential territory on that side. Place the three stars on the left side:',
        'Санрэнсэй — занять три звёздные точки вдоль одной стороны: две угловые и боковую между ними. Цель — большое влияние и потенциальная территория на этой стороне. Поставьте три звезды на левой стороне:'),
        exercise: big({ type: 'place', points: [Q(3, 3), Q(3, 9), Q(3, 15)] }, { hint: L('Sol kənardan 4-cü xətt: yuxarı, orta, aşağı.', '4th line from the left: top, middle, bottom.', '4-я линия слева: верх, середина, низ.'), success: L('Sanrensei hazırdır.', 'Sanrensei complete.', 'Санрэнсэй готов.') }) },
    ],
  },
  {
    slug: 'open-tengen', track: 'openings', position: 104, level: 2,
    title: L('Tengen (mərkəz)', 'Tengen (the centre)', 'Тэнгэн (центр)'),
    summary: L('Taxtanın tam mərkəzi.', 'The exact centre point.', 'Точный центр доски.'),
    steps: [
      { text: L('Tengen — taxtanın tam mərkəzi nöqtəsidir (19×19-da 10-10). Mərkəzlə başlamaq nadir və iddialı açılışdır.', 'Tengen is the exact centre point of the board (K10 on 19×19). Opening in the centre is rare and ambitious.', 'Тэнгэн — точный центр доски (K10 на 19×19). Начинать с центра — редкий и амбициозный дебют.'),
        exercise: big({ type: 'point', points: [Q(9, 9)] }, { success: L('Düzdür — tengen.', 'Correct — tengen.', 'Верно — тэнгэн.') }) },
    ],
  },
  {
    slug: 'open-handicap', track: 'openings', position: 105, level: 2,
    title: L('Handikap daşları', 'Handicap stones', 'Камни форы'),
    summary: L('4 daşlı handikap künc ulduzlarına qoyulur.', 'A 4-stone handicap goes on the corner stars.', 'Фора в 4 камня ставится на угловые звёзды.'),
    steps: [
      { text: L('Handikap oyununda zəif oyunçu qara ilə əvvəlcədən daş qoyur, ağ isə birinci gedir. 4 daşlıq handikapda daşlar 4 küncün ulduz nöqtələrinə qoyulur. Onları yerləşdirin:', 'In a handicap game the weaker player (Black) starts with extra stones and White moves first. A 4-stone handicap goes on the four corner star points. Place them:', 'В партии с форой более слабый игрок (чёрные) заранее ставит камни, а белые ходят первыми. Четыре камня форы ставятся на четыре угловые звезды. Расставьте их:'),
        exercise: big({ type: 'place', points: FOUR_FOUR }, { success: L('Bu, GO PLAY-in 4 daşlıq handikapı ilə eynidir.', 'This matches GO PLAY’s 4-stone handicap.', 'Это совпадает с форой в 4 камня в GO PLAY.') }) },
    ],
  },
];

export const LESSONS: Lesson[] = [...BASIC_LESSONS.map((l) => ({ ...l, track: 'basics' as const })), ...OPENING_LESSONS];
export const LESSON_BY_SLUG = Object.fromEntries(LESSONS.map((l) => [l.slug, l]));
