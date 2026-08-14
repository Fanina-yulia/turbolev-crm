#!/usr/bin/env python3
"""One-shot/resumable recovery for the malformed 2022 MVS export."""
import os
import runpy

IMPORTER_PATH = os.path.join(os.path.dirname(__file__), "import-mvs-open-data.py")
mod = runpy.run_path(IMPORTER_PATH)
SAMPLE_SIZE = mod["SAMPLE_SIZE"]


def schema_aware_encoding(stream):
    pos = stream.tell()
    sample = stream.read(SAMPLE_SIZE)
    stream.seek(pos)

    candidates = ("utf-8-sig", "utf-8", "cp1251", "utf-16-le", "utf-16-be")
    expected = (
        "person", "reg_addr_koatuu", "oper_code", "oper_name", "d_reg",
        "brand", "model", "make_year", "fuel", "capacity", "n_reg_new",
    )
    ranked = []

    for encoding in candidates:
        try:
            text = sample.decode(encoding, errors="strict")
        except UnicodeError:
            continue

        lower = text.lower().replace("\ufeff", "").replace("\ufffe", "")
        lines = lower.splitlines()
        header = lines[0] if lines else lower[:4096]
        known = sum(1 for token in expected if token in header)
        delimiters = max(header.count(";"), header.count(","), header.count("\t"), header.count("|"))
        line_count = len(lines)
        nul_count = lower.count("\x00")
        replacement_count = lower.count("\ufffd")
        asciiish = sum(
            1 for ch in lower[:12000]
            if ch.isascii() and (ch.isprintable() or ch in "\r\n\t")
        )
        ascii_ratio = asciiish / max(1, min(len(lower), 12000))

        score = known * 1000
        score += min(delimiters, 50) * 20
        score += min(line_count, 100) * 10
        score += int(ascii_ratio * 100)
        score -= min(nul_count, 1000) * 20
        score -= min(replacement_count, 1000) * 20

        preview = header[:180].encode("unicode_escape", errors="backslashreplace").decode("ascii", errors="replace")
        print(
            f"2022 encoding candidate {encoding}: score={score}, known={known}, "
            f"lines={line_count}, delimiters={delimiters}, nul={nul_count}, preview={preview}",
            flush=True,
        )
        ranked.append((score, known, line_count, delimiters, encoding))

    if not ranked:
        raise RuntimeError("2022 export cannot be decoded with supported text encodings")

    ranked.sort(reverse=True)
    score, known, lines, delimiters, encoding = ranked[0]
    if known < 4 or lines < 2 or delimiters < 5:
        raise RuntimeError(
            f"2022 export has no trustworthy CSV decoding; best={encoding}, "
            f"known={known}, lines={lines}, delimiters={delimiters}, score={score}"
        )

    print(f"2022 schema-aware encoding selected: {encoding}", flush=True)
    return encoding


# Functions created by runpy keep the original execution globals dict.
# Patch that dict directly so import_text_member() really calls our detector.
importer_globals = mod["import_text_member"].__globals__
importer_globals["detect_encoding"] = schema_aware_encoding

os.environ["MVS_IMPORT_YEARS"] = "2022"
os.environ.pop("MVS_RESUME_RECOVERY", None)
raise SystemExit(mod["main"]())
