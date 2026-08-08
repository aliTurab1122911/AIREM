import { describe, expect, it } from "vitest";
import type { DocumentInventory } from "@airem/contracts";
import { browserSelectionToVisualRange, dedupeVisualRanges } from "./selection";

const inventory = {
  blocks: [],
  visual_elements: [
    { visual_id: "vp_0", order: 0, text: "Alpha beta gamma", word_count: 3, runs: [], style: "Normal", alignment: "left", left_indent_pt: 0, first_line_indent_pt: 0, list_item: false, location: { kind: "paragraph", body_paragraph_index: 0 } },
    { visual_id: "vp_1", order: 1, text: "Delta epsilon", word_count: 2, runs: [], style: "Normal", alignment: "left", left_indent_pt: 0, first_line_indent_pt: 0, list_item: false, location: { kind: "paragraph", body_paragraph_index: 1 } },
  ],
  visual_element_count: 2, block_count: 0, paragraph_count: 0, table_count: 0, default_selected_count: 0, word_count: 5, page: {},
} as DocumentInventory;

describe("Word preview visual selections", () => {
  it("converts a selection across formatted runs into source-character offsets", () => {
    document.body.innerHTML = `<p><span data-visual-id="vp_0"><span>Alpha </span><b>beta</b><span> gamma</span></span></p>`;
    const host = document.querySelector<HTMLElement>("[data-visual-id='vp_0']")!;
    const first = host.children[0].firstChild!;
    const third = host.children[2].firstChild!;
    const range = document.createRange();
    range.setStart(first, 2); // pha beta ga...
    range.setEnd(third, 3);  // ... ga
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(browserSelectionToVisualRange(selection, inventory)).toMatchObject({
      start_id: "vp_0",
      start_offset: 2,
      end_id: "vp_0",
      end_offset: 13,
      source: "manual",
      preview: "pha beta ga",
    });
  });

  it("preserves cross-element visual IDs and offsets", () => {
    document.body.innerHTML = `<div><span data-visual-id="vp_0">Alpha beta gamma</span><span data-visual-id="vp_1">Delta epsilon</span></div>`;
    const first = document.querySelector<HTMLElement>("[data-visual-id='vp_0']")!.firstChild!;
    const second = document.querySelector<HTMLElement>("[data-visual-id='vp_1']")!.firstChild!;
    const range = document.createRange();
    range.setStart(first, 6);
    range.setEnd(second, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(browserSelectionToVisualRange(selection, inventory)).toMatchObject({
      start_id: "vp_0",
      start_offset: 6,
      end_id: "vp_1",
      end_offset: 5,
    });
  });

  it("deduplicates identical saved ranges without changing their offsets", () => {
    const range = { start_id: "vp_0", start_offset: 1, end_id: "vp_0", end_offset: 5, source: "manual" };
    expect(dedupeVisualRanges([range, { ...range }])).toEqual([range]);
  });
});
