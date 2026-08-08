import { useMemo, useRef } from "react";
import type { DocumentBlock, DocumentInventory, SelectionMode, VisualElement, VisualRange } from "@airem/contracts";
import { Check, Highlighter, RotateCcw, X } from "lucide-react";
import "./selection.css";
import {
  blockIdsForAutomaticPreview,
  blockIdsForOrderedRange,
  browserSelectionToVisualRange,
  dedupeVisualRanges,
  visualRangeKey,
} from "./selection";

type Props = {
  inventory: DocumentInventory;
  mode: SelectionMode;
  onModeChange: (mode: SelectionMode) => void;
  selectedBlocks: Set<string>;
  onSelectedBlocksChange: (blocks: Set<string>) => void;
  startOrder: number;
  endOrder: number;
  onStartOrderChange: (value: number) => void;
  onEndOrderChange: (value: number) => void;
  visualRanges: VisualRange[];
  onVisualRangesChange: (ranges: VisualRange[]) => void;
  includeHeadings: boolean;
  includeCaptions: boolean;
  includeTableHeaders: boolean;
  onIncludeHeadingsChange: (value: boolean) => void;
  onIncludeCaptionsChange: (value: boolean) => void;
  onIncludeTableHeadersChange: (value: boolean) => void;
  locked?: boolean;
};

const runStyle = (run: VisualElement["runs"][number]) => ({
  fontFamily: run.font_name || undefined,
  fontSize: run.font_size_pt ? `${run.font_size_pt}pt` : undefined,
  fontWeight: run.bold ? 700 : undefined,
  fontStyle: run.italic ? "italic" : undefined,
  textDecoration: run.underline ? "underline" : undefined,
  color: run.colour ? `#${run.colour.replace(/^#/, "")}` : undefined,
});

function VisualText({ element }: { element: VisualElement }) {
  return <span
    className="word-selectable-text"
    data-visual-id={element.visual_id}
    data-visual-order={element.order}
  >
    {element.runs.map((run, index) => <span key={`${element.visual_id}-r${index}`} style={runStyle(run)}>{run.text}</span>)}
  </span>;
}

function ParagraphPreview({ element }: { element: VisualElement }) {
  const heading = /^heading\s+[1-9]/i.test(element.style);
  return <p
    className={`word-preview-paragraph${heading ? " heading" : ""}${element.list_item ? " list-item" : ""}`}
    style={{
      textAlign: element.alignment,
      marginLeft: `${element.left_indent_pt}pt`,
      textIndent: `${element.first_line_indent_pt}pt`,
    }}
  >
    {element.list_item && <span className="word-list-prefix">•</span>}
    <VisualText element={element}/>
  </p>;
}

function BlockPreview({ block }: { block: DocumentBlock }) {
  if (block.type === "paragraph") return <ParagraphPreview element={block.visual}/>;
  return <table className="word-preview-table"><tbody>{block.rendered_rows.map(row => <tr key={`${block.block_id}-r${row.row_index}`}>{row.cells.map(cell => <td key={`${block.block_id}-r${row.row_index}-c${cell.column_index}`}>{cell.paragraphs.map(paragraph => <ParagraphPreview key={paragraph.visual_id} element={paragraph}/>)}</td>)}</tr>)}</tbody></table>;
}

