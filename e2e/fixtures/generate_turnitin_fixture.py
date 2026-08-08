from __future__ import annotations

import sys
from pathlib import Path

import fitz
from docx import Document


CYAN = (0.32, 0.777, 0.855)
PARAGRAPH = "This exact paragraph should be highlighted and mapped into the Word preview."
TABLE_TEXT = "This highlighted table cell should expand to the complete table."


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/turnitin-e2e")
    root.mkdir(parents=True, exist_ok=True)
    source = root / "source.docx"
    report = root / "turnitin.pdf"

    doc = Document()
    doc.add_heading("Introduction", level=1)
    doc.add_paragraph("The first paragraph establishes the purpose of the demonstration.")
    doc.add_paragraph(PARAGRAPH)
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Criterion"
    table.cell(0, 1).text = "Result"
    table.cell(1, 0).text = "Mapping"
    table.cell(1, 1).text = TABLE_TEXT
    doc.add_paragraph("The final paragraph confirms that the source document remains intact.")
    doc.save(source)

    pdf = fitz.open()
    cover = pdf.new_page()
    for y, text in [
        (72, "Document Details"), (94, "Submission ID"), (116, "trn:e2e:123"),
        (138, "File Name"), (160, "source.docx"), (182, "49 Words"),
    ]:
        cover.insert_text((72, y), text)
    overview = pdf.new_page()
    overview.insert_text((72, 72), "88% detected as AI")
    page = pdf.new_page()
    lines = [
        "Introduction",
        "The first paragraph establishes the purpose of the demonstration.",
        PARAGRAPH,
        "Criterion Result",
        f"Mapping {TABLE_TEXT}",
        "The final paragraph confirms that the source document remains intact.",
    ]
    y = 80
    for index, line in enumerate(lines):
        width = fitz.get_text_length(line, fontname="helv", fontsize=11)
        if index in {2, 4}:
            page.draw_rect(fitz.Rect(69, y - 11, 75 + width, y + 3), color=None, fill=CYAN, overlay=False)
        page.insert_text((72, y), line, fontsize=11, fontname="helv", overlay=True)
        y += 30
    pdf.save(report)
    pdf.close()
    print(source)
    print(report)


if __name__ == "__main__":
    main()
