"""Compare hand-authored kana with one actual Japanese ASR transcript.

The reference is never tagged, transliterated, guessed, or read by a dictionary.
Only ASR writing is read. Word-local UniDic kana/pron alternatives describe the
same *inflected* surface; no lemma, fuzzy match, or global long-vowel fold is used.
No acoustic model or synthesis is imported. The caller binds audioSha256.
"""
import functools
import hashlib
import importlib.metadata
from pathlib import Path
import re
import unicodedata

RULE_VERSION = 'strict-audio-equivalence-1'
METHOD = 'manual-kana-asr-only-1'
HIRA = re.compile(r'[ぁ-ゖー]+')
LATIN = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9]*(?:['’.-][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)*")
NUM = r'(?:[0-9]+(?:,[0-9]{3})*|[〇零一二三四五六七八九十百千万億]+)'
DIGITS = ['ぜろ','いち','に','さん','よん','ご','ろく','なな','はち','きゅう']
LETTERS = dict(zip('abcdefghijklmnopqrstuvwxyz', ['えー','びー','しー','でぃー','いー','えふ','じー','えいち','あい','じぇい','けー','える','えむ','えぬ','おー','ぴー','きゅー','あーる','えす','てぃー','ゆー','ゔぃー','だぶりゅー','えっくす','わい','ぜっと']))
# Fixed compounds whose standard reading cannot be recovered by tagging their
# individual characters (UniDic may split 金曜/日 and incorrectly choose ひ).
# No context-dependent single kanji (空, 方, 生, etc.) belongs in this table.
ASR_COMPOUNDS = {'月曜日':['げつようび','げつよーび'],'火曜日':['かようび','かよーび'],
 '水曜日':['すいようび','すいよーび'],'木曜日':['もくようび','もくよーび'],
 '金曜日':['きんようび','きんよーび'],'土曜日':['どようび','どよーび'],'日曜日':['にちようび','にちよーび'],
 # Japan Association of Refrigerated Warehouses, annotated terminology:
 # https://www.jarw.or.jp/wp/wp-content/uploads/2026/10/specified_skilled_worker_exam_prep_202607.pdf
 '段ボール箱':['だんぼーるばこ'],'ダンボール箱':['だんぼーるばこ'],'だんぼーる箱':['だんぼーるばこ'],
 # MEXT hosted Japanese-life teaching material, recipient label:
 # https://www.nihongo-ews.mext.go.jp/contents_files/download/?cfid=419&content_id=874
 '受取人':['うけとりにん'],'受け取り人':['うけとりにん'],
 # Publisher dictionary entries retain the complete compound boundary:
 # https://kotobank.jp/word/差出人-510456
 # https://kotobank.jp/word/荷送人-109117
 # https://kotobank.jp/word/校正刷り-62463
 # https://kotobank.jp/word/見本市-139428
 '差出人':['さしだしにん'],'差し出し人':['さしだしにん'],
 '荷送人':['におくりにん'],'荷送り人':['におくりにん'],
 '校正刷り':['こうせいずり','こーせいずり','こうせーずり','こーせーずり'],
 '見本市':['みほんいち'],
 # https://dictionary.cambridge.org/dictionary/english-japanese/airline
 # https://kotobank.jp/word/手荷物-576544
 # https://kotobank.jp/word/排水口-1128538
 # https://kotobank.jp/word/非常口-610049
 # https://kotobank.jp/word/親会社-2110
 # https://kotobank.jp/jazhword/子会社
 '航空会社':['こうくうがいしゃ','こーくーがいしゃ'],'手荷物':['てにもつ'],
 '排水口':['はいすいこう','はいすいこー'],'非常口':['ひじょうぐち','ひじょーぐち'],
 '親会社':['おやがいしゃ'],'子会社':['こがいしゃ'],
 # Sundai's furigana application form; Yamasa's complete-word dictionary:
 # https://www.sundai-it.ac.jp/international-jp/document/2026/application-form.pdf
 # https://db.yamasa.org/ocjs/kanjidic.nsf/SortedByKanji2THEnglish?Count=100&Expand=1827&OpenView=&Start=1822.66
 '入社日':['にゅうしゃび','にゅーしゃび'],
 '予定通り':['よていどおり','よてーどおり','よていどーり','よてーどーり'],
 # Japan Foundation N+どおり grammar; a closed list of the observed nouns,
 # not a global 通り replacement after verbs, の or numeric counters.
 # https://marugoto.jpf.go.jp/assets/docs/teacher/resource/intermediate2/intermediate2_teaching_topic.pdf
 '通常通り':[a+b for a in ['つうじょう','つーじょう','つうじょー','つーじょー'] for b in ['どおり','どーり']],
 '希望通り':[a+b for a in ['きぼう','きぼー'] for b in ['どおり','どーり']],
 '順番通り':['じゅんばんどおり','じゅんばんどーり'],
 '記載通り':['きさいどおり','きさいどーり'],
 '案内通り':['あんないどおり','あんないどーり'],
 # This full conventional expression, attested in both scripts in MHLW's
 # original care case study. Not a general adverb+通り rule.
 # https://www.mhlw.go.jp/content/12300000/001324281.pdf
 'これまで通り':['これまでどおり','これまでどーり'],
 # Complete-word readings in primary educational/industry dictionaries:
 # https://kids.gakken.co.jp/jiten/dictionary02100416/
 # https://imidas.jp/kojiten/detail/W-05-0-893-06.html
 # https://www.kitachiba-water.or.jp/site/user/1056.html
 # https://mmsrv.ninjal.ac.jp/kamus/data/item166.html
 # https://kennet.mhlw.go.jp/information/information/dictionary/heart/yk-039
 # https://www.ktr.mlit.go.jp/syuto/syuto_yougo001.html
 '過去形':['かこけい','かこけー'],'御中':['おんちゅう','おんちゅー'],
 '貯水池':['ちょすいち'],'番号札':['ばんごうふだ','ばんごーふだ'],
 '体内時計':['たいないどけい','たいないどけー'],'支間':['しかん'],
 # Logistics operator's annotated dispatch document:
 # https://www.hiroshima.coop/pdf_other/25042_5soudai.pdf
 '接車':['せっしゃ'],
 # Complete dated-event compounds, not a general 日→び substitution:
 # https://www.lib.yoshida.shizuoka.jp/TOSHOW/kids/kids_riyou.html
 # https://www.npo-nikken.com/manners/PDF_2/L1/S8.pdf
 # https://www.jipdec.or.jp/archives/publications/J0000818
 '研修日':['けんしゅうび','けんしゅーび'],'納品日':['のうひんび','のーひんび'],
 '到着日':['とうちゃくび','とーちゃくび'],
 # https://www.shinike-flat.com/howtouse/
 # https://www.orixlife.co.jp/words/003-016.html
 '利用日':['りようび','りよーび'],'開始日':['かいしび'],
 # Nara Women's University library's annotated return-deadline instructions.
 # https://www.nara-wu.ac.jp/aic/seminar/ryugakusei.pdf
 '返却期限日':['へんきゃくきげんび'],
 # Tokyo University of Foreign Studies dictionary; complete 初版本, not the
 # unrelated dictionary word 版本 (はんぽん) split after 初.
 # https://publication.aa-ken.jp/japanese_malayalam_dictionary.pdf
 '初版本':['しょはんぼん'],
 # Japan Federation of Printing Industries' complete typography term.
 # https://www.jfpi.or.jp/webyogo/index.php?term=1438
 '段組み':['だんぐみ'],'段組':['だんぐみ'],
 # Utterance-initial standalone 川 + の only. UniDic otherwise selects the
 # compound's voiced がわ even without a prefix; do not rewrite 小川 etc.
 # https://www.kanjipedia.jp/kotoba/0004034400
 '川の':['かわの'],
 # Only this attested pronoun+case-particle combination. Do not choose an
 # arbitrary なに/なん reading for isolated 何 or for 何か/何で/何に.
 # https://www.irodori.jpf.go.jp/assets/data/elementary02/pdf/Z_L05.pdf
 '何を':['なにを','なにお']}
KANA_PRON_LEMMAS = {'ちょうつがい':'蝶番','じょうろ':'ジョウロ-jorro','ありがとう':'有り難う',
 'でしょう':'です','よう':'様','どう':'どう','そう':'そう','もう':'もう',
 'こんにちは':'今日は','こんばんは':'今晩は','ましょう':'ます','めでとう':'めでたい'}
VOWELS = {}
for vowel, letters in [('あ','あかがさざただなはばぱまやらわぁゃゎ'),('い','いきぎしじちぢにひびぴみりゐぃ'),('う','うくぐすずつづぬふぶぷむゆるゔぅゅ'),('え','えけげせぜてでねへべぺめれゑぇ'),('お','おこごそぞとどのほぼぽもよろをぉょ')]:
    for letter in letters:VOWELS[letter]=vowel
# Finite, manually reviewed source-anchored spellings. This is not an English G2P
# dictionary. An unfamiliar Latin item cannot consume an arbitrary kana span.
LATIN_READINGS = {
 'ana':'あな','dev':'でゔ','eli':'いーらい','amir':'あみーる','morgan':'もーがん',
 'sol':'そる','marsh':'まーしゅ','cedar':'しーだー','keyrings':'きーりんぐず',
 'rill':'りる','ridge':'りっじ','café':'かふぇ','costumes':'こすちゅーむず',
 'harbor':'はーばー','pack':'ぱっく','reading':'りーでぃんぐ','fair':'ふぇあ',
 'lost':'ろすと','hat':'はっと','city':'してぃ','trees':'とりーず','park':'ぱーく',
 'west':'うえすと','hall':'ほーる','finch':'ふぃんち','tan':'たん','leaf':'りーふ','cart':'かーと',
 'mara':'まーら','lane':'れいん','print':'ぷりんと','ben':'べん','hana':'はな',
 'garden':'がーでん','walks':'うぉーくす','foldline':'ふぉーるどらいん',
 'arrow':'あろー','bindery':'ばいんだりー','irene':'あいりーん','elm':'えるむ',
 'mere':'みあ','house':'はうす','ash':'あっしゅ','vale':'ゔぇいる','pat':'ぱっと','lee':'りー',
 'bags':'ばっぐず','ahead':'あへっど','fern':'ふぁーん','hotel':'ほてる',
 'ina':'いな','cho':'ちょう','nell':'ねる','omar':'おまーる','east':'いーすと',
 'dara':'だーら','birch':'ばーち','books':'ぶっくす','davis':'でいびす','jo':'じょー',
 'mila':'みら','nina':'にーな','kim':'きむ','pier':'ぴあ','four':'ふぉー',
 'clear':'くりあ','rearrange':'りあれんじ','included':'いんくるーでっど',
 'provisional':'ぷろゔぃじょなる','stay':'すてい','there':'ぜあ',
 'refundable':'りふぁんだぶる','expects':'いくすぺくつ','reserved':'りざーぶど',
 'padding':'ぱでぃんぐ','collect':'これくと','found':'ふぁうんど','it':'いっと',
 'locate':'ろけいと','transaction':'とらんざくしょん','credit':'くれじっと',
 'forfeited':'ふぉーふぃてっど','fetch':'ふぇっち','the':'ざ','spare':'すぺあ',
 'if':'いふ','numbers':'なんばーず','are':'あー','corrected':'これくてぃっど',
 'spot':'すぽっと','fit':'ふぃっと','department':'でぱーとめんと',
 'dept':'でぃーいーぴーてぃー','account':'あかうんと','for':'ふぉー',
 'maya':'まや','noor':'ぬーる','mei':'めい','theo':'てお','mina':'みな',
 'way':'うぇい','out':'あうと','reyes':'れいえす','mira':'みら','facilities':'ふぁしりてぃーず',
 'boston':'ぼすとん','lisbon':'りすぼん','atlantic':'あとらんてぃっく','roy':'ろい',
 'road':'ろーど','green':'ぐりーん','street':'すとりーと','ellis':'えりす','pine':'ぱいん',
 'brighton':'ぶらいとん','nora':'のーら','l2':'えるつー','r1':'あーるわん','r3':'あーるすりー',
 'plus':'ぷらす','care':'けあ','h1':'えいちわん','h2':'えいちつー','h3':'えいちすりー',
 'travel':'とらべる','angel':'えんじぇる','perez':'ぺれす','rush':'らっしゅ',
 'amber':'あんばー','rose':'ろーず','snow':'すのー','sun':'さん','wave':'うぇーぶ','c4':'しーふぉー',
 'when':'うぇん','where':'うぇあ','who':'ふー','why':'わい','how':'はう','which':'うぃっち',
 'did':'でぃど','does':'だず','do':'どぅー','is':'いず','be':'びー','you':'ゆー',
 'has':'はず','have':'はゔ','will':'うぃる','should':'しゅっど','could':'くっど','would':'うっど',
 'had':'はど','was':'わず','luis':'るいす','dana':'でいな','rosa':'ろーざ',
 'split':'すぷりっと','batch':'ばっち','dispatch':'でぃすぱっち','weekender':'うぃーけんだー',
 'blocks':'ぶろっくす','carry':'きゃりー','distinguish':'でぃすてぃんぐいっしゅ','of':'おぶ',
 'sera':'せら','line':'らいん','remaining':'りめいにんぐ','oriel':'おーりえる','works':'わーくす',
 'lin':'りん','w1':'だぶりゅーわん','c1':'しーわん','moss':'もす','main':'めいん','annex':'あねっくす',
}


def _sha(value):
    return hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()


def _version(name):
    try:return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:return None


def _hira(text):
    # Script conversion only: every segment, small kana and long mark survives.
    return ''.join(chr(ord(c)-0x60) if 'ァ'<=c<='ヶ' else c for c in unicodedata.normalize('NFKC',text))


def _reference(text):
    out=[]
    for char in unicodedata.normalize('NFC',text):
        if re.fullmatch(r'[ぁ-ゖー]',char):out.append(char)
        elif char.isspace() or unicodedata.category(char).startswith('P'):continue
        else:raise ValueError('manual-reference-must-be-hiragana')
    return ''.join(out)


def _morae(kana):
    # Only an explicit long mark is expanded. Never change おう or えい here:
    # 追う/おう and 手いる/ている boundaries cannot acquire an extra long vowel.
    result=[]
    for char in kana:
        if char=='ー':
            if not result or result[-1] not in VOWELS:raise ValueError('unattached-long-mark')
            result.append(VOWELS[result[-1]])
        else:result.append(char)
    # Modern standard Japanese merges these two pairs; the pinned kana
    # renderer also emits exactly identical phones for each pair. This does
    # not merge unvoiced/voiced kana, v/b, long vowels, or geminates.
    # https://www.bunka.go.jp/seisaku/kokugo_nihongo/kokugo_shisaku/pdf/94340701_01.pdf
    return ''.join(result).replace('ぢ','じ').replace('づ','ず')


def _surface_variants(kana,pron):
    kana,pron=_hira(kana),_hira(pron)
    variants=[kana,pron]
    # A single surface can use mixed conventional/phonetic spelling, e.g.
    # 製造 せいぞー. Only positions explicitly marked long by this *same*
    # inflected dictionary token can vary; consonants and token edges cannot.
    if len(kana)==len(pron):
        positions=[i for i,(a,b) in enumerate(zip(kana,pron)) if a!=b]
        if len(positions)<=8 and all(i>0 and pron[i]=='ー' and kana[i] in 'あいうえお' for i in positions):
            variants=[kana]
            for i in positions:variants += [v[:i]+'ー'+v[i+1:] for v in variants]
    return list(dict.fromkeys(variants))


@functools.lru_cache(maxsize=1)
def _tagger():
    import fugashi,unidic
    return fugashi.Tagger('-d '+unidic.DICDIR)


def _integer(surface):
    if ',' in surface and not re.fullmatch(r'[1-9]\d{0,2}(?:,\d{3})+',surface):return None
    s=surface.replace(',','')
    if s.isascii() and s.isdigit():return int(s)
    chars=dict(zip('〇零一二三四五六七八九','00123456789'))
    if len(s)==1 and s in chars:return int(chars[s])
    for unit,multiplier in [('億',10**8),('万',10**4)]:
        if unit in s:
            if s.count(unit)!=1:return None
            a,b=s.split(unit);left=_integer(a);right=_integer(b) if b else 0
            if left is None or not 0<left<10000 or right is None or right>=multiplier:return None
            return left*multiplier+right
    if not any(x in s for x in '十百千'):return None
    total=0;digit=0;last=10000
    for c in s:
        if c in chars:
            if digit:return None
            digit=int(chars[c])
        elif c in '十百千':
            unit={'十':10,'百':100,'千':1000}[c]
            if unit>=last:return None
            total+=(digit or 1)*unit;digit=0;last=unit
        else:return None
    return total+digit


def _number(n):
    if not isinstance(n,int) or not 0<=n<10**12:raise ValueError('numeric-reading-out-of-scope')
    if n<10:return DIGITS[n]
    if n<100:return (DIGITS[n//10] if n>=20 else '')+'じゅう'+(_number(n%10) if n%10 else '')
    if n<1000:return {1:'ひゃく',3:'さんびゃく',6:'ろっぴゃく',8:'はっぴゃく'}.get(n//100,DIGITS[n//100]+'ひゃく')+(_number(n%100) if n%100 else '')
    if n<10000:return {1:'せん',3:'さんぜん',8:'はっせん'}.get(n//1000,DIGITS[n//1000]+'せん')+(_number(n%1000) if n%1000 else '')
    for unit,name in [(10**8,'おく'),(10**4,'まん')]:
        if n>=unit:return _number(n//unit)+name+(_number(n%unit) if n%unit else '')
    raise ValueError('numeric-reading-out-of-scope')


def _hour(n):
    if not 0<=n<=23:raise ValueError('invalid-clock-hour')
    return (_number(n-n%10) if n>=10 and n%10 in [4,7,9] else '')+({4:'よ',7:'しち',9:'く'}[n%10]+'じ' if n%10 in [4,7,9] else _number(n)+'じ')


def _counter(n,counter):
    if counter=='日後':
        # Reviewed complete duration expression, not standalone 後=ご.
        # https://www.kuins.ac.jp/en/international/assets/b8d678dabf8c689f3b63fd72f4581ab7e1cded11.pdf
        if n==2:return ['ふつかご']
        raise ValueError('unreviewed-days-later-counter')
    if counter=='泊':
        # Finite reviewed counter, not a guessed pronunciation for every 泊.
        # https://www.wanikani.com/vocabulary/二泊
        if n==2:return ['にはく']
        raise ValueError('unreviewed-night-counter')
    if counter=='分間':return [s+'かん' for s in _counter(n,'分')]
    if counter=='日中' and n==1:return ['いちにちじゅう']
    if counter=='名':return [_number(n)+'めい',_number(n)+'めー']
    if counter=='着':
        if n>10:raise ValueError('unreviewed-large-clothing-counter')
        return [{1:'いっちゃく',8:'はっちゃく',10:'じゅっちゃく'}.get(n,_number(n)+'ちゃく')]
    if counter=='冊' and n==1:return ['いっさつ']
    if counter=='足' and n==1:return ['いっそく']
    if counter=='組':return [{1:'ひとくみ',2:'ふたくみ'}.get(n,_number(n)+'くみ')]
    if counter=='時':return [_hour(n)]
    if counter=='月':
        if not 1<=n<=12:raise ValueError('invalid-calendar-month')
        return [{4:'し',7:'しち',9:'く'}.get(n,_number(n))+'がつ']
    if counter in ['個','分','本','回','階','通']:
        if n>=1000:raise ValueError('unreviewed-large-irregular-counter')
        names={'個':'こ','分':'ふん','本':'ほん','回':'かい','階':'かい','通':'つう'}
        special={'個':{1:'いっこ',6:'ろっこ',8:'はっこ',10:'じゅっこ'},'分':{1:'いっぷん',3:'さんぷん',4:'よんぷん',6:'ろっぷん',8:'はっぷん',10:'じゅっぷん'},'本':{1:'いっぽん',3:'さんぼん',6:'ろっぽん',8:'はっぽん',10:'じゅっぽん'},'回':{1:'いっかい',6:'ろっかい',8:'はっかい',10:'じゅっかい'},'階':{1:'いっかい',3:'さんがい',6:'ろっかい',8:'はっかい',10:'じゅっかい'},'通':{1:'いっつう',8:'はっつう',10:'じゅっつう'}}[counter]
        last=n%10
        if n and last in special:return [(_number(n-last) if n>=10 else '')+special[last]]
        if n and n%10==0 and n%100:
            tens=n%100;return [(_number(n-tens) if n>=100 else '')+(_number(tens//10) if tens>=20 else '')+special[10]]
        reading=_number(n)
        if n and n%100==0 and reading.endswith('く') and counter in ['個','分','本','回','階']:
            return [reading[:-1]+'っ'+{'個':'こ','分':'ぷん','本':'ぽん','回':'かい','階':'かい','通':'つう'}[counter]]
        return [reading+names[counter]]
    if counter=='人':
        if n in [1,2]:return [{1:'ひとり',2:'ふたり'}[n]]
        return [(_number(n-4) if n>4 else '')+'よにん' if n%10==4 else _number(n)+'にん']
    if counter=='日':return [_day(n,False)]
    if counter=='箱':
        reading={1:'ひとはこ',2:'ふたはこ'}.get(n,_number(n)+'はこ')
        return [reading]+([_number(n)[:-3]+'じゅっぱこ'] if n>0 and n%10==0 and _number(n).endswith('じゅう') else [])
    if counter=='鉢':return [{1:'ひとはち',2:'ふたはち'}.get(n,_number(n)+'はち')]
    if counter in ['週間','週','件','社']:
        if counter=='件' and n==1000:return ['せんけん']
        if n>=100 and counter=='社':raise ValueError('unreviewed-large-irregular-counter')
        if n>=1000 and counter=='件':raise ValueError('unreviewed-large-irregular-counter')
        suffix={'週間':'しゅうかん','週':'しゅう','件':'けん','社':'しゃ'}[counter]
        last=n%10
        if counter=='件' and last==6:return [(_number(n-6) if n>=10 else '')+'ろっけん']
        if last in [1,8]:return [(_number(n-last) if n>=10 else '')+{1:'いっ',8:'はっ'}[last]+suffix]
        if n%10==0 and n%100:
            tens=n%100;return [(_number(n-tens) if n>=100 else '')+(_number(tens//10) if tens>=20 else '')+'じゅっ'+suffix]
        reading=_number(n)
        if counter=='件' and n%100==0 and reading.endswith('く'):reading=reading[:-1]+'っ'
        return [reading+suffix]
    if counter=='時間':
        # Duration 4/14 hours uses よじかん; unlike a clock, 7/9 use なな/きゅう.
        return [(_number(n-4) if n>4 else '')+'よじかん' if n%10==4 else _number(n)+'じかん']
    names={'枚':'まい','台':'だい','社':'しゃ','件':'けん','番':'ばん','年':'ねん','ページ':'ぺーじ','メートル':'めーとる','センチ':'せんち','グラム':'ぐらむ','週間':'しゅうかん','週':'しゅう','営業日':'えいぎょうび','ドル':'どる','セント':'せんと'}
    if counter not in names:raise ValueError('unreviewed-counter')
    return [_number(n)+names[counter]]


def _day(n,date):
    if n<1 or date and n>31:raise ValueError('invalid-calendar-day')
    special={2:'ふつか',3:'みっか',4:'よっか',5:'いつか',6:'むいか',7:'なのか',8:'ようか',9:'ここのか',10:'とおか',14:'じゅうよっか',20:'はつか',24:'にじゅうよっか'}
    if date and n==1:return 'ついたち'
    return special.get(n,_number(n)+'にち')


def _numeric_at(text,index):
    """Read numeric ASR notation without changing its value, unit or sign."""
    rest=text[index:]
    clock=re.match(r'(\d{1,2}):(\d{2})(?![\d:])',rest)
    if clock:
        hour,minute=map(int,clock.groups())
        if minute>=60:raise ValueError('invalid-clock-minute')
        return len(clock[0]),[_hour(hour)+(_counter(minute,'分')[0] if minute else '')],'clock'
    date=re.match('('+NUM+r')月\s*('+NUM+r')日',rest)
    if date:
        month,day=map(_integer,date.groups())
        if month is None or day is None:raise ValueError('unknown-date-numeral')
        return len(date[0]),[x+_day(day,True) for x in _counter(month,'月')],'calendar-date'
    percent=re.match('('+NUM+r')(?:%|パーセント)',rest)
    if percent:
        n=_integer(percent[1])
        if n is None:raise ValueError('unknown-percent-numeral')
        number=_number(n);values=[number+'ぱーせんと']
        if number.endswith('じゅう'):values.append(number[:-3]+'じゅっぱーせんと')
        return len(percent[0]),values,'integer-percent'
    m=re.match('('+NUM+r')(文目|つ|点)',rest)
    if m:
        n=_integer(m[1])
        if n is None:raise ValueError('unknown-counter-numeral')
        if m[2]=='つ':
            reading={1:'ひとつ',2:'ふたつ',3:'みっつ',4:'よっつ',5:'いつつ',6:'むっつ',7:'ななつ',8:'やっつ',9:'ここのつ',10:'とお'}.get(n)
            if not reading:raise ValueError('unreviewed-native-counter')
        elif m[2]=='文目':reading=_number(n)+'ぶんめ'
        else:
            if n==1:reading='いってん'
            else:raise ValueError('unreviewed-point-counter')
        return len(m[0]),[reading],'fixed-counter:'+m[2]
    m=re.match('('+NUM+r')\s*(営業日|メートル|センチ|グラム|ページ|セント|ドル|週間|時間|分間|日中|日後|[時分人個枚本回階箱鉢台社件通番年月日週名着冊足組泊])',rest)
    if m:
        value=_integer(m[1])
        if value is None:raise ValueError('unknown-counter-numeral')
        return len(m[0]),_counter(value,m[2]),'counter:'+m[2]
    magnitude=re.match(r'(\d+(?:,\d{3})*)(万|億)',rest)
    if magnitude:
        value=_integer(magnitude[1])
        if value is None:raise ValueError('unknown-magnitude-number')
        return len(magnitude[0]),[_number(value)+{'万':'まん','億':'おく'}[magnitude[2]]],'numeric-magnitude'
    money_decimal=re.match(r'\$(\d+)\.(\d{2})(?!\d)',rest)
    if money_decimal:
        whole,cents=map(int,money_decimal.groups())
        return len(money_decimal[0]),[_number(whole)+'どる'+(_number(cents)+'せんと' if cents else '')],'dollars-and-cents'
    money=re.match(r'\$(\d+)(?![\d.,])',rest)
    if money:return len(money[0]),[_number(int(money[1]))+'どる'],'whole-dollar-symbol'
    decimal=re.match(r'(\d+)\.(\d+)(?!\d)',rest)
    if decimal:
        head=_number(int(decimal[1]));tail=''.join(DIGITS[int(c)] for c in decimal[2])
        return len(decimal[0]),[head+'てん'+tail]+(['れいてん'+tail] if int(decimal[1])==0 else []),'decimal-digits'
    m=re.match(r'\d+(?:,\d+)*',rest)
    if m:
        if rest[len(m[0]):len(m[0])+1] in ['.',':','/']:raise ValueError('unreviewed-numeric-format')
        return len(m[0]),[_number(_integer(m[0]))],'integer'
    return None


def _source_latin(word,source):
    source=unicodedata.normalize('NFKC',source)
    key=word.casefold();source_latin=list(LATIN.finditer(source));anchors={m[0].casefold().rstrip('.') for m in source_latin}
    # ASR may omit the typographic space in an explicitly source-written
    # initial and surname (M. Davis -> M.DAVIS). Both original components must
    # have an independently reviewed reading; dotted identifiers are not names.
    initial_name=re.fullmatch(r'([A-Za-z])\.([A-Za-z]+)',word)
    if initial_name and any(a[0].casefold()==initial_name[1].casefold()
            and b[0].casefold()==initial_name[2].casefold()
            and re.fullmatch(r'\.\s+',source[a.end():b.start()])
            for a,b in zip(source_latin,source_latin[1:])):
        return [a+b for a in _source_latin(initial_name[1],source) for b in _source_latin(initial_name[2],source)]
    # Actual ASR sometimes writes the familiar brand spelling for the same
    # Japanese loanword. Only this exact spelling and standalone source loanword
    # are reviewed; this does not authorize arbitrary English transliteration.
    # https://www.lycorp.co.jp/news/archive/L/ja/ja20190418_B.pdf
    if word=='LINE' and re.search(r'(?<![ァ-ヶー])ライン(?![ァ-ヶー])',source):return ['らいん']
    # A source-explicit English be in grammar explanations and the letter B
    # share the already reviewed reading びー. This alias is not enabled for
    # other source words, names, changed verb forms, or arbitrary letter runs.
    if key=='b' and 'be' in anchors:return [LATIN_READINGS['be']]
    if key not in anchors:raise ValueError('latin-asr-not-in-source:'+word)
    if key in LATIN_READINGS:
        value=LATIN_READINGS[key]
        # Individually reviewed familiar name/loanword spellings. Do not apply
        # these replacements to arbitrary kana or a different English word.
        phonetic={'lane':'れーん','vale':'ゔぇーる','davis':'でーびす','cho':'ちょー','stay':'すてー','west':'うぇすと'}
        return [value]+([phonetic[key]] if key in phonetic else [])
    if len(key)==1 and key in LETTERS:return [LETTERS[key]]+({'j':['じぇー'],'k':['けい']}.get(key,[]))
    raise ValueError('unknown-latin-reading:'+word)


def _source_latin_date(text,index,source):
    # An explicitly written source calendar date may be transcribed in its
    # original month spelling. Do not turn a person's name June into 六月.
    names=['January','February','March','April','May','June','July','August','September','October','November','December']
    match=re.match(r'('+('|'.join(names))+r')\s+([0-9]{1,2})(?![0-9])',text[index:],re.I)
    if not match:return None
    month=next(i+1 for i,name in enumerate(names) if name.casefold()==match[1].casefold());day=int(match[2])
    if not re.search(r'\b'+re.escape(match[1])+r'\s+'+re.escape(match[2])+r'(?![0-9])',source,re.I):raise ValueError('latin-calendar-not-in-source')
    return len(match[0]),[v+_day(day,True) for v in _counter(month,'月')],'source-anchored-calendar'


def _source_unit(text,index,source):
    # The original Japanese wording establishes this unit, not the reference
    # kana. Do not reinterpret arbitrary model letters or change the amount.
    match=re.match(r'(\d+)\s*(g(?![A-Za-z0-9])|m(?=$|[^A-Za-z0-9]|\d+(?:ドル|セント)))',text[index:])
    if not match:return None
    unit,reading={'g':('グラム','ぐらむ'),'m':('メートル','めーとる')}[match[2]]
    if not re.search(r'(?<![\d.,])'+re.escape(match[1])+r'\s*'+unit,source):
        raise ValueError('unit-symbol-not-anchored-in-source')
    return len(match[0]),[_number(int(match[1]))+reading],'source-anchored-unit-symbol:'+match[2]


def _fixed_at(text,index):
    return next((s for s in ASR_COMPOUNDS if text.startswith(s,index)
        and not (s=='川の' and index!=0)
        and not (s=='御中' and text.startswith('御中元',index))
        and not (s=='接車' and index>0 and re.fullmatch(r'[\u3400-\u9fff々]',text[index-1]))),None)


def _reading_tokens(recognized,source):
    text=unicodedata.normalize('NFKC',recognized);chunks=[];i=0
    # Shield reviewed numeric and Latin spans before the ASR-only tagger. The
    # hand-authored reference is not used to choose a number or name reading.
    def append(surface,variants,method,**extra):
        variants=list(dict.fromkeys(_hira(v) for v in variants))
        if not variants or any(not HIRA.fullmatch(v) for v in variants):raise ValueError('unknown-asr-reading:'+surface)
        chunks.append({'surface':surface,'variants':variants,'method':method,**extra})
    while i<len(text):
        c=text[i]
        if c.isspace():i+=1;continue
        fixed=_fixed_at(text,i)
        if fixed:
            append(fixed,ASR_COMPOUNDS[fixed],'reviewed-fixed-compound');i+=len(fixed);continue
        if c in '+-−' and re.match(r'\s*(?:[$¥£€]\s*)?'+NUM,text[i+1:]):
            append(c,['ぷらす' if c=='+' else 'まいなす'],'numeric-sign');i+=1;continue
        numeric=_source_latin_date(text,i,source) or _source_unit(text,i,source) or _numeric_at(text,i)
        if numeric:
            size,values,method=numeric
            # A version/fraction/partially parsed clock must not become a
            # single decimal merely because punctuation is normally silent.
            if re.match(r'(?:[.,]\d|[:/])',text[i+size:]):raise ValueError('unreviewed-multi-part-number')
            # These changes are local to already parsed numeric compounds.
            # They cannot cross a particle or a verb/morpheme boundary.
            phonetic=[v.replace('じゅう','じゅー').replace('きゅう','きゅー').replace('しゅう','しゅー').replace('えいぎょう','えーぎょー').replace('つう','つー').replace('ようか','よーか').replace('れい','れー') for v in values]
            append(text[i:i+size],values+phonetic,method);i+=size;continue
        latin=LATIN.match(text,i)
        if latin:
            append(latin[0],_source_latin(latin[0],source),'source-anchored-latin');i=latin.end();continue
        if c.isdigit() or c in '$¥£€%+−':raise ValueError('unreviewed-numeric-symbol')
        if unicodedata.category(c).startswith('P'):i+=1;continue
        # Stop before a numeric or Latin span so neither can disappear inside
        # an unknown dictionary token. Preserve current inflection exactly.
        end=i+1
        while end<len(text) and not text[end].isascii() and not text[end].isspace() and not unicodedata.category(text[end]).startswith('P'):
            if _numeric_at(text,end) or _fixed_at(text,end):break
            end+=1
        fragment=text[i:end]
        cursor=0
        for node in _tagger()(fragment):
            surface=node.surface;f=node.feature
            at=fragment.find(surface,cursor);cursor=at+len(surface)
            if all(unicodedata.category(x).startswith('P') for x in surface):continue
            if getattr(f,'pos1',None)=='助詞' and surface in ['は','へ','を']:
                append(surface,{'は':['わ'],'へ':['え'],'を':['を','お']}[surface],'grammatical-particle');continue
            if surface=='不足' and (i+at==0 or not re.fullmatch(r'[\u3400-\u9fff々]',text[i+at-1])):
                # Standalone ふそく, not the rendaku suffix in 資金不足.
                # Shogakukan dictionary: https://kotobank.jp/word/不足-618627
                append(surface,['ふそく'],'reviewed-standalone-word');continue
            if re.fullmatch(r'[ぁ-ゖァ-ヶー]+',surface):
                # UniDic can split literal だーら into だ / ー / ら. Keep an
                # explicitly written, physically adjacent long mark with its
                # preceding literal kana; never borrow across a separator or
                # attach it to a dictionary/particle-derived pronunciation.
                if surface.startswith('ー') and at>0 and chunks:
                    previous=chunks[-1]
                    if previous['method']=='literal-asr-kana' and fragment[:at].endswith(previous['surface']):
                        previous['surface']+=surface
                        previous['variants']=[_hira(previous['surface'])]
                        continue
                values=[surface]
                lemma=getattr(f,'lemma',None)
                reviewed=surface in KANA_PRON_LEMMAS and (KANA_PRON_LEMMAS[surface]==lemma or surface=='そう' and str(lemma).startswith('そう-'))
                if reviewed and (surface in source or KANA_PRON_LEMMAS[surface].split('-')[0] in source):
                    # Prevent the erroneous お/もう analysis of 思う from
                    # introducing a long vowel. もう must be independently
                    # written in both ASR and source, never a suffix of おもう.
                    separate=(surface!='もう' or ((at==0 or fragment[at-1]!='お') and re.search(r'(?<!お)もう',source)))
                    if separate and getattr(f,'pron',None) not in [None,'*']:values.append(f.pron)
                append(surface,values,'literal-asr-kana' if len(values)==1 else 'reviewed-kana-word-pron');continue
            kana=getattr(f,'kana',None);pron=getattr(f,'pron',None)
            if not kana or kana=='*' or not pron or pron=='*':raise ValueError('unknown-kanji-reading:'+surface)
            append(surface,_surface_variants(kana,pron),'unidic-current-surface',pos=getattr(f,'pos1',None),inflection=getattr(f,'cForm',None))
        i=end
    return chunks


def _align(reference,chunks):
    reference=_morae(reference)
    states={0:[]}
    for chunk in chunks:
        following={}
        for offset,path in states.items():
            for value in chunk['variants']:
                normalized=_morae(value)
                if reference.startswith(normalized,offset):following.setdefault(offset+len(normalized),path+[value])
        states=following
        if not states:return None
    return states.get(len(reference))


def compare(spoken,recognized,source_text):
    """Return strict-audio-equivalence-1-shaped evidence, without audioSha256."""
    code_sha=_sha(Path(__file__).read_bytes())
    result={'equivalent':False,'ruleVersion':RULE_VERSION,'language':'ja','expectedSpoken':spoken,'recognized':recognized,'reasons':[],
        'normalizedExpected':None,'normalizedRecognized':None,'proofExpected':None,'proofRecognized':None,
        'provenance':{'comparison':METHOD,'referencePolicy':'literal-handwritten-kana; never tokenized or re-read','asrPolicy':'ASR-only current-surface kana/pron; no lemma or fuzzy matching',
            'fugashi':_version('fugashi'),'unidic':_version('unidic'),'normalizer':METHOD,'phonemeOverride':True,'articlePolicyEnabled':False,
            'ruleFileSha256':code_sha,'normalizerFileSha256':code_sha,'sourceTextSha256':_sha(source_text) if isinstance(source_text,str) else None}}
    if not all(isinstance(x,str) and x.strip() for x in [spoken,recognized,source_text]):
        result['reasons']=['empty-input-is-not-evidence'];return result
    try:
        expected=_reference(spoken);result['normalizedExpected']=expected
        if not expected:raise ValueError('empty-manual-reference')
        signs=re.findall(r'(?<![A-Za-z0-9_.])([+−-])\s*(?:[$¥£€]\s*)?\d',source_text)
        for sign in set(signs):
            marker='ぷらす' if sign=='+' else 'まいなす'
            if expected.count(marker)<sum(('ぷらす' if x=='+' else 'まいなす')==marker for x in signs):raise ValueError('source-numeric-sign-missing-from-reference')
        chunks=_reading_tokens(recognized,source_text);result['readingTrace']={'expected':[],'recognized':chunks}
        result['normalizedRecognized']=''.join(c['variants'][0] for c in chunks)
        selected=_align(expected,chunks)
        if selected is None:result['reasons']=['non-equivalent-morae-remain'];return result
        result.update(equivalent=True,proofExpected=_morae(expected),proofRecognized=_morae(''.join(selected)),reasons=['exact-manual-kana-vs-asr-surface-reading'])
        for chunk,value in zip(chunks,selected):chunk['selected']=value
    except (ValueError,KeyError,TypeError) as error:result['reasons']=[str(error)]
    return result
