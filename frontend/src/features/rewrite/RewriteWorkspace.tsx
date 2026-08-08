import { useEffect, useMemo, useState } from "react";
import type {
  ExtractionResponse,
  ManualRewriteSettings,
  RewriteEngine,
  RewriteProfile,
  RewriteResponse,
  ValidationResponse,
  WritingStyle,
} from "@airem/contracts";
import { Check, Copy, Download, FileCheck2, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";

const PROFILE_OPTIONS: Array<{ value: RewriteProfile; label: string }> = [
  { value: "light", label: "Light rewrite" },
  { value: "natural", label: "Natural rewrite" },
  { value: "rewrite_compress", label: "Rewrite + compress" },
  { value: "compress", label: "Compress only" },
  { value: "plain", label: "Simple student" },
  { value: "expanded", label: "Expanded / compatibility" },
  { value: "conservative", label: "Conservative / compatibility" },
  { value: "balanced", label: "Balanced / compatibility" },
  { value: "manual", label: "Manual controls" },
];

const STYLE_OPTIONS: Array<{ value: WritingStyle; label: string }> = [
  { value: "natural_student", label: "Natural student" },
  { value: "simple_student", label: "Simple student" },
  { value: "natural_academic", label: "Natural academic" },
  { value: "plain_professional", label: "Plain professional" },
];

export const DEFAULT_MANUAL_SETTINGS: ManualRewriteSettings = {
  target_change_percent: -2,
  length_tolerance: 7,
  table_intensity: 30,
  lexical_intensity: 78,
  connector_intensity: 70,
  contraction_intensity: 0,
  compression_intensity: 70,
  candidate_count: 12,
  max_sentence_words: 28,
  content_preservation: 70,
  table_preservation: 90,
  max_cumulative_increase: 5,
  split_long_sentences: true,
  preserve_sentence_count: false,
  sentence_count_tolerance: 1,
};

const MANUAL_PRESETS: Record<"natural" | "compact" | "light", ManualRewriteSettings> = {
  natural: { ...DEFAULT_MANUAL_SETTINGS },
  compact: {
    ...DEFAULT_MANUAL_SETTINGS,
    target_change_percent: -10,
    compression_intensity: 100,
    lexical_intensity: 88,
    content_preservation: 68,
    table_preservation: 90,
    max_sentence_words: 24,
  },
  light: {
    ...DEFAULT_MANUAL_SETTINGS,
    target_change_percent: 0,
    compression_intensity: 35,
    lexical_intensity: 45,
    content_preservation: 82,
    table_preservation: 94,
    max_sentence_words: 34,
  },
};

type RecordValue = Record<string, unknown>;
const asRecord = (value: unknown): RecordValue | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
const asNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const asString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const words = (value: string) => (value.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length;

function sourceMap(extraction: ExtractionResponse): Record<string, string> {
  return Object.fromEntries(extraction.chunks.map(chunk => [String(chunk.chunk_number), chunk.text]));
}

function protectedTerms(raw: string): string[] {
  return raw.split(/[;,\n]+/).map(value => value.trim()).filter(Boolean);
}

function Diagnostics({ rewrite, validation }: { rewrite?: RewriteResponse; validation?: ValidationResponse }) {
  const scores = asRecord(rewrite?.style_scores);
  const initial = asRecord(scores?.initial);
  const current = asRecord(scores?.current);
  const history = Array.isArray(scores?.history) ? scores.history.map(asRecord).filter(Boolean) as RecordValue[] : [];
  const budget = asRecord(rewrite?.word_budget);
  const initialScore = asNumber(initial?.ai_style_score);
  const currentScore = asNumber(current?.ai_style_score);
  const delta = asNumber(scores?.delta_from_initial);
  const originalWords = asNumber(budget?.original_words);
  const outputWords = asNumber(budget?.output_words);
  const outputChange = asNumber(budget?.output_change_percent);
  const issues = validation?.validation.issues ?? rewrite?.validation.issues ?? [];

  return <section className="rewrite-diagnostics" aria-label="Rewrite diagnostics">
    <div className="workspace-section-head"><div><p className="eyebrow">Diagnostics</p><h4>Structural and writing-pattern checks</h4></div>{rewrite && <span className={rewrite.pass_accepted ? "diagnostic-status pass" : "diagnostic-status warn"}>{rewrite.pass_accepted ? "Pass accepted" : "Safety fallback"}</span>}</div>
    <div className="diagnostic-grid">
      <article><span>Initial style diagnostic</span><strong>{initialScore === undefined ? "—" : `${initialScore.toFixed(1)}%`}</strong><small>Diagnostic only; not an authorship probability.</small></article>
      <article><span>Current style diagnostic</span><strong>{currentScore === undefined ? "—" : `${currentScore.toFixed(1)}%`}</strong><small>{delta === undefined ? "Run a rewrite to compare." : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} points from initial.`}</small></article>
      <article><span>Word-count control</span><strong>{outputWords === undefined ? "—" : outputWords.toLocaleString()}</strong><small>{originalWords === undefined ? "No rewrite yet." : `${originalWords.toLocaleString()} original · ${outputChange === undefined ? "—" : `${outputChange > 0 ? "+" : ""}${outputChange.toFixed(2)}%`}`}</small></article>
      <article><span>Structural validation</span><strong>{validation ? (validation.validation.valid ? "Valid" : "Issues") : rewrite ? (rewrite.validation.valid ? "Valid" : "Issues") : "—"}</strong><small>{validation ? `${validation.validation.issue_count} issue(s)` : rewrite ? `${rewrite.validation.issue_count} issue(s)` : "Validate after reviewing edits."}</small></article>
    </div>
    {history.length > 0 && <div className="diagnostic-history" aria-label="Rewrite history">{history.map((item, index) => <span key={`${asString(item.label) ?? "Pass"}-${index}`}><strong>{asString(item.label) ?? `Pass ${index}`}</strong> {asNumber(item.score)?.toFixed(1) ?? "—"}%</span>)}</div>}
    {rewrite?.chunk_logs?.length ? <div className="chunk-diagnostic-list">{rewrite.chunk_logs.map((raw, index) => {
      const log = asRecord(raw); const summary = asRecord(log?.summary); const chunk = asNumber(log?.chunk_number) ?? index + 1;
      return <div key={`chunk-diagnostic-${chunk}`}><strong>Part {String(chunk).padStart(2, "0")}</strong><span>{asNumber(summary?.changed_count) ?? 0} changed · {asNumber(summary?.rejected_count) ?? 0} safety fallbacks · {asNumber(summary?.output_word_count) ?? 0} words</span></div>;
    })}</div> : null}
    {issues.length > 0 && <div className="validation-issues"><strong>Validation issues</strong><ul>{issues.map((raw, index) => { const issue = asRecord(raw); return <li key={`issue-${index}`}>{asString(issue?.message) ?? "The edited extraction no longer matches the fixed reinsertion structure."}</li>; })}</ul></div>}
    {rewrite && <div className="audit-links"><a href={rewrite.rewrite_log_url}>Rewrite audit log</a>{rewrite.cycle_log_url && <a href={rewrite.cycle_log_url}>Cycle {rewrite.cycle_number} audit log</a>}</div>}
  </section>;
}

function ManualNumber({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="manual-control"><span>{label}</span><div><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/><output>{value}</output></div></label>;
}

export function RewriteWorkspace({ jobId, extraction }: { jobId: string; extraction: ExtractionResponse }) {
  const sourceTexts = useMemo(() => sourceMap(extraction), [extraction]);
  const chunkKeys = useMemo(() => extraction.chunks.map(chunk => String(chunk.chunk_number)), [extraction]);
  const [currentTexts, setCurrentTexts] = useState<Record<string, string>>(sourceTexts);
  const [activeChunk, setActiveChunk] = useState(chunkKeys[0] ?? "1");
  const [profile, setProfile] = useState<RewriteProfile>("natural");
  const [engine, setEngine] = useState<RewriteEngine>("linguistic");
  const [style, setStyle] = useState<WritingStyle>("natural_student");
  const [terms, setTerms] = useState("");
  const [manual, setManual] = useState<ManualRewriteSettings>(DEFAULT_MANUAL_SETTINGS);
  const [lastRewrite, setLastRewrite] = useState<RewriteResponse>();
  const [validation, setValidation] = useState<ValidationResponse>();
  const [downloadUrl, setDownloadUrl] = useState("");
  const [replacementLogUrl, setReplacementLogUrl] = useState("");
  const [hasInitialRewrite, setHasInitialRewrite] = useState(false);
  const [dirtySinceValidation, setDirtySinceValidation] = useState(true);
  const [busy, setBusy] = useState<"rewrite" | "cycle" | "validate" | "reinsert" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setCurrentTexts(sourceTexts); setActiveChunk(chunkKeys[0] ?? "1"); setLastRewrite(undefined); setValidation(undefined);
    setDownloadUrl(""); setReplacementLogUrl(""); setHasInitialRewrite(false); setDirtySinceValidation(true); setError("");
  }, [jobId, sourceTexts, chunkKeys]);

  const updateManual = <K extends keyof ManualRewriteSettings>(key: K, value: ManualRewriteSettings[K]) => setManual(current => ({ ...current, [key]: value }));
  const controls = () => ({
    profile,
    engine,
    style_profile: style,
    protected_terms: protectedTerms(terms),
    manual_settings: profile === "manual" ? manual : undefined,
  });
  const complete = chunkKeys.every(key => Boolean(currentTexts[key]?.trim()));
  const activeMeta = extraction.chunks.find(chunk => String(chunk.chunk_number) === activeChunk) ?? extraction.chunks[0];
  const activeSource = sourceTexts[activeChunk] ?? "";
  const activeCurrent = currentTexts[activeChunk] ?? "";

  const handleError = (value: unknown) => setError(value instanceof Error ? value.message : "The operation failed.");
  const markNewText = (texts: Record<string, string>) => {
    setCurrentTexts(texts); setValidation(undefined); setDirtySinceValidation(true); setDownloadUrl(""); setReplacementLogUrl("");
  };

  const initialRewrite = async () => {
    setBusy("rewrite"); setError("");
    try {
      const response = await api.rewriteDocument(jobId, controls());
      markNewText(response.edited_texts); setLastRewrite(response); setHasInitialRewrite(true);
    } catch (value) { handleError(value); } finally { setBusy(null); }
  };

  const cycleRewrite = async () => {
    if (!complete || !hasInitialRewrite) return;
    setBusy("cycle"); setError("");
    try {
      const response = await api.rewriteDocumentCycle(jobId, { ...controls(), edited_texts: currentTexts });
      markNewText(response.edited_texts); setLastRewrite(response);
    } catch (value) { handleError(value); } finally { setBusy(null); }
  };

  const validate = async () => {
    if (!complete) return;
    setBusy("validate"); setError("");
    try {
      const response = await api.validateDocument(jobId, { edited_texts: currentTexts });
      setValidation(response); setDirtySinceValidation(!response.validation.valid); setDownloadUrl(""); setReplacementLogUrl("");
    } catch (value) { handleError(value); } finally { setBusy(null); }
  };

  const reinsert = async () => {
    if (!validation?.validation.valid || dirtySinceValidation) return;
    setBusy("reinsert"); setError("");
    try {
      const response = await api.reinsertDocument(jobId, { edited_texts: currentTexts });
      setDownloadUrl(response.download_url); setReplacementLogUrl(response.replacement_log_url);
    } catch (value) { handleError(value); } finally { setBusy(null); }
  };

  const editChunk = (value: string) => {
    setCurrentTexts(current => ({ ...current, [activeChunk]: value }));
    setValidation(undefined); setDirtySinceValidation(true); setDownloadUrl(""); setReplacementLogUrl("");
  };

  return <div className="rewrite-workspace" data-testid="rewrite-workspace">
    <section className="rewrite-workspace-summary">
      <div><p className="eyebrow">Immutable extraction</p><h3>Rewrite workspace</h3><p>{extraction.chunks.length} chunk(s) remain keyed to the extraction map created from the uploaded DOCX.</p></div>
      <div className="workspace-pills"><span>{extraction.chunks.length} chunks</span><span>{extraction.chunks.reduce((sum, chunk) => sum + chunk.word_count, 0).toLocaleString()} source words</span><span>{hasInitialRewrite ? `${lastRewrite?.cycle_number ?? 0} completed cycles` : "Not rewritten yet"}</span></div>
    </section>

    <section className="rewrite-controls-panel">
      <div className="workspace-section-head"><div><p className="eyebrow">Rewrite controls</p><h4>v21 linguistic settings</h4></div><span className="unlimited-badge">Unlimited explicit cycles</span></div>
      <div className="rewrite-control-grid">
        <label><span>Rewrite profile</span><select aria-label="Rewrite profile" value={profile} onChange={event => setProfile(event.target.value as RewriteProfile)}>{PROFILE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Writing style</span><select aria-label="Writing style" value={style} onChange={event => setStyle(event.target.value as WritingStyle)}>{STYLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Rewrite engine</span><select aria-label="Rewrite engine" value={engine} onChange={event => setEngine(event.target.value as RewriteEngine)}><option value="linguistic">Linguistic v21</option><option value="legacy">Legacy deterministic</option></select></label>
      </div>
      <label className="protected-terms-field"><span>Additional protected terms</span><textarea aria-label="Additional protected terms" value={terms} onChange={event => setTerms(event.target.value)} placeholder="One per line, comma or semicolon — e.g. Retrieval-Augmented Generation"/><small>Numbers, dates, currencies, citations, quotations, URLs, identifiers, units, acronyms, likely names and detected technical terms remain protected independently of this field.</small></label>

      {profile === "manual" && <div className="manual-settings" data-testid="manual-settings">
        <div className="manual-settings-head"><div><strong>Manual linguistic and compression controls</strong><span>Every value below maps to `build_manual_profile`; none is a cosmetic UI-only control.</span></div><div><button type="button" onClick={() => setManual(MANUAL_PRESETS.natural)}>Natural</button><button type="button" onClick={() => setManual(MANUAL_PRESETS.compact)}>Compact</button><button type="button" onClick={() => setManual(MANUAL_PRESETS.light)}>Light</button><button type="button" onClick={() => setManual(DEFAULT_MANUAL_SETTINGS)}>Reset</button></div></div>
        <div className="manual-settings-grid">
          <ManualNumber label="Target word-count change (%)" value={manual.target_change_percent ?? -2} min={-35} max={20} onChange={value => updateManual("target_change_percent", value)}/>
          <ManualNumber label="Length tolerance (%)" value={manual.length_tolerance ?? 7} min={2} max={20} onChange={value => updateManual("length_tolerance", value)}/>
          <ManualNumber label="Compression intensity" value={manual.compression_intensity ?? 70} min={0} max={100} onChange={value => updateManual("compression_intensity", value)}/>
          <ManualNumber label="Lexical intensity" value={manual.lexical_intensity ?? 70} min={0} max={100} onChange={value => updateManual("lexical_intensity", value)}/>
          <ManualNumber label="Connector intensity" value={manual.connector_intensity ?? 70} min={0} max={100} onChange={value => updateManual("connector_intensity", value)}/>
          <ManualNumber label="Contraction intensity" value={manual.contraction_intensity ?? 0} min={0} max={100} onChange={value => updateManual("contraction_intensity", value)}/>
          <ManualNumber label="Table intensity" value={manual.table_intensity ?? 30} min={0} max={100} onChange={value => updateManual("table_intensity", value)}/>
          <ManualNumber label="Content preservation (%)" value={manual.content_preservation ?? 72} min={60} max={100} onChange={value => updateManual("content_preservation", value)}/>
          <ManualNumber label="Table preservation (%)" value={manual.table_preservation ?? 86} min={72} max={100} onChange={value => updateManual("table_preservation", value)}/>
          <ManualNumber label="Maximum sentence words" value={manual.max_sentence_words ?? 34} min={20} max={80} onChange={value => updateManual("max_sentence_words", value)}/>
          <ManualNumber label="Candidate count" value={manual.candidate_count ?? 12} min={2} max={32} onChange={value => updateManual("candidate_count", value)}/>
          <ManualNumber label="Maximum cumulative increase (%)" value={manual.max_cumulative_increase ?? 5} min={0} max={25} onChange={value => updateManual("max_cumulative_increase", value)}/>
          <ManualNumber label="Sentence-count tolerance" value={manual.sentence_count_tolerance ?? 1} min={0} max={3} onChange={value => updateManual("sentence_count_tolerance", value)}/>
        </div>
        <div className="manual-checks"><label><input type="checkbox" checked={manual.split_long_sentences ?? true} onChange={event => updateManual("split_long_sentences", event.target.checked)}/> Split long sentences</label><label><input type="checkbox" checked={manual.preserve_sentence_count ?? false} onChange={event => updateManual("preserve_sentence_count", event.target.checked)}/> Preserve sentence count</label></div>
      </div>}

      <div className="rewrite-action-row">
        <button type="button" className="button primary" disabled={busy !== null} onClick={initialRewrite}>{busy === "rewrite" ? <RefreshCw className="spin" size={15}/> : <ShieldCheck size={15}/>}Run initial rewrite</button>
        <button type="button" className="button secondary cycle-action" disabled={busy !== null || !hasInitialRewrite || !complete} onClick={cycleRewrite}>{busy === "cycle" ? <RefreshCw className="spin" size={15}/> : <RefreshCw size={15}/>}Run another cycle</button>
        {lastRewrite && <span className="cycle-readout">Pass {lastRewrite.cycle_number + 1} · cycle {lastRewrite.cycle_number}</span>}
      </div>
    </section>

    <section className="chunk-editor-panel">
      <div className="chunk-tabs" role="tablist" aria-label="Extraction chunks">{extraction.chunks.map(chunk => {
        const key = String(chunk.chunk_number); const changed = currentTexts[key] !== sourceTexts[key];
        return <button type="button" role="tab" aria-selected={activeChunk === key} className={activeChunk === key ? "active" : ""} key={key} onClick={() => setActiveChunk(key)}><span>Part {String(chunk.chunk_number).padStart(2, "0")}</span><small>{chunk.word_count} words{changed ? " · edited" : ""}</small></button>;
      })}</div>
      {activeMeta && <div className="chunk-meta"><span>{activeMeta.section_count} sections</span><span>{activeMeta.word_count} source words</span><span>Chunk #{activeMeta.chunk_number}</span></div>}
      <div className="chunk-editor-grid">
        <label><div className="editor-head"><span>Source text</span><button type="button" onClick={() => navigator.clipboard?.writeText(activeSource)}><Copy size={13}/>Copy</button></div><textarea aria-label={`Source text part ${activeChunk}`} readOnly value={activeSource}/><small>{words(activeSource).toLocaleString()} words · immutable extraction source</small></label>
        <label><div className="editor-head"><span>Current text</span><div><button type="button" onClick={() => navigator.clipboard?.writeText(activeCurrent)}><Copy size={13}/>Copy</button><button type="button" onClick={() => editChunk(activeSource)}><RotateCcw size={13}/>Reset</button></div></div><textarea data-testid={`current-chunk-${activeChunk}`} aria-label={`Current text part ${activeChunk}`} value={activeCurrent} onChange={event => editChunk(event.target.value)}/><small>{words(activeCurrent).toLocaleString()} words · keep every `|sec|` divider and mapped line structure</small></label>
      </div>
    </section>

    <Diagnostics rewrite={lastRewrite} validation={validation}/>

    <section className="validation-actions">
      <div><p className="eyebrow">Validate and export</p><h4>Structural validation → reinsertion</h4><p>The current text for every chunk is validated against the fixed extraction map before DOCX reinsertion.</p></div>
      {!complete && <div className="workspace-message error">Every chunk must contain current text before validation or another cycle can run.</div>}
      {error && <div className="workspace-message error" role="alert">{error}</div>}
      {validation && <div className={`workspace-message ${validation.validation.valid ? "success" : "error"}`} data-testid="validation-result">{validation.validation.valid ? <><Check size={15}/><span><strong>Validation passed.</strong> {validation.validation.section_count_actual} sections are ready for reinsertion.</span></> : <><span><strong>Validation failed.</strong> {validation.validation.issue_count} issue(s) must be corrected.</span></>}</div>}
      <div className="validation-button-row">
        <button type="button" className="button secondary" disabled={busy !== null || !complete} onClick={validate}>{busy === "validate" ? <RefreshCw className="spin" size={15}/> : <FileCheck2 size={15}/>}Validate current text</button>
        <button type="button" className="button primary" disabled={busy !== null || !validation?.validation.valid || dirtySinceValidation} onClick={reinsert}>{busy === "reinsert" ? <RefreshCw className="spin" size={15}/> : <FileCheck2 size={15}/>}Reinsert into DOCX</button>
      </div>
      {validation?.validation.validation_report_url && <a className="workspace-log-link" href={validation.validation.validation_report_url}>Download validation report</a>}
      {downloadUrl && <div className="download-ready" data-testid="download-ready"><Check size={17}/><div><strong>Final DOCX is ready</strong><span>Reinsertion completed using the validated current chunk map.</span></div><a className="button primary" href={downloadUrl}><Download size={15}/>Download final DOCX</a>{replacementLogUrl && <a className="workspace-log-link" href={replacementLogUrl}>Replacement log</a>}</div>}
    </section>
  </div>;
}
