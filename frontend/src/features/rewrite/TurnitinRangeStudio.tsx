import { useEffect, useMemo, useState } from "react";
import type {
  RangeEditConfigurationResponse,
  RangeEditContinueResponse,
  RangeEditItem,
  TurnitinUploadResponse,
  VisualRange,
} from "@airem/contracts";
import { Check, Download, FileText, RefreshCw, Sparkles, WandSparkles, X } from "lucide-react";
import { api } from "../../lib/api";
import "./turnitin-range.css";

type Props = {
  jobId: string;
  visualRanges: VisualRange[];
  onVisualRangesChange: (ranges: VisualRange[]) => void;
  onContinue: (response: RangeEditContinueResponse) => void;
  disabled?: boolean;
};

const rangeKey = (range: VisualRange) => [range.start_id, range.start_offset, range.end_id, range.end_offset, range.source ?? "manual"].join("|");
const sourceLabel = (range: VisualRange) => range.source === "turnitin-expanded" ? "Turnitin expanded" : range.source === "turnitin" ? "Turnitin exact" : "Manual";
const isTurnitinRange = (range: VisualRange) => String(range.source ?? "").startsWith("turnitin");
const words = (text: string) => (text.trim().match(/\S+/g) ?? []).length;

function mergeMappedRanges(current: VisualRange[], mapped: VisualRange[]) {
  const manual = current.filter(range => !isTurnitinRange(range));
  const seen = new Set<string>();
  return [...manual, ...mapped].filter(range => {
    const key = rangeKey(range);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function domPointAtOffset(root: Element, target: number) {
  let remaining = Math.max(0, target);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let last: Node = root;
  while (node) {
    last = node;
    const length = node.nodeValue?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode();
  }
  return last.nodeType === Node.TEXT_NODE
    ? { node: last, offset: last.nodeValue?.length ?? 0 }
    : { node: root, offset: root.childNodes.length };
}

function domRangeFor(item: VisualRange) {
  const startEl = document.querySelector(`[data-visual-id="${CSS.escape(item.start_id)}"]`);
  const endEl = document.querySelector(`[data-visual-id="${CSS.escape(item.end_id)}"]`);
  if (!startEl || !endEl) return null;
  const start = domPointAtOffset(startEl, item.start_offset);
  const end = domPointAtOffset(endEl, item.end_offset);
  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch { return null; }
}

function paintVisualRanges(ranges: VisualRange[]) {
  document.querySelectorAll(".word-selectable-text.mapped-fallback").forEach(element => element.classList.remove("mapped-fallback", "turnitin-fallback"));
  const css = CSS as unknown as { highlights?: { set: (name: string, highlight: unknown) => void; delete: (name: string) => void } };
  const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (css.highlights && HighlightCtor) {
    const manual: Range[] = [];
    const mapped: Range[] = [];
    for (const item of ranges) {
      const range = domRangeFor(item);
      if (!range) continue;
      (isTurnitinRange(item) ? mapped : manual).push(range);
    }
    css.highlights.set("manual-selected", new HighlightCtor(...manual));
    css.highlights.set("turnitin-mapped", new HighlightCtor(...mapped));
    return;
  }
  for (const item of ranges) {
    for (const id of new Set([item.start_id, item.end_id])) {
      const element = document.querySelector(`[data-visual-id="${CSS.escape(id)}"]`);
      element?.classList.add("mapped-fallback");
      if (isTurnitinRange(item)) element?.classList.add("turnitin-fallback");
    }
  }
}

export function TurnitinRangeStudio({ jobId, visualRanges, onVisualRangesChange, onContinue, disabled }: Props) {
  const [pdf, setPdf] = useState<File>();
  const [turnitin, setTurnitin] = useState<TurnitinUploadResponse>();
  const [configuration, setConfiguration] = useState<RangeEditConfigurationResponse>();
  const [sessionId, setSessionId] = useState("");
  const [mode, setMode] = useState<"manual" | "openai">("manual");
  const [drafts, setDrafts] = useState<RangeEditItem[]>([]);
  const [prompt, setPrompt] = useState("Improve clarity and flow while preserving meaning and factual details.");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState<"turnitin" | "manual" | "openai" | "export" | "continue" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [logUrl, setLogUrl] = useState("");

  useEffect(() => {
    api.rangeEditConfiguration().then(response => {
      setConfiguration(response);
      setModel(response.configuration.default_model);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    paintVisualRanges(visualRanges);
    return () => {
      const css = CSS as unknown as { highlights?: { delete: (name: string) => void } };
      css.highlights?.delete("manual-selected");
      css.highlights?.delete("turnitin-mapped");
    };
  }, [visualRanges]);

  const mappedCount = useMemo(() => visualRanges.filter(isTurnitinRange).length, [visualRanges]);
  const manualCount = visualRanges.length - mappedCount;
  const reviewed = drafts.map(item => ({ id: item.id, revised_text: item.revised_text }));

  const upload = async () => {
    if (!pdf || disabled) return;
    setBusy("turnitin"); setError(""); setMessage("");
    try {
      const response = await api.uploadTurnitin(jobId, pdf);
      setTurnitin(response);
      setSessionId(""); setDrafts([]); setDownloadUrl(""); setLogUrl("");
      setMessage(response.analysis.verification_message);
    } catch (value) { setError(value instanceof Error ? value.message : "Turnitin report analysis failed."); }
    finally { setBusy(null); }
  };

  const applyMapped = (kind: "exact" | "expanded") => {
    if (!turnitin?.analysis.mapping_enabled || disabled) return;
    const source = kind === "expanded" ? turnitin.analysis.expanded_ranges : turnitin.analysis.exact_ranges;
    onVisualRangesChange(mergeMappedRanges(visualRanges, source));
    setSessionId(""); setDrafts([]); setDownloadUrl("");
    setMessage(kind === "expanded"
      ? "Mapped Turnitin targets expanded to their full containing paragraphs or complete tables."
      : "Turnitin cyan highlights mapped to exact DOCX character ranges.");
  };

  const clearMapped = () => {
    onVisualRangesChange(visualRanges.filter(range => !isTurnitinRange(range)));
    setSessionId(""); setDrafts([]); setDownloadUrl("");
    setMessage("Mapped Turnitin ranges removed; manually saved ranges were retained.");
  };

  const createDrafts = async (manualOnly: boolean) => {
    if (!visualRanges.length || disabled) return;
    setBusy(manualOnly ? "manual" : "openai"); setError(""); setMessage(""); setDownloadUrl(""); setLogUrl("");
    try {
      const response = await api.draftRangeEdits(jobId, {
        visual_ranges: visualRanges,
        manual_only: manualOnly,
        prompt: manualOnly ? undefined : prompt,
        model: manualOnly ? undefined : model || undefined,
      });
      setSessionId(response.session_id); setMode(response.mode); setDrafts(response.edits);
      setMessage(response.mode === "manual"
        ? "Manual review cards are ready. Edit every selected range before export or continuing into AIREM."
        : `${response.edits.length} OpenAI draft(s) are ready for review across ${response.batch_count || 1} batch(es).`);
    } catch (value) { setError(value instanceof Error ? value.message : "Range edit drafts could not be prepared."); }
    finally { setBusy(null); }
  };

  const updateDraft = (id: string, revisedText: string) => {
    setDrafts(current => current.map(item => item.id === id ? { ...item, revised_text: revisedText, revised_word_count: words(revisedText) } : item));
    setDownloadUrl(""); setLogUrl("");
  };

  const exportDirect = async () => {
    if (!sessionId || !drafts.length) return;
    setBusy("export"); setError(""); setMessage("");
    try {
      const response = await api.exportRangeEdits(jobId, { session_id: sessionId, edits: reviewed });
      setDownloadUrl(response.download_url); setLogUrl(response.log_url);
      setMessage(`${response.replacement_count} approved range edit(s) were reinserted into a copy of the original DOCX.`);
    } catch (value) { setError(value instanceof Error ? value.message : "Direct range export failed."); }
    finally { setBusy(null); }
  };

  const continueIntoAirem = async () => {
    if (!sessionId || !drafts.length) return;
    setBusy("continue"); setError(""); setMessage("");
    try {
      const response = await api.continueRangeEdits(jobId, { session_id: sessionId, edits: reviewed });
      onContinue(response);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not continue into AIREM."); }
    finally { setBusy(null); }
  };

  const statusClass = turnitin?.analysis.verification_status === "verified" ? "verified" : turnitin?.analysis.verification_status === "review" ? "review" : "mismatch";

  return <section className="turnitin-range-studio" data-testid="turnitin-range-studio">
    <div className="turnitin-head"><div><p className="eyebrow">Turnitin + selected-range editing</p><h4>Verify a report, map highlights, then review only the ranges you want to change</h4><p>Turnitin mapping and manual ranges share the same stable visual IDs and exact character offsets used by the DOCX selector.</p></div><div className="range-count-pills"><span>{manualCount} manual</span><span>{mappedCount} mapped</span><span>{visualRanges.length} total</span></div></div>

    <div className="turnitin-grid">
      <div className="turnitin-main">
        <section className="turnitin-card">
          <div className="turnitin-card-head"><div><strong>1. Turnitin report mapping</strong><span>Optional — manual ranges continue to work without a report.</span></div>{turnitin && <a href={turnitin.pdf_download_url}>Download report</a>}</div>
          <div className="turnitin-upload-row"><label><span>Turnitin AI-writing report (.pdf)</span><input aria-label="Turnitin AI-writing report" type="file" accept="application/pdf,.pdf" disabled={disabled} onChange={event => setPdf(event.target.files?.[0])}/></label><button type="button" className="button secondary" disabled={!pdf || disabled || busy !== null} onClick={upload}>{busy === "turnitin" ? <RefreshCw className="spin" size={14}/> : <FileText size={14}/>}Upload and verify report</button></div>
          {turnitin && <><div className={`turnitin-status ${statusClass}`} data-testid="turnitin-verification"><strong>{turnitin.analysis.verification_status === "verified" ? "Verified match" : turnitin.analysis.verification_status === "review" ? "Manual review required" : "File mismatch"}</strong><span>{turnitin.analysis.verification_message}</span></div>
            <div className="turnitin-metrics"><article><span>Content match</span><strong>{(turnitin.analysis.content_similarity * 100).toFixed(1)}%</strong></article><article><span>Filename</span><strong>{turnitin.analysis.filename_match ? "Match" : "Different"}</strong></article><article><span>Turnitin AI score</span><strong>{turnitin.analysis.reported_ai_score === null ? "—" : `${turnitin.analysis.reported_ai_score}%`}</strong></article><article><span>Highlight coverage</span><strong>{(turnitin.analysis.highlight_mapping_coverage * 100).toFixed(1)}%</strong></article><article><span>Exact ranges</span><strong>{turnitin.analysis.exact_range_count}</strong></article><article><span>Expanded</span><strong>{turnitin.analysis.expanded_paragraph_count}P / {turnitin.analysis.expanded_table_count}T</strong></article></div>
            <p className="turnitin-meta">Report: <strong>{turnitin.analysis.reported_filename || turnitin.analysis.uploaded_report_filename || "unknown"}</strong> · DOCX: <strong>{turnitin.analysis.original_filename}</strong> · {turnitin.analysis.highlighted_report_token_count} highlighted tokens · {turnitin.analysis.mapped_highlight_token_count} mapped tokens</p>
            <div className="turnitin-map-actions"><button type="button" disabled={!turnitin.analysis.mapping_enabled || disabled} onClick={() => applyMapped("exact")}>Map exact highlights</button><button type="button" disabled={!turnitin.analysis.mapping_enabled || disabled} onClick={() => applyMapped("expanded")}>Expand to paragraphs/tables</button><button type="button" disabled={!mappedCount || disabled} onClick={clearMapped}><X size={13}/>Remove mapped ranges</button></div>
          </>}
        </section>

        <section className="turnitin-card">
          <div className="turnitin-card-head"><div><strong>2. Saved visual ranges</strong><span>Manual and mapped ranges can be combined in one review session.</span></div></div>
          {visualRanges.length ? <div className="turnitin-saved-ranges">{visualRanges.map((range, index) => <article key={`${rangeKey(range)}-${index}`}><div><strong>Range {index + 1}</strong><span className={`range-source ${isTurnitinRange(range) ? "mapped" : "manual"}`}>{sourceLabel(range)}</span></div><code>{range.start_id}:{range.start_offset} → {range.end_id}:{range.end_offset}</code><p>{range.preview || "Selected document text"}</p></article>)}</div> : <p className="selection-empty">No saved visual ranges yet. Drag text in the Word preview above or map a verified Turnitin report.</p>}
        </section>

        <section className="turnitin-card">
          <div className="turnitin-card-head"><div><strong>3. Prepare range edits</strong><span>Manual editing works without an OpenAI key. OpenAI is an optional editorial assistant only.</span></div><span className={`openai-status ${configuration?.configuration.configured ? "ready" : "offline"}`}>{configuration?.configuration.configured ? "OpenAI configured" : "OpenAI optional / offline"}</span></div>
          <div className="range-edit-controls"><label><span>Editorial prompt</span><textarea aria-label="Range editorial prompt" value={prompt} onChange={event => setPrompt(event.target.value)} disabled={disabled}/></label><label><span>Model</span><input aria-label="Range edit model" value={model} onChange={event => setModel(event.target.value)} disabled={disabled || !configuration?.configuration.configured}/></label></div>
          <div className="range-edit-buttons"><button type="button" className="button secondary" disabled={!visualRanges.length || disabled || busy !== null} onClick={() => createDrafts(true)}>{busy === "manual" ? <RefreshCw className="spin" size={14}/> : <WandSparkles size={14}/>}Manual edit only</button><button type="button" className="button primary" disabled={!visualRanges.length || !configuration?.configuration.configured || !prompt.trim() || disabled || busy !== null} onClick={() => createDrafts(false)}>{busy === "openai" ? <RefreshCw className="spin" size={14}/> : <Sparkles size={14}/>}Generate OpenAI drafts</button></div>
          {configuration && <small className="privacy-copy">OpenAI drafts use ordered batches of at most {configuration.batch_item_limit} ranges. The optional editor uses the Responses API with storage disabled; normal AIREM rewriting remains deterministic and separate.</small>}
        </section>

        {drafts.length > 0 && <section className="turnitin-card" data-testid="range-review-cards"><div className="turnitin-card-head"><div><strong>4. Review approved text</strong><span>{mode === "manual" ? "Manual" : "OpenAI"} session · {drafts.length} range(s)</span></div></div><div className="range-review-list">{drafts.map((item, index) => <article key={item.id}><header><strong>Range {index + 1}</strong><span>{item.location_label}</span></header><div className="range-original"><span>Original</span><p>{item.source_text}</p></div><label><span>Approved revision</span><textarea aria-label={`Approved revision ${index + 1}`} value={item.revised_text} onChange={event => updateDraft(item.id, event.target.value)}/></label><footer><span>{item.warning || "Editable approved output"}</span><span>{item.source_word_count} → {words(item.revised_text)} words</span></footer></article>)}</div>
          <div className="range-final-actions"><button type="button" className="button secondary" disabled={busy !== null} onClick={exportDirect}>{busy === "export" ? <RefreshCw className="spin" size={14}/> : <Download size={14}/>}Reinsert and export DOCX</button><button type="button" className="button primary" disabled={busy !== null} onClick={continueIntoAirem}>{busy === "continue" ? <RefreshCw className="spin" size={14}/> : <Check size={14}/>}Continue into AIREM</button></div>
          {downloadUrl && <div className="range-export-ready" data-testid="range-export-ready"><Check size={15}/><strong>Direct range-edit DOCX ready.</strong><a href={downloadUrl}><Download size={14}/>Download DOCX</a>{logUrl && <a href={logUrl}>Reinsertion log</a>}</div>}
        </section>}

        {message && <div className="workspace-message success">{message}</div>}
        {error && <div className="workspace-message error" role="alert">{error}</div>}
      </div>

      {turnitin && <aside className="turnitin-pdf-panel"><div><strong>Turnitin report preview</strong><a href={turnitin.pdf_preview_url} target="_blank" rel="noreferrer">Open separately</a></div><iframe title="Turnitin report preview" src={turnitin.pdf_preview_url}/></aside>}
    </div>
  </section>;
}
