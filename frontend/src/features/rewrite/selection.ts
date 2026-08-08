import type { DocumentInventory, VisualRange } from "@airem/contracts";

const visualHost = (node: Node | null): HTMLElement | null => {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest<HTMLElement>("[data-visual-id]") ?? null;
};

const boundaryOffset = (host: HTMLElement, node: Node, offset: number): number => {
  const range = document.createRange();
  range.selectNodeContents(host);
  range.setEnd(node, offset);
  return range.toString().length;
};

export function browserSelectionToVisualRange(
  selection: Selection | null,
  inventory: DocumentInventory,
): VisualRange | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const startHost = visualHost(range.startContainer);
  const endHost = visualHost(range.endContainer);
  if (!startHost || !endHost) return null;

  const byId = new Map(inventory.visual_elements.map(item => [item.visual_id, item]));
  const startId = startHost.dataset.visualId ?? "";
  const endId = endHost.dataset.visualId ?? "";
  const startElement = byId.get(startId);
  const endElement = byId.get(endId);
  if (!startElement || !endElement) return null;

  let startOffset = boundaryOffset(startHost, range.startContainer, range.startOffset);
  let endOffset = boundaryOffset(endHost, range.endContainer, range.endOffset);
  let first = startElement;
  let last = endElement;

  if (
    first.order > last.order ||
    (first.order === last.order && startOffset > endOffset)
  ) {
    [first, last] = [last, first];
    [startOffset, endOffset] = [endOffset, startOffset];
  }

  startOffset = Math.max(0, Math.min(startOffset, first.text.length));
  endOffset = Math.max(0, Math.min(endOffset, last.text.length));
  if (first.visual_id === last.visual_id && endOffset <= startOffset) return null;

  const preview = range.toString().trim().replace(/\s+/g, " ").slice(0, 180);
  if (!preview) return null;
  return {
    start_id: first.visual_id,
    start_offset: startOffset,
    end_id: last.visual_id,
    end_offset: endOffset,
    source: "manual",
    preview,
  };
}

export function visualRangeKey(range: VisualRange): string {
  return `${range.start_id}:${range.start_offset}-${range.end_id}:${range.end_offset}`;
}

export function dedupeVisualRanges(ranges: VisualRange[]): VisualRange[] {
  const seen = new Set<string>();
  return ranges.filter(range => {
    const key = visualRangeKey(range);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function blockIdsForAutomaticPreview(inventory: DocumentInventory): Set<string> {
  return new Set(inventory.blocks.filter(block => block.default_selected).map(block => block.block_id));
}

export function blockIdsForOrderedRange(inventory: DocumentInventory, start: number, end: number): Set<string> {
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  return new Set(inventory.blocks.filter(block => block.order >= lower && block.order <= upper).map(block => block.block_id));
}
