"""Strict text/reading equivalence for *existing* ASR evidence; never a quality score.

No fuzzy distance, acoustic model, synthesis, or alternate transcript is used.
Optional normalizer is the author's existing normalize(text, language) callable.
"""
import functools
import hashlib
import importlib.metadata
from pathlib import Path
import re
import unicodedata

RULE_VERSION = 'strict-audio-equivalence-1'
# Finite reviewed boundary spellings. No arbitrary whitespace removal: e.g.
# therapist/the rapist and nowhere/now here are NOT interchangeable.
COMPOUNDS = {
    'worktable':'work table', 'windowpane':'window pane', 'partway':'part way',
    'preorder':'pre order', 'preorders':'pre orders', 'lockbox':'lock box',
    'lockboxes':'lock boxes', 'noticeboard':'notice board', 'glassmaking':'glass making',
    'pickup':'pick up', 'overtime':'over time', 'inbound':'in bound',
    'nonrefundable':'non refundable', 'handout':'hand out', 'preprinted':'pre printed',
    'waybill':'way bill', 'reelected':'re elected', 'byproducts':'by products',
    'shutoff':'shut off', 'checkout':'check out', 'nonstop':'non stop',
    'stopover':'stop over', 'stockroom':'stock room', 'shortlist':'short list',
    'railcar':'rail car', 'truckload':'truck load', 'nonperishable':'non perishable',
    'pricelist':'price list', 'washbasin':'wash basin', 'sellout':'sell out',
    'coworker':'co worker', 'firsthand':'first hand', 'onstage':'on stage',
    'worktops':'work tops', 'counterslip':'counter slip', 'fieldwork':'field work',
    'underway':'under way', 'everyday':'every day',
}
SPELLINGS = {
    'grey':'gray', 'colour':'color', 'colours':'colors', 'coloured':'colored',
    'favour':'favor', 'favourite':'favorite', 'centre':'center', 'centres':'centers',
    'theatre':'theater', 'theatres':'theaters', 'litre':'liter', 'litres':'liters',
    'metre':'meter', 'metres':'meters', 'cancelled':'canceled', 'cancelling':'canceling',
    'travelling':'traveling', 'travelled':'traveled', 'traveller':'traveler',
    'labelled':'labeled', 'labelling':'labeling', 'organise':'organize',
    'organised':'organized', 'organising':'organizing', 'organisation':'organization',
    'recognise':'recognize', 'recognised':'recognized', 'analyse':'analyze',
    'analysed':'analyzed', 'catalogue':'catalog', 'catalogues':'catalogs',
    'entrée':'entree', 'entrées':'entrees',
    'cheque':'check', 'cheques':'checks', 'mould':'mold', 'moulds':'molds',
}
CONTRACTIONS = {
    "can't":'can not', 'cannot':'can not', "won't":'will not', "shan't":'shall not',
    "aren't":'are not', "isn't":'is not', "wasn't":'was not', "weren't":'were not',
    "don't":'do not', "doesn't":'does not', "didn't":'did not', "hasn't":'has not',
    "haven't":'have not', "hadn't":'had not', "shouldn't":'should not',
    "wouldn't":'would not', "couldn't":'could not', "mustn't":'must not',
    "needn't":'need not', "i'm":'i am', "you're":'you are', "we're":'we are',
    "they're":'they are', "let's":'let us',
}
ARTICLES = {'a','an','the'}
LABEL_CONTEXT = r'desk|room|gate|exit|door|area|zone|option|answer|choice|plan|type|model|grade|class|section|row|column|line|rack|shelf|route|terminal|platform|part|point|item|sample|version|unit|hall|booth|building|entrance|block|counter|bay|aisle|seat|group|category|table|chart|box|board'
# Dictionary pronunciation alone cannot choose the contextual sense of these
# surfaces. A changed ASR spelling must remain review without an explicit kana
# spoken input; this also guards known phone-only corrections in the library.
AMBIGUOUS_JA = frozenset('空 方 上方 表 裏 間 中 上 下 生 行 人 額 角 端 数 分 本 後 前 朝 昼 夜 日 月 年 大家 市場 開く 開いて 開いた 辛い 人気'.split())
LETTER_PHONES = {'a':'EY','b':'B IY','c':'S IY','d':'D IY','e':'IY','f':'EH F',
    'g':'JH IY','h':'EY CH','i':'AY','j':'JH EY','k':'K EY','l':'EH L','m':'EH M',
    'n':'EH N','o':'OW','p':'P IY','q':'K Y UW','r':'AA R','s':'EH S','t':'T IY',
    'u':'Y UW','v':'V IY','w':'D AH B AH L Y UW','x':'EH K S','y':'W AY','z':'Z IY'}