export function DocumentSelection(props: Props) {
  const previewRef = useRef<HTMLDivElement>(null);
  const automatic = useMemo(() => blockIdsForAutomaticPreview(props.inventory), [props.inventory]);
  const ranged = useMemo(() => blockIdsForOrderedRange(props.inventory, props.startOrder, props.endOrder), [props.inventory, props.startOrder, props.endOrder]);
  const selectedForDisplay = props.mode === "automatic" ? automatic : props.mode === "range" ? ranged : props.mode === "manual" ? props.selectedBlocks : new Set<string>();

  const toggleBlock = (blockId: string) => {
    if (props.locked) return;
    const next = new Set(props.selectedBlocks);
    if (next.has(blockId)) next.delete(blockId); else next.add(blockId);
    props.onSelectedBlocksChange(next);
  };

  const addBrowserSelection = () => {
    if (props.locked) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const selectedRange = selection.getRangeAt(0);
    if (previewRef.current && !previewRef.current.contains(selectedRange.commonAncestorContainer)) return;
    const range = browserSelectionToVisualRange(selection, props.inventory);
    if (!range) return;
    props.onVisualRangesChange(dedupeVisualRanges([...props.visualRanges, range]));
    props.onModeChange("visual");
    selection.removeAllRanges();
  };

  const page = props.inventory.page;
  const width = Math.min(850, Math.max(580, (page.page_width_pt ?? 612) * 0.95));
  const horizontalPadding = Math.max(34, Math.min(90, (page.margin_left_pt ?? 72) * 0.9));
  const verticalPadding = Math.max(42, Math.min(100, (page.margin_top_pt ?? 72) * 0.9));

  return <div className="selection-workspace">
    <div className="selection-summary">
      <span><strong>{props.inventory.block_count}</strong> blocks</span>
      <span><strong>{props.inventory.paragraph_count}</strong> paragraphs</span>
      <span><strong>{props.inventory.table_count}</strong> tables</span>
      <span><strong>{props.inventory.visual_element_count}</strong> selectable elements</span>
      <span><strong>{props.inventory.word_count.toLocaleString()}</strong> words</span>
    </div>

    <div className="selection-mode-grid">
      {([
        ["automatic", "Automatic main body", "Use the processor's body detection."],
        ["range", "Start / end", "Select every eligible block between two document positions."],
        ["manual", "Whole blocks", "Choose exact paragraphs and tables."],
        ["visual", "Exact visual ranges", "Drag over text in the Word preview and save exact offsets."],
      ] as const).map(([value, title, description]) => <button type="button" key={value} disabled={props.locked} className={props.mode === value ? "selected" : ""} onClick={() => props.onModeChange(value)}><strong>{title}</strong><span>{description}</span></button>)}
    </div>

    {props.mode === "range" && <div className="selection-range-controls">
      <label><span>Start block</span><select disabled={props.locked} value={props.startOrder} onChange={event => props.onStartOrderChange(Number(event.target.value))}>{props.inventory.blocks.map(block => <option value={block.order} key={`start-${block.block_id}`}>{block.order + 1} — {block.type} — {block.preview.slice(0, 72)}</option>)}</select></label>
      <label><span>End block</span><select disabled={props.locked} value={props.endOrder} onChange={event => props.onEndOrderChange(Number(event.target.value))}>{props.inventory.blocks.map(block => <option value={block.order} key={`end-${block.block_id}`}>{block.order + 1} — {block.type} — {block.preview.slice(0, 72)}</option>)}</select></label>
    </div>}

    <div className="selection-options">
      <label><input type="checkbox" disabled={props.locked} checked={props.includeHeadings} onChange={event => props.onIncludeHeadingsChange(event.target.checked)}/> Include selected headings</label>
      <label><input type="checkbox" disabled={props.locked} checked={props.includeCaptions} onChange={event => props.onIncludeCaptionsChange(event.target.checked)}/> Include selected captions</label>
      <label><input type="checkbox" disabled={props.locked} checked={props.includeTableHeaders} onChange={event => props.onIncludeTableHeadersChange(event.target.checked)}/> Include table header rows</label>
    </div>

    <div className="selection-columns">
      <div className="word-preview-shell">
        <div className="word-preview-toolbar">
          <div><strong>Word preview</strong><span>Stable visual IDs and source formatting come from the immutable upload inventory.</span></div>
          <button type="button" className="button secondary" disabled={props.locked} onClick={addBrowserSelection}><Highlighter size={15}/>Add highlighted range</button>
        </div>
        <div ref={previewRef} className="word-preview-scroll">
          <article className="word-preview-page" style={{ width, padding: `${verticalPadding}px ${horizontalPadding}px` }}>
            {props.inventory.blocks.map(block => <div key={block.block_id} className={`word-preview-block${selectedForDisplay.has(block.block_id) ? " block-selected" : ""}`} data-block-id={block.block_id}><BlockPreview block={block}/></div>)}
          </article>
        </div>
      </div>

      <aside className="selection-sidebar">
        {props.mode === "manual" && <section>
          <div className="selection-side-head"><div><strong>Block selection</strong><span>{props.selectedBlocks.size} selected</span></div><button type="button" className="icon-button" disabled={props.locked} title="Clear blocks" onClick={() => props.onSelectedBlocksChange(new Set())}><RotateCcw size={15}/></button></div>
          <div className="block-selection-list">{props.inventory.blocks.map(block => <label key={block.block_id} className={props.selectedBlocks.has(block.block_id) ? "selected" : ""}><input type="checkbox" disabled={props.locked} checked={props.selectedBlocks.has(block.block_id)} onChange={() => toggleBlock(block.block_id)}/><span className="block-index">{block.order + 1}</span><span><strong>{block.block_id} · {block.type}</strong><small>{block.preview}</small></span></label>)}</div>
        </section>}

        {props.mode === "visual" && <section>
          <div className="selection-side-head"><div><strong>Saved exact ranges</strong><span>{props.visualRanges.length} ranges</span></div><button type="button" className="icon-button" disabled={props.locked} title="Clear ranges" onClick={() => props.onVisualRangesChange([])}><RotateCcw size={15}/></button></div>
          <p className="selection-tip">Drag across one or more formatted runs in the preview, then click <strong>Add highlighted range</strong>. The saved range uses the processor's visual ID plus exact character offsets.</p>
          <div className="visual-range-list">{props.visualRanges.length ? props.visualRanges.map((range, index) => <div key={visualRangeKey(range)}><span className="range-number">{index + 1}</span><div><strong>{range.start_id}:{range.start_offset} → {range.end_id}:{range.end_offset}</strong><small>{range.preview || "Selected document text"}</small></div><button type="button" disabled={props.locked} onClick={() => props.onVisualRangesChange(props.visualRanges.filter((_, itemIndex) => itemIndex !== index))}><X size={14}/></button></div>) : <p className="selection-empty">No exact ranges saved yet.</p>}</div>
        </section>}

        {(props.mode === "automatic" || props.mode === "range") && <section>
          <div className="selection-side-head"><div><strong>Selection preview</strong><span>{selectedForDisplay.size} blocks</span></div></div>
          <div className="selection-checklist">{props.inventory.blocks.filter(block => selectedForDisplay.has(block.block_id)).slice(0, 100).map(block => <div key={`selected-${block.block_id}`}><Check size={13}/><span><strong>{block.block_id}</strong><small>{block.preview}</small></span></div>)}</div>
        </section>}
      </aside>
    </div>
  </div>;
}
