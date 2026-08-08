import { useState, type ReactNode } from "react";
import type { DocumentInventory, ExtractionResponse, RewriteProfile, SelectionMode, VisualRange, WritingStyle } from "@airem/contracts";
import { api } from "../lib/api";
import { DocumentSelection } from "../features/rewrite/DocumentSelection";
import { RewriteWorkspace } from "../features/rewrite/RewriteWorkspace";
import "../features/rewrite/selection.css";
import "../features/rewrite/workspace.css";
import { AlertCircle, Check, Download, LoaderCircle, RefreshCw, UploadCloud } from "lucide-react";

type Phase = "idle" | "loading" | "success" | "error";
type Result = Record<string, unknown>;
const message = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);

function Operation({ phase, error, onRetry, children }: { phase: Phase; error?: string; onRetry?: () => void; children?: ReactNode }) {
  if (phase === "loading") return <div className="operation-state"><LoaderCircle className="spin"/><strong>Processing…</strong><span>Please keep this page open.</span><progress aria-label="Operation progress" /></div>;
  if (phase === "error") return <div className="operation-state danger"><AlertCircle/><strong>Operation failed</strong><span>{error}</span>{onRetry && <button className="button secondary" onClick={onRetry}><RefreshCw size={14}/>Retry</button>}</div>;
  if (phase === "success") return <div className="operation-state success"><Check/><strong>Complete</strong>{children}</div>;
  return null;
}

const documentSteps = ["Upload", "Select", "Rewrite workspace"];
const profileOptions: RewriteProfile[] = ["light", "natural", "rewrite_compress", "compress", "plain", "expanded", "conservative", "balanced"];
const styleOptions: WritingStyle[] = ["natural_student", "simple_student", "natural_academic", "plain_professional"];