@functools.lru_cache(maxsize=16)
def _code_sha(normalizer=None):
    path=Path(normalizer.__code__.co_filename) if normalizer and hasattr(normalizer,'__code__') else Path(__file__)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _version(name):
    try:return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:return None


@functools.lru_cache(maxsize=1)
def _cmu():
    import cmudict
    return cmudict.dict()


@functools.lru_cache(maxsize=10000)
def _phones(word):
    if word.startswith('letter') and len(word)==7 and word[-1] in LETTER_PHONES:
        return frozenset([tuple(LETTER_PHONES[word[-1]].split())])
    if word in ['meridiemam','meridiempm']:
        return frozenset([tuple((LETTER_PHONES[word[-2]]+' '+LETTER_PHONES['m']).split())])
    rows=_cmu().get(word,[])
    # Stress digits alone are removed; segmental vowels/consonants remain.
    # Require the WHOLE pronunciation set to match, never a favourable variant.
    return frozenset(tuple(re.sub(r'\d','',p) for p in row) for row in rows)


def _source_formatted_english(expected, recognized, source, normalizer):
    """Restore only ASR typography explicitly anchored to this source input.

    Never rewrite an explicit spoken plural, conjunction or alternative reading.
    Numeric/abbreviation symbols are ambiguous written renderings of speech;
    a source anchor chooses their surface expansion, not a new acoustic result.
    """
    if not source:
        return recognized, []
    source = unicodedata.normalize('NFKC', source)
    actual = unicodedata.normalize('NFKC', recognized)
    rules = []
    # The source teaches the written abbreviation dept.; the selected input
    # explicitly spells D E P T. Do not equate a source word with arbitrary
    # initials, expand arbitrary acronyms, or replace the word department.
    if (re.search(r'(?<!\w)dept\.(?!\w)', source, re.I) and
            re.search(r'(?<!\w)D E P T(?!\w)', expected)):
        actual, n = re.subn(r'(?<!\w)DEPT(?!\w)', 'D E P T', actual)
        if n:
            rules.append('source-spelled-abbreviation:DEPT=D E P T')
    # Only an unchanged numeric value and the same explicit source unit are
    # joined. In particular this does not infer V/volts or any new unit.
    for match in re.finditer(r'(?<![\w.])(\d+(?:\.\d+)?)\s+(V)(?!\w)', source):
        number, unit = match.groups()
        actual, n = re.subn(r'(?<![\w.$])' + re.escape(number + unit) + r'(?!\w)',
                            number + ' ' + unit, actual)
        if n:
            rules.append('source-anchored-unit-spacing:' + number + ' ' + unit)
    # One reviewed written-clock case has a word-form source, not a colon.
    # Do not reinterpret arbitrary decimals or loosely matching time phrases.
    if (re.search(r"\b(?:It's|It is) already six fifteen[.!?]?$", source) and
            re.search(r'\balready six fifteen[.!?]?$', expected)):
        actual, n = re.subn(r'(?<![\w.$+−-])6\.15(?!\w|\.\d)', 'six fifteen', actual)
        if n:
            rules.append('source-anchored-written-clock:already six fifteen')

    def words(number):
        if normalizer:
            return normalizer(number, 'en')
        from num2words import num2words
        return num2words(int(number))

    # Four explicitly reviewed monetary ellipses. ASR may put $ on both
    # amounts even though the selected input says the unit only once. Restore
    # only this exact source+spoken phrase and exact symbol values/context;
    # explicit transcript words with extra dollars are never removed.
    ellipses = (
        ('from forty dollars to thirty', r'from \$40 to \$30', '40-to-30'),
        ('from two dollars per notebook to three', r'from \$2 per notebook to \$3', '2-to-3-per-notebook'),
        ('eight and six dollars respectively', r'\$8 and \$6 respectively', '8-and-6-respectively'),
        ('from eighty thousand dollars to ninety thousand', r'from \$80,000 to \$90,000', '80000-to-90000'),
    )
    for phrase, pattern, label in ellipses:
        anchor = r'(?<!\w)' + re.escape(phrase) + r'(?!\w)'
        if re.search(anchor, source, re.I) and re.search(anchor, expected, re.I):
            actual, n = re.subn(r'(?<![\w.+−-])' + pattern + r'(?!\w|\.\d|,\d)', phrase, actual, flags=re.I)
            if n:
                rules.append('source-anchored-currency-ellipsis:' + label)
    # A written voting tally is a "to" relation, not a minus operation. This
    # is intentionally the one reviewed phrase; arbitrary hyphens stay intact.
    vote = 'voted seven to two'
    if re.search(r'\b'+vote+r'\b', source, re.I) and re.search(r'\b'+vote+r'\b', expected, re.I):
        actual, n = re.subn(r'\bvoted 7-2(?!\w|\.\d|,\d)', vote, actual, flags=re.I)
        if n:
            rules.append('source-anchored-vote-tally:7-2=seven to two')

    def scaled_money(match):
        digits, scale = match.groups()
        phrase = words(digits) + ' ' + scale.lower() + ' dollars'
        anchor = r'(?<!\w)' + re.escape(phrase) + r'(?!\w)'
        if re.search(anchor, source, re.I) and re.search(anchor, expected, re.I):
            rules.append('source-anchored-scaled-currency:' + digits + ' ' + scale.lower())
            return phrase
        return match.group(0)
    actual = re.sub(r'(?<![\w.+−-])\$(\d+)\s+(million|billion)(?!\w)', scaled_money, actual, flags=re.I)

    # The selected spoken override reads dollars and cents, unlike the generic
    # source normalizer's decimal-dollars style. Restore exactly that same
    # explicit input only when the source has the same written cents amount.
    def cents_money(match):
        whole, cents = match.groups()
        phrase = words(whole) + (' dollar ' if int(whole)==1 else ' dollars ') + words(cents) + (' cent' if int(cents)==1 else ' cents')
        symbol = '$' + whole + '.' + cents
        anchor = r'(?<!\w)' + re.escape(phrase) + r'(?!\w)'
        source_symbol = r'(?<![\w.+−-])' + re.escape(symbol) + r'(?!\d)'
        if re.search(source_symbol, source) and re.search(anchor, expected, re.I):
            rules.append('source-anchored-cents-input:' + symbol + '=' + phrase)
            return phrase
        return match.group(0)
    actual = re.sub(r'(?<![\w.+−-])\$(\d+)\.(\d{2})(?!\d)', cents_money, actual)

    # A $ amount written by ASR does not establish an audible plural /z/.
    # Restore singular dollar only at the exact source compound + following
    # noun. Explicit "fifty dollars deposit" remains a different transcript.
    def adjectival_money(match):
        digits, noun = match.group(1), match.group(2)
        phrase = words(digits).replace('-', ' ')
        word_pattern = re.escape(phrase).replace(r'\ ', r'[ -]+')
        anchor = r'(?<![\w-])' + word_pattern + r'-dollar\s+' + re.escape(noun) + r'(?!\w)'
        source_symbol = r'(?<![\w.+−-])\$' + re.escape(digits) + r'\s+' + re.escape(noun) + r'(?!\w)'
        if (re.search(anchor, source, re.I) or re.search(source_symbol, source, re.I)) and re.search(anchor, expected, re.I):
            rules.append('source-anchored-adjectival-currency:' + digits + '-dollar ' + noun.lower())
            return phrase + '-dollar ' + noun
        return match.group(0)
    actual = re.sub(r'(?<![\w.+−-])\$(\d+)\s+([A-Za-z]+)\b', adjectival_money, actual)

    # ASR's 160 may spell the source's "one hundred sixty" without adding the
    # optional British-style and introduced by num2words. Only raw 3-digit
    # notation can take this branch; a transcript explicitly containing and
    # is preserved, as are changed numeric values, units and plurals.
    def source_hundreds(match):
        digits = match.group(0)
        rendered = words(digits)
        if ' hundred and ' not in rendered:
            return digits
        concise = rendered.replace(' hundred and ', ' hundred ')
        pattern = r'(?<!\w)' + re.escape(concise).replace(r'\-', '[ -]').replace(r'\ ', '[ -]+') + r'(?!\w)'
        if re.search(pattern, source, re.I) and re.search(pattern, expected, re.I):
            rules.append('source-anchored-number-style:' + digits + '=' + concise)
            return concise
        return digits
    actual = re.sub(r'(?<![\w.$:+−-])[1-9]\d{2}(?![\w:]|\.\d)', source_hundreds, actual)
    return actual, rules


