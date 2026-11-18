import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from japanese_repair_readings import japanese_reading_override

def apply(text,base=None,lang='ja'):
    value=japanese_reading_override({'language':lang},{'spoken':text},base)
    return value['spoken'] if value else text

class Readings(unittest.TestCase):
    def test_names_and_terms(self):
        self.assertEqual(apply('Nell: Elm の保温庫は？'),'ネル: エルム のほおんこは？')
        self.assertEqual(apply('風袋を量り、船荷証券を発行。'),'ふうたいを量り、ふなにしょうけんを発行。')
    def test_scope(self):
        self.assertEqual(apply('Elmwood ALee Lee2 Bostonian'),'Elmwood ALee Lee2 Bostonian')
        self.assertEqual(apply('Leeさん',{'phonemes':'preserved'}),'Leeさん')
        self.assertEqual(apply('East',lang='en'),'East')

if __name__=='__main__':unittest.main()