export function RewriteStudio() {
  const [tab, setTab] = useState<"document"|"text"|"detect"|"format">("document");
  const [step, setStep] = useState(0); const [phase,setPhase]=useState<Phase>("idle");
  const [error,setError]=useState(""); const [result,setResult]=useState<Result>({}); const [file,setFile]=useState<File>();
  const [jobId,setJobId]=useState(""); const [text,setText]=useState(""); const [profile,setProfile]=useState<RewriteProfile>("natural");
  const [styleProfile,setStyleProfile]=useState<WritingStyle>("natural_student"); const [formatJob,setFormatJob]=useState(""); const [downloadUrl,setDownloadUrl]=useState("");
  const [inventory,setInventory]=useState<DocumentInventory>(); const [extraction,setExtraction]=useState<ExtractionResponse>();
  const [selectedBlocks,setSelectedBlocks]=useState<Set<string>>(new Set()); const [visualRanges,setVisualRanges]=useState<VisualRange[]>([]);
  const [rangeMode,setRangeMode]=useState<SelectionMode>("automatic"); const [start,setStart]=useState(0); const [end,setEnd]=useState(0);
  const [includeHeadings,setIncludeHeadings]=useState(false); const [includeCaptions,setIncludeCaptions]=useState(false); const [includeTableHeaders,setIncludeTableHeaders]=useState(false);

  const acceptResult = <T extends object>(data: T, next?: number) => { const record = data as Record<string, unknown>; setResult(record); const id = String(record.job_id ?? ""); if (id) setJobId(id); if (next !== undefined) setStep(next); };
  const run = async <T extends object>(task:()=>Promise<T>, next?:number): Promise<T | undefined> => { setPhase("loading"); setError(""); try { const data=await task(); acceptResult(data,next); setPhase("success"); return data; } catch(e){setError(e instanceof Error?e.message:"Unexpected error");setPhase("error"); return undefined;} };
  const requireFile = () => { if(!file){setError("Choose a supported file first.");setPhase("error");return false} return true };

  const upload=async()=>{ if(!requireFile())return; const uploaded=await run(()=>api.uploadDocument(file!),1); if(!uploaded)return; setInventory(uploaded.inventory); setStart(0); setEnd(Math.max(0, uploaded.inventory.block_count - 1)); setSelectedBlocks(new Set(uploaded.inventory.blocks.filter(block=>block.default_selected).map(block=>block.block_id))); setVisualRanges([]); setRangeMode("automatic"); setIncludeHeadings(false); setIncludeCaptions(false); setIncludeTableHeaders(false); setExtraction(undefined); setDownloadUrl(""); };
  const select=async()=>{ if(!inventory || extraction)return; const extracted=await run(()=>api.extractRanges(jobId,{ selection_mode: rangeMode, selected_blocks: rangeMode === "manual" ? [...selectedBlocks] : undefined, start_order: rangeMode === "range" ? start : undefined, end_order: rangeMode === "range" ? end : undefined, visual_ranges: rangeMode === "visual" ? visualRanges : undefined, include_headings: includeHeadings, include_captions: includeCaptions, include_table_headers: includeTableHeaders }),2); if(extracted)setExtraction(extracted); };
  const tabs = [{id:"document",label:"DOCX rewrite"},{id:"text",label:"Paste text"},{id:"detect",label:"AI detection"},{id:"format",label:"Formatting"}] as const;

  return <section className="studio">
    <header className="studio-head"><div><p className="eyebrow">Writing workspace</p><h2>Document studio</h2><p>Upload, select, rewrite, review and reinsert against one immutable DOCX map.</p></div></header>
    <div className="studio-tabs" role="tablist">{tabs.map(t=><button role="tab" aria-selected={tab===t.id} onClick={()=>{setTab(t.id);setPhase("idle")}} key={t.id}>{t.label}</button>)}</div>
    {tab==="document" && <div className="studio-layout"><nav className="stepper" aria-label="Rewrite progress">{documentSteps.map((label,index)=><button key={label} className={index===step?"active":index<step?"done":""} onClick={()=>index===0||jobId?setStep(index):undefined}><span>{index<step?<Check size={13}/>:index+1}</span>{label}</button>)}</nav><div className="workspace-card card">
      {step===0&&<><Heading n="01" title="Upload a DOCX" copy="The processor inventories the immutable source document before any extraction is created."/><FilePicker accept=".docx" file={file} onChange={setFile}/><button className="button primary" disabled={!file||phase==="loading"} onClick={upload}><UploadCloud size={16}/>Upload and inspect</button></>}
      {step===1&&<><Heading n="02" title="Choose exactly what to rewrite" copy="Use the processor-generated Word inventory to select the automatic body, an ordered range, whole blocks, or exact character ranges."/>{inventory ? <><DocumentSelection inventory={inventory} mode={rangeMode} onModeChange={setRangeMode} selectedBlocks={selectedBlocks} onSelectedBlocksChange={setSelectedBlocks} startOrder={start} endOrder={end} onStartOrderChange={setStart} onEndOrderChange={setEnd} visualRanges={visualRanges} onVisualRangesChange={setVisualRanges} includeHeadings={includeHeadings} includeCaptions={includeCaptions} includeTableHeaders={includeTableHeaders} onIncludeHeadingsChange={setIncludeHeadings} onIncludeCaptionsChange={setIncludeCaptions} onIncludeTableHeadersChange={setIncludeTableHeaders} locked={Boolean(extraction)}/>{extraction?<div className="extraction-locked"><Check size={16}/><div><strong>Extraction locked</strong><span>{extraction.chunks.length} chunk(s) now reference the immutable v21 mapping.</span></div></div>:<button className="button primary selection-submit" disabled={rangeMode==="manual"&&!selectedBlocks.size||rangeMode==="visual"&&!visualRanges.length} onClick={select}>Create immutable extraction</button>}</> : <p className="empty-inline">Upload a DOCX first to load its structural inventory.</p>}</>}
      {step===2&&extraction&&<><Heading n="03" title="Rewrite, review and export" copy="Each editor is keyed by the canonical chunk number. Rewrite cycles always use the text currently shown in every editor."/><RewriteWorkspace jobId={jobId} extraction={extraction}/></>}
      {step===2&&!extraction&&<p className="empty-inline">Create an extraction before opening the rewrite workspace.</p>}
      {step<2&&<Operation phase={phase} error={error} onRetry={()=>setPhase("idle")}>{Object.keys(result).length>0&&<details><summary>Operation details</summary><pre>{message(result)}</pre></details>}</Operation>}
    </div></div>}
    {tab==="text"&&<Tool title="Rewrite pasted text" description="Rewrite short-form content without uploading a document."><label className="field"><span>Text</span><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste at least one sentence…"/></label><div className="field-row"><label className="field"><span>Profile</span><select value={profile} onChange={e=>setProfile(e.target.value as RewriteProfile)}>{profileOptions.map(value=><option value={value} key={value}>{value}</option>)}</select></label><label className="field"><span>Writing style</span><select value={styleProfile} onChange={e=>setStyleProfile(e.target.value as WritingStyle)}>{styleOptions.map(value=><option value={value} key={value}>{value}</option>)}</select></label></div><button className="button primary" disabled={!text.trim()} onClick={()=>run(()=>api.rewriteText({text,profile,style_profile:styleProfile}))}>Rewrite text</button><Operation phase={phase} error={error} onRetry={()=>run(()=>api.rewriteText({text,profile,style_profile:styleProfile}))}><pre>{message(result)}</pre></Operation></Tool>}
    {tab==="detect"&&<Tool title="AI-content detection" description="Analyse pasted text or a DOCX/TXT file and review confidence signals."><label className="field"><span>Text to analyse</span><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste text…"/></label><FilePicker accept=".docx,.txt" file={file} onChange={setFile}/><div className="button-row"><button className="button primary" disabled={!text.trim()} onClick={()=>run(()=>api.detectText(text))}>Detect text</button><button className="button secondary" disabled={!file} onClick={()=>file&&run(()=>api.detectFile(file))}>Detect file</button></div><Operation phase={phase} error={error} onRetry={()=>setPhase("idle")}><pre>{message(result)}</pre></Operation></Tool>}
    {tab==="format"&&<Tool title="Formatting workspace" description="Analyse styles, preview recommended changes, configure rules and export a clean DOCX."><FilePicker accept=".docx" file={file} onChange={setFile}/><button className="button primary" disabled={!file} onClick={()=>file&&run(async()=>{const r=await api.analyseFormatting(file);setFormatJob(r.job_id);return r})}>Analyse formatting</button><div className="format-preview"><div><strong>Document preview</strong><h3>1. Introduction</h3><p>Style findings and a live structural preview appear here after analysis.</p></div></div><button className="button secondary" disabled={!formatJob} onClick={()=>run(async()=>{const r=await api.applyFormatting(formatJob,{page_numbers:false,line_spacing:1.5});setDownloadUrl(r.download_url);return r})}>Apply configuration</button>{downloadUrl&&<a className="button primary" href={downloadUrl}><Download size={16}/>Export DOCX</a>}<Operation phase={phase} error={error} onRetry={()=>setPhase("idle")}><pre>{message(result)}</pre></Operation></Tool>}
  </section>
}
function Heading({n,title,copy}:{n:string,title:string,copy:string}){return <div className="workspace-heading"><span>{n}</span><div><h3>{title}</h3><p>{copy}</p></div></div>}
function Tool({title,description,children}:{title:string,description:string,children:ReactNode}){return <div className="tool-card card"><h3>{title}</h3><p>{description}</p>{children}</div>}
function FilePicker({accept,file,onChange}:{accept:string,file?:File,onChange:(f:File)=>void}){return <label className="dropzone"><input type="file" accept={accept} onChange={e=>e.target.files?.[0]&&onChange(e.target.files[0])}/><UploadCloud/><strong>{file?file.name:"Choose a file or drop it here"}</strong><span>{accept.replaceAll(",",", ")} · maximum size is enforced by the gateway</span></label>}