def _numeric(text, language, normalizer, source_text=None):
    steps=[]
    text=unicodedata.normalize('NFKC',text).replace('’',"'").replace('−','-')
    def signed(m):
        steps.append('explicit-numeric-sign:'+m[1])
        return ({'+':'plus ','-':'minus '} if language=='en' else {'+':'プラス','-':'マイナス'})[m[1]]+m[2]
    text=re.sub(r'(?<![A-Za-z0-9_.])([+-])(\d)',signed,text)
    if source_text and re.search(r'(?<![A-Za-z0-9_.])[+−-]\s*(?:[$¥£€]\s*)?\d',source_text):
        # The author normalizer can leave English -five / +five after turning
        # digits into words; recover the sign only with an explicit source sign.
        if language=='en':
            text=re.sub(r'(?<![A-Za-z0-9_.])([+-])(?=[A-Za-z$])',lambda m:'minus ' if m[1]=='-' else 'plus ',text)
    if language=='en':
        if source_text:
            for label in re.finditer(r'\b((?i:'+LABEL_CONTEXT+r'))\s+([A-Z])\b',source_text):
                pattern=r'\b('+re.escape(label[1])+r')\s+'+label[2]+r'\b(?!\.)'
                text,n=re.subn(pattern,lambda m:m[1]+' '+label[2]+'.',text,flags=re.I)
                if n:steps.append('source-anchored-contextual-letter:'+label[2])
            letter=re.fullmatch(r'([A-Z])\.?',source_text.strip())
            if letter and re.fullmatch(re.escape(letter[1])+r'\.?',text.strip(),flags=re.I):
                text=letter[1]+'.';steps.append('source-anchored-letter:'+letter[1])
            clocks={m.group():f'{int(m[1])}:{m[2]}' for m in re.finditer(r'(?<!\d)([0-2]?\d):([0-5]\d)(?!\d)',source_text) if int(m[1])<24}
            for original,clock in clocks.items():
                h,minute=clock.split(':')
                forms={h+minute,original.replace(':',''),h+'.'+minute,original.replace(':','.')}
                for form in sorted(forms,key=len,reverse=True):
                    pattern=r'(?<![\w.$])'+re.escape(form)+r'(?!\w|\.\d)'
                    text,n=re.subn(pattern,clock,text)
                    if n:steps.append('source-anchored-clock:'+form+'→'+clock)
        text=re.sub(r'\b([ap])\s+m\b',lambda m:'meridiem'+m[1]+'m',text,flags=re.I)
        text=re.sub(r'\b([ap])\.m\.?',lambda m:'meridiem'+m[1].lower()+'m',text,flags=re.I)
        text=re.sub(r'(?<=\d)\s*([ap])m\b',lambda m:' meridiem'+m[1].lower()+'m',text,flags=re.I)
        text=re.sub(r'\b(AM|PM)\b',lambda m:'meridiem'+m[1].lower(),text)
        text=re.sub(r"o['’]clock",'o clock',text,flags=re.I)
    if normalizer:
        before=text;text=normalizer(text,language)
        if text!=before:steps.append('author-number-and-input-normalization')
    else:
        from num2words import num2words
        if language=='en':
            def money(m):
                n=m[1].replace(',','');whole,_,frac=n.partition('.')
                value=num2words(int(whole))+' '+('dollar' if int(whole)==1 else 'dollars')
                if frac:value+=' '+num2words(int(frac.ljust(2,'0')))+' cents'
                return value
            text=re.sub(r'\$(\d[\d,]*(?:\.\d{1,2})?)',money,text)
            text=re.sub(r'(?<!\w)\d[\d,]*(?:\.\d+)?',lambda m:num2words(m[0].replace(',','')),text)
        # Japanese numerals/counters require the contextual author normalizer.
    return text,steps


