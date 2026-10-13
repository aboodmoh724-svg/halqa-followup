"""Build a pinned, offline Madani 604 map from Quran for Android glyph bounds.

Usage: python scripts/build-madani-map.py path/to/ayahinfo_1280.db
Only the Python standard library is needed. Never downloads a mutable source.
"""
import hashlib
import json
import pathlib
import sqlite3
import sys
from collections import defaultdict
from fractions import Fraction

source = pathlib.Path(sys.argv[1])
digest = hashlib.sha256(source.read_bytes()).hexdigest()
assert digest == "06a9b8dc0a7a07a3e73383156f272d22b6175fe941f6df30fb90bb589e92048b", "Unreviewed source: do not overwrite the published map version"
db = sqlite3.connect(f"file:{source.resolve().as_posix()}?mode=ro", uri=True)
lines = defaultdict(lambda: defaultdict(int))
for page, line, surah, ayah, left, right in db.execute(
    "SELECT page_number,line_number,sura_number,ayah_number,min_x,max_x FROM glyphs ORDER BY glyph_id"
):
    assert 1 <= page <= 604 and 1 <= surah <= 114 and ayah > 0
    # Upstream RTL/mark bounds can have reversed x endpoints; use their extent.
    # Zero-width marks contribute no horizontal extent.
    lines[page, line][surah, ayah] += abs(right - left)
assert {p for p, _ in lines} == set(range(1, 605))
line_counts = defaultdict(int)
for page, _ in lines:
    line_counts[page] += 1
portions = defaultdict(lambda: defaultdict(Fraction))
for (page, _), widths in sorted(lines.items()):
    total = sum(widths.values())
    for verse, width in widths.items():
        portions[verse][page] += Fraction(width, total * line_counts[page])
assert len(portions) == 6236
for page in range(1, 605):
    assert sum((v.get(page, Fraction()) for v in portions.values()), Fraction()) == 1
data = {
    "edition": "madani-604",
    "version": "madani-604-glyph-lines-v1-" + digest[:12],
    "sourceUrl": "https://android.quran.com/data/databases/ayahinfo/ayahinfo_1280.zip",
    "sourceSha256": digest,
    "method": "glyph-width-share-per-text-line/number-of-text-lines-on-page",
    "verses": [
        [s, a, [[p, str(f.numerator), str(f.denominator)] for p, f in sorted(parts.items())]]
        for (s, a), parts in sorted(portions.items())
    ],
}
target = pathlib.Path(__file__).resolve().parents[1] / "src/data/madani-604.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"{len(portions)} verses, 604 normalized pages; source SHA-256 {digest}")
