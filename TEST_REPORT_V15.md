# AIREM v15 Test Report

## Automated tests

- **33 tests passed**
- Python compilation passed for all modules.
- All Jinja templates parsed successfully.
- Rendered inline JavaScript passed Node.js syntax checking.

## Exact uploaded progress-report test

Input: `LLM_Hallucination_Project_Progress_Report(1).docx`

| Check | Result |
|---|---:|
| Detected document blocks | 155 |
| Paragraph blocks | 141 |
| Table blocks | 14 |
| Automatically selected blocks | 91 |
| Selected rewrite words | 4,167 |
| Generated rewrite sections | 151 |
| Extract chunks | 1 |
| Natural rewrite structural validation | Passed |
| Initial internal style-risk score | 10.7 |
| Rewritten internal style-risk score | 9.4 |
| Rewritten word count | 4,167 |
| Word-count increase | 0.00% |
| Strict policy result | Accepted |
| Balanced policy result | Accepted |
| Permissive policy result | Accepted |
| Reinserted text items | 396 |
| Final DOCX reopened | Passed |

## Standalone text test

- Original words: 30
- Rewritten words: 23
- Paragraph and blank-line structure preserved.
- Compression phrases converted without section markers.

## Formatting test

The exact uploaded progress report was audited and formatted with:

- Arial document styles;
- A4 page setup;
- table formatting;
- repeated table headers;
- page-number field;
- Table of Contents field;
- List of Figures field;
- List of Tables field.

The generated DOCX reopened successfully using `python-docx`.

## Environment limitation

The build container did not include Flask and had no package-index access, so the live HTTP server could not be launched in this environment. All Flask route code compiled successfully. The packaged `requirements.txt` installs Flask, Werkzeug, python-dotenv and python-docx on the target machine.