def _english_tokens(text):
    # A. in model/letter labels is not the removable article 'a'.
    text=re.sub(r'\b([A-Z])\.(?=\s|$)',lambda m:'letter'+m[1].lower(),text)
    return re.findall(r"[^\W\d_]+(?:'[^\W\d_]+)?|[0-9]+(?:[.:][0-9]+)?",text.casefold())


def _expanded(tokens):
    result=[];rules=[]
    for token in tokens:
        diacritics = {'café': 'cafe', 'cafés': 'cafes', "café's": "cafe's"}
        value=diacritics.get(token,SPELLINGS.get(token,token))
        if value!=token:rules.append(('reviewed-diacritic:' if token in diacritics else 'us-uk-spelling:')+token+'→'+value)
        if value in CONTRACTIONS:
            rules.append('contraction:'+value);result.extend(CONTRACTIONS[value].split());continue
        m=re.fullmatch(r"(.+)'(ll|ve|re)",value)
        if m:
            result.extend([m[1],{'ll':'will','ve':'have','re':'are'}[m[2]]]);rules.append('contraction:'+value);continue
        if value in COMPOUNDS:
            result.extend(COMPOUNDS[value].split());rules.append('reviewed-compound-boundary:'+value);continue
        result.append(value)
    return result,rules


def _en_align(a,b,allow_articles=True):
    """Exact token DP; transitions are explicit equivalences, never edit costs."""
    @functools.lru_cache(None)
    def walk(i,j):
        if i==len(a) and j==len(b):return ((),())
        transitions=[]
        if i<len(a) and j<len(b):
            x,y=a[i],b[j]
            if x==y:transitions.append((i+1,j+1,None,'t:'+x))
            else:
                px,py=_phones(x),_phones(y)
                if px and px==py:transitions.append((i+1,j+1,'cmu-identical-pronunciation-set:'+x+'='+y,'p:'+'/'.join(' '.join(p) for p in sorted(px))))
            # 's may be the audible contraction of is. Never rewrite a plain
            # has to is, nor accept absence of possessive/plural /s/.
            if x.endswith("'s") and j+1<len(b) and b[j:j+2]==[x[:-2],'is']:
                transitions.append((i+1,j+2,'contracted-s-is:'+x,'t:'+x[:-2]+' is'))
            if y.endswith("'s") and i+1<len(a) and a[i:i+2]==[y[:-2],'is']:
                transitions.append((i+2,j+1,'contracted-s-is:'+y,'t:'+y[:-2]+' is'))
        # Explicit user policy, not a claim that articles sound identical.
        if allow_articles and i<len(a) and a[i] in ARTICLES:transitions.append((i+1,j,'user-allowed-article:expected-'+a[i],None))
        if allow_articles and j<len(b) and b[j] in ARTICLES:transitions.append((i,j+1,'user-allowed-article:recognized-'+b[j],None))
        for ni,nj,reason,canonical in transitions:
            rest=walk(ni,nj)
            if rest is not None:
                return (((reason,) if reason else ())+rest[0],((canonical,) if canonical else ())+rest[1])
        return None
    # Removing all content must never make empty/noise transcriptions pass.
    if not a or not b:return None
    if not any(t not in ARTICLES for t in a) or not any(t not in ARTICLES for t in b):
        return ((),tuple('t:'+t for t in a)) if a==b else None
    return walk(0,0)


