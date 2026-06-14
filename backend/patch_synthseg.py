import os, re
from pathlib import Path

replacements = [
    (r'\bnp\.int\b(?!_|8|16|32|64)',    'int'),
    (r'\bnp\.float\b(?!_|8|16|32|64)',  'float'),
    (r'\bnp\.complex\b(?!_|8|16|32|64)','complex'),
    (r'\bnp\.bool\b(?!_|8)',            'bool'),
    (r'\bnp\.object\b',                 'object'),
    (r'\bnp\.str\b',                    'str'),
]

target = Path(__file__).parent / "SynthSeg"
patched = []

for pyfile in target.rglob('*.py'):
    try:
        text = pyfile.read_text(encoding='utf-8', errors='ignore')
        new_text = text
        for pattern, replacement in replacements:
            new_text = re.sub(pattern, replacement, new_text)
        if new_text != text:
            pyfile.write_text(new_text, encoding='utf-8')
            patched.append(str(pyfile))
    except Exception as e:
        print(f"SKIP {pyfile}: {e}")

print(f"\nPatched {len(patched)} files:")
for f in patched:
    print(" ", f)
print("\nDone.")