import { useMemo, useState } from "react";
import type { RewriteEngine, RewriteProfile, WritingStyle } from "@airem/contracts";
import { Copy, RefreshCw, RotateCcw, ScanSearch } from "lucide-react";
import { api } from "../../lib/api";

type RecordValue = Record<string, unknown>;
const asRecord = (value: unknown): RecordValue | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const string = (value: unknown) => typeof value === "string" ? value : undefined;
const wc = (text: string) => (text.match(/\b[\w'’-]+\b/g) ?? []).length;

const profiles: Array<{ value: RewriteProfile; label: string }> = [
  { value: "light", label: "Light rewrite" }, { value: "natural", label: "Natural rewrite" },
  { value: "rewrite_compress", label: "Rewrite + compress" }, { value: "compress", label: "Compress only" },
  { value: "plain", label: "Simple student" }, { value: "expanded", label: "Expanded" },
  { value: "conservative", label: "Conservative" }, { value: "balanced", label: "Balanced" },
];
const styles: Array<{ value: WritingStyle; label: string }> = [
  { value: "natural_student", label: "Natural student" }, { value: "simple_student", label: "Simple student" },
  { value: "natural_academic", label: "Natural academic" }, { value: "plain_professional", label: "Plain professional" },
];

function DetectionPanel({ title, report }: { title: string; report?: RecordValue }) {
  const dimensions = asRecord(report?.dimensions) ?? {};
  const score = number(report?.score);
  return <article className="secondary-detection-card"><div className="secondary-card-head"><strong>{title}</strong><span>{score === undefined ? "—" : score.toFixed(1)}</span></div><p>{string(report?.classification) ?? "No diagnostic yet"}{number(report?.confidence) !== undefined ? ` · confidence ${number(report?.confidence)}%` : ""}</p><div className="secondary-score-track"><span style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }}/></div><div className="secondary-dimension-list">{Object.entries(dimensions).map(([key, value]) => <div key={key}><span>{key.replaceAll("_", " ")}</span><strong>{number(value)?.toFixed(1) ?? "—"}</strong></div>)}</div></article>;
}

export function TextRewriteStudio() {
  const [input, setInput] = useState(""); const [output, setOutput] = useState(""); const [original, setOriginal] = useState("");
  const [profile, setProfile] = useState<RewriteProfile>("natural"); const [engine, setEngine] = useState<RewriteEngine>("linguistic");
  const [style, setStyle] = useState<WritingStyle>("natural_student"); const [preserve, setPreserve] = useState(true); const [terms, setTerms] = useState("");
  const [cycleSeed, setCycleSeed] = useState(0); const [sourceDetection, setSourceDetection] = useState<RecordValue>(); const [outputDetection, setOutputDetection] = useState<RecordValue>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const sourceWords = useMemo(() => wc(input), [input]); const outputWords = useMemo(() => wc(output), [output]);
  const change = sourceWords ? ((outputWords - sourceWords) / sourceWords) * 100 : 0;

  const rewrite = async (useOutput: boolean) => {
    const source = useOutput && output.trim() ? output : input;
    if (!source.trim()) return; setBusy(true); setError(""); setNotice(""); if (!original) setOriginal(input);
    try {
      const result = await api.rewriteText({ text: source, profile, engine, style_profile: style, preserve_line_breaks: preserve, cycle_seed: cycleSeed, protected_terms: terms.split(/[;,\n]+/).map(x => x.trim()).filter(Boolean) });
      setOutput(result.rewritten_text); setSourceDetection(result.detection_before); setOutputDetection(result.detection_after); setCycleSeed(seed => seed + 1);
      setNotice(`Pass ${cycleSeed + 1}: ${result.changed_lines} line(s) changed. Words ${result.original_words} → ${result.rewritten_words}. Diagnostic ${result.score_before} → ${result.score_after}.`);
    } catch (value) { setError(value instanceof Error ? value.message : "Rewrite failed."); } finally { setBusy(false); }
  };
  const detectOnly = async () => {
    if (!input.trim()) return; setBusy(true); setError("");
    try { const source = await api.detectText(input); setSourceDetection(source.report); if (output.trim()) setOutputDetection((await api.detectText(output)).report); }
    catch (value) { setError(value instanceof Error ? value.message : "Detection failed."); } finally { setBusy(false); }
  };
  const restore = () => { setOutput(original || input); setCycleSeed(0); setOutputDetection(undefined); setNotice(""); };

  return <div className="secondary-studio" data-testid="text-rewrite-studio">
    <section className="secondary-intro"><div><p className="eyebrow">Paste Text Rewriter</p><h3>Pure linguistic rewriting and compression</h3><p>Rewrite pasted content without a document upload. Later passes rewrite the current output with a new deterministic cycle seed and no cycle limit.</p></div></section>
    <section className="secondary-panel"><div className="secondary-control-grid three">
      <label><span>Rewrite engine</span><select aria-label="Text rewrite engine" value={engine} onChange={e => setEngine(e.target.value as RewriteEngine)}><option value="linguistic">Linguistic v21</option><option value="legacy">Legacy deterministic</option></select></label>
      <label><span>Writing style</span><select aria-label="Text writing style" value={style} onChange={e => setStyle(e.target.value as WritingStyle)}>{styles.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
      <label><span>Rewrite mode</span><select aria-label="Text rewrite profile" value={profile} onChange={e => setProfile(e.target.value as RewriteProfile)}>{profiles.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
    </div><div className="secondary-inline-controls"><label><input type="checkbox" checked={preserve} onChange={e => setPreserve(e.target.checked)}/> Preserve paragraph and list line breaks</label><label className="grow"><span>Additional protected terms</span><input aria-label="Text protected terms" value={terms} onChange={e => setTerms(e.target.value)} placeholder="FEVER; Task A1; domain phrase"/></label></div>
    <div className="secondary-notice"><strong>Protected before rewriting:</strong> numbers, percentages, money, dates, citations, quotations, URLs/emails, equations, identifiers, file names, units, acronyms, likely names/organisations and repeated technical phrases.</div>
    <div className="secondary-actions"><button className="button primary" disabled={busy || !input.trim()} onClick={() => rewrite(false)}>{busy ? <RefreshCw className="spin" size={15}/> : <RefreshCw size={15}/>}Rewrite input</button><button className="button secondary" disabled={busy || !output.trim()} onClick={() => rewrite(true)}>Rewrite output again</button><button className="button secondary" disabled={busy || !input.trim()} onClick={detectOnly}><ScanSearch size={15}/>Detect only</button><button className="button secondary" disabled={!output} onClick={() => navigator.clipboard?.writeText(output)}><Copy size={15}/>Copy output</button><button className="button secondary" disabled={!output} onClick={restore}><RotateCcw size={15}/>Restore original</button></div>
    {error && <div className="workspace-message error" role="alert">{error}</div>}{notice && <div className="workspace-message success" data-testid="text-rewrite-result">{notice}</div>}</section>
    <section className="secondary-editor-grid"><label><div><strong>Original text</strong><span>{sourceWords} words</span></div><textarea aria-label="Original pasted text" value={input} onChange={e => { setInput(e.target.value); if (!cycleSeed) setOriginal(""); }}/></label><label><div><strong>Rewritten text</strong><span>{outputWords} words · {change > 0 ? "+" : ""}{change.toFixed(1)}%</span></div><textarea aria-label="Rewritten pasted text" value={output} onChange={e => setOutput(e.target.value)}/></label></section>
    <section className="secondary-panel"><div className="workspace-section-head"><div><p className="eyebrow">Detection comparison</p><h4>Source vs current output</h4></div><span className="diagnostic-status warn">Diagnostic only</span></div><div className="secondary-detection-grid"><DetectionPanel title="Source" report={sourceDetection}/><DetectionPanel title="Output" report={outputDetection}/></div></section>
  </div>;
}