@functools.lru_cache(maxsize=1)
def _tagger():
    import fugashi
    return fugashi.Tagger()


@functools.lru_cache(maxsize=1)
def _kakasi():
    import pykakasi
    return pykakasi.kakasi()


def _katakana(text):
    return ''.join(chr(ord(c)+0x60) if '\u3041'<=c<='\u3096' else c for c in unicodedata.normalize('NFKC',text))


VOWELS={}
for vowel,letters in [('ア','アカガサザタダナハバパマヤラワァャヮ'),('イ','イキギシジチヂニヒビピミリヰィ'),('ウ','ウクグスズツヅヌフブプムユルヴゥュ'),('エ','エケゲセゼテデネヘベペメレヱェ'),('オ','オコゴソゾトドノホボポモヨロヲォョ')]:
    for letter in letters:VOWELS[letter]=vowel


def _morae(reading):
    result=[]
    for c in _katakana(reading):
        if c=='ー' and result and result[-1] in VOWELS:result.append(VOWELS[result[-1]])
        else:result.append(c)
    return ''.join(result)


@functools.lru_cache(maxsize=5000)
def _japanese_reading(text):
    out=[];trace=[];fallback=False
    for node in _tagger()(text):
        surface=node.surface
        if all(unicodedata.category(c)[0] in 'PZS' for c in surface):continue
        feat=node.feature;pron=getattr(feat,'pron',None)
        if re.search(r'[A-Za-z]',surface):
            reading='<'+surface.casefold()+'>';method='literal-english-source'
        elif pron and pron!='*':reading=pron;method='unidic-pron'
        elif re.fullmatch(r'[\u3040-\u30ff]+',surface):reading=surface;method='literal-kana'
        elif re.search(r'[\u3400-\u9fff]',surface):
            reading=''.join(row['kana'] for row in _kakasi().convert(surface));method='pykakasi-unknown';fallback=True
        else:
            # Latin names/acronyms and unconverted digits are exact literals;
            # do not invent a Japanese English-word pronunciation.
            reading='<'+surface.casefold()+'>';method='literal'
        value=_morae(reading);out.append(value)
        trace.append({'surface':surface,'reading':reading,'normalized':value,'method':method})
    return ''.join(out),trace,fallback


