"""Kana readings for local Japanese resynthesis, preserving the displayed source."""
import re

# Whole English words only: keep model numbers, unseen names and embedded
# substrings intact. These are readings of the source, not Japanese translations.
LATIN = {
    'East':'イースト', 'West':'ウェスト', 'North':'ノース', 'Lee':'リー',
    'Elm':'エルム', 'Hall':'ホール', 'Nell':'ネル', 'Harbor':'ハーバー',
    'Lane':'レーン', 'Mina':'ミナ', 'Cedar':'シーダー', 'Ash':'アッシュ',
    'Kai':'カイ', 'Press':'プレス', 'Garden':'ガーデン', 'Walks':'ウォークス',
    'Jules':'ジュールズ', 'Hazel':'ヘイゼル', 'Main':'メイン', 'House':'ハウス',
    'Marta':'マルタ', 'Mei':'メイ', 'Street':'ストリート', 'Kim':'キム',
    'Birch':'バーチ', 'Ben':'ベン', 'Hana':'ハナ', 'Foldline':'フォールドライン',
    'Davis':'デイヴィス', 'Annex':'アネックス', 'Rill':'リル', 'Fern':'ファーン',
    'Hotel':'ホテル', 'Lost':'ロスト', 'Hat':'ハット', 'Nora':'ノラ',
    'Basic':'ベーシック', 'Care':'ケア', 'Hold':'ホールド', 'Plain':'プレイン',
    'Rush':'ラッシュ', 'Amber':'アンバー', 'Blue':'ブルー', 'Gray':'グレイ',
    'Rose':'ローズ', 'Snow':'スノー', 'Sun':'サン', 'Leaf':'リーフ', 'Wave':'ウェーブ',
    'June':'ジューン', 'Oak':'オーク', 'Boston':'ボストン', 'Print':'プリント',
    'Bags':'バッグズ', 'Ahead':'アヘッド', 'Pat':'パット', 'City':'シティ',
    'Trees':'ツリーズ', 'Rook':'ルーク', 'Paper':'ペーパー', 'Pack':'パック',
    'Leeds':'リーズ', 'Jill':'ジル', 'Peru':'ペルー', 'Meadow':'メドウ',
    'Studios':'スタジオズ', 'Plus':'プラス', 'Cutlery':'カトラリー', 'Trace':'トレース',
    'Sign':'サイン', 'Cafe':'カフェ', 'Café':'カフェ', 'Central':'セントラル',
    'Station':'ステーション', 'Osaka':'オオサカ', 'Seoul':'ソウル', 'March':'マーチ',
    'July':'ジュライ', 'Chicago':'シカゴ', 'Lisbon':'リスボン', 'Atlantic':'アトランティック',
    'Pier':'ピア', 'Four':'フォー', 'Road':'ロード', 'Green':'グリーン', 'Guest':'ゲスト',
    'Registration':'レジストレーション', 'Brighton':'ブライトン', 'Duration':'デュレーション',
    'Cycles':'サイクルズ', 'Found':'ファウンド', 'Cart':'カート', 'Books':'ブックス',
    'Mill':'ミル', 'Maple':'メープル', 'Club':'クラブ', 'Pine':'パイン',
}
JAPANESE = {
    '蝶番':'ちょうつがい', '船荷証券':'ふなにしょうけん', '荷受人':'にうけにん',
    '仕入先':'しいれさき', '元帳':'もとちょう', '余剰金':'よじょうきん',
    '保温庫':'ほおんこ', '受託手荷物':'じゅたくてにもつ', '通行料':'つうこうりょう',
    '充填機':'じゅうてんき', '荷積み':'にづみ', '係留':'けいりゅう',
    '売上高':'うりあげだか', '集荷':'しゅうか', '保冷剤':'ほれいざい',
    '風袋':'ふうたい', '返却期限日':'へんきゃくきげんび', '秤で':'はかりで',
}
LATIN_PATTERN = re.compile(r'(?<![A-Za-z0-9])(?:'+'|'.join(map(re.escape, LATIN))+r')(?![A-Za-z0-9])')
JAPANESE_PATTERN = re.compile('|'.join(map(re.escape, sorted(JAPANESE, key=len, reverse=True))))


def japanese_reading_override(unit, clip, base_override):
    if unit['language'] != 'ja' or (base_override or {}).get('phonemes'):
        return None
    spoken = clip['spoken']
    revised = LATIN_PATTERN.sub(lambda m: LATIN[m[0]], spoken)
    revised = JAPANESE_PATTERN.sub(lambda m: JAPANESE[m[0]], revised)
    if revised == spoken:
        return None
    return {'spoken':revised, 'reason':'Use explicit kana readings for documented names or business terms before Japanese synthesis'}