def compare(expected_spoken,recognized,language,*,normalizer=None,source_text=None,phoneme_override=False,allow_articles=True):
    """Return auditable strict equivalence of one current actual ASR transcript.

    source_text anchors ASR's compact clock spelling (815 vs explicit 8:15).
    No historical transcript selection or inference is performed here.
    """
    result={'equivalent':False,'ruleVersion':RULE_VERSION,'language':language,
        'expectedSpoken':expected_spoken,'recognized':recognized,'reasons':[],
        'normalizedExpected':None,'normalizedRecognized':None,
        'proofExpected':None,'proofRecognized':None,
        'provenance':{'comparison':'exact transforms only; no edit-distance acceptance',
            'cmudict':_version('cmudict'),'fugashi':_version('fugashi'),
            'unidic':_version('unidic'),'pykakasi':_version('pykakasi'),
            'normalizer':getattr(normalizer,'__name__',None),'phonemeOverride':bool(phoneme_override),'articlePolicyEnabled':bool(allow_articles),
            'ruleFileSha256':_code_sha(),'normalizerFileSha256':_code_sha(normalizer) if normalizer else None,
            'sourceTextSha256':hashlib.sha256(source_text.encode()).hexdigest() if source_text else None}}
    if language not in ['en','ja']:raise ValueError('language must be en or ja')
    if not isinstance(expected_spoken,str) or not isinstance(recognized,str) or not expected_spoken.strip() or not recognized.strip():
        result['reasons']=['empty-input-is-not-evidence'];return result
    formatted, formatting_rules = (_source_formatted_english(expected_spoken, recognized, source_text, normalizer)
                                  if language == 'en' else (recognized, []))
    expected,erules=_numeric(expected_spoken,language,normalizer,source_text)
    actual,arules=_numeric(formatted,language,normalizer,source_text)
    arules = formatting_rules + arules
    if source_text:
        signs=re.findall(r'(?<![A-Za-z0-9_.])([+−-])\s*(?:[$¥£€]\s*)?\d',source_text)
        for sign in signs:
            marker=({'-':'minus','+':'plus','−':'minus'} if language=='en' else {'-':'マイナス','+':'プラス','−':'マイナス'})[sign]
            if marker not in expected.casefold():
                result.update(normalizedExpected=expected,normalizedRecognized=actual,reasons=['source-numeric-sign-missing-from-spoken'])
                return result
    if language=='en':
        raw_a=_english_tokens(expected);raw_b=_english_tokens(actual)
        proof=_en_align(raw_a,raw_b,allow_articles)
        if proof is not None:a,b,ea,eb=raw_a,raw_b,[],[]
        else:
            a,ea=_expanded(raw_a);b,eb=_expanded(raw_b);proof=_en_align(a,b,allow_articles)
        result.update(normalizedExpected=a,normalizedRecognized=b)
        result['equivalent']=proof is not None
        if proof is not None:
            result['proofExpected']=result['proofRecognized']=' | '.join(proof[1])
        result['reasons']=list(dict.fromkeys(erules+arules+ea+eb+list(proof[0] if proof is not None else [])))
        if result['equivalent'] and not result['reasons']:result['reasons']=['exact-normalized-text']
        if not result['equivalent']:result['reasons'].append('non-equivalent-segments-remain')
    else:
        a,at,af=_japanese_reading(expected);b,bt,bf=_japanese_reading(actual)
        result.update(normalizedExpected=a,normalizedRecognized=b,readingTrace={'expected':at,'recognized':bt})
        ambiguous=[t['surface'] for t in at if t['surface'] in AMBIGUOUS_JA and sum(x['surface']==t['surface'] for x in at)!=sum(x['surface']==t['surface'] for x in bt)]
        written_a=''.join(t['surface'] for t in at);written_b=''.join(t['surface'] for t in bt)
        written_equal=bool(written_a and written_a==written_b)
        override_unproved=bool(phoneme_override and not written_equal)
        result['equivalent']=written_equal or bool(a and b and a==b and not ambiguous and not override_unproved)
        if written_equal:result['proofExpected']=result['proofRecognized']='written:'+written_a
        elif result['equivalent']:result['proofExpected']=a;result['proofRecognized']=b
        result['reasons']=list(dict.fromkeys(erules+arules))
        result['reasons'].append('exact-normalized-japanese-text' if written_equal else ('exact-japanese-reading' if result['equivalent'] else 'non-equivalent-morae-remain'))
        if af or bf:result['reasons'].append('unknown-kanji-reading-via-pykakasi')
        if ambiguous and not written_equal:result['reasons'].append('ambiguous-contextual-kanji:'+','.join(dict.fromkeys(ambiguous)))
        if override_unproved:result['reasons'].append('phoneme-override-not-proven-by-dictionary-reading')
    return result
