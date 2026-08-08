import { useState, type ReactNode } from "react";
import type { DocumentInventory, ExtractionResponse, SelectionMode, VisualRange } from "@airem/contracts";
import { api } from "../lib/api";
import { DocumentSelection } from "../features/rewrite/DocumentSelection";
import { RewriteWorkspace } from "../features/rewrite/RewriteWorkspace";
import { TextRewriteStudio } from "../features/secondary/TextRewriteStudio";
import { DetectionStudio } from "../features/secondary/DetectionStudio";
import { FormattingStudio } from "../features/secondary/FormattingStudio";
import "../features/rewrite/selection.css";
import "../features/rewrite/workspace.css";
import "../features/secondary/secondary.css";
import { AlertCircle, Check, LoaderCircle, RefreshCw, UploadCloud } from "lucide-react";

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

export function RewriteStudio() {
  const [tab, setTab] = useState<"document"|"text"|"detect"|"format">("document");
  const [step, setStep] = useState(0); const [phase,setPhase]=useState<Phase>("idle");
  const [error,setError]=useState(""); const [result,setResult]=useState<Result>({}); const [file,setFile]=useState<File>();
  const [jobId,setJobId]=useState(""); const [inventory,setInventory]=useState<DocumentInventory>(); const [extraction,setExtraction]=useState<ExtractionResponse>();
  const [selectedBlocks,setSelectedBlocks]=useState<Set<string>>(new Set()); const [visualRanges,setVisualRanges]=useState<VisualRange[]>([]);
  const [rangeMode,setRangeMode]=useState<SelectionMode>("automatic"); const [start,setStart]=useState(0); const [end,setEnd]=useState(0);
  const [includeHeadings,setIncludeHeadings]=useState(false); const [includeCaptions,setIncludeCaptions]=useState(false); const [includeTableHeaders,setIncludeTableHeaders]=useState(false);

  const acceptResult = <T extends object>(data: T, next?: number) => { const record = data as Record<string, unknown>; setResult(record); const id = String(record.job_id ?? ""); if (id) setJobId(id); if (next !== undefined) setStep(next); };
  const run = async <T extends object>(task:()=>Promise<T>, next?:number): Promise<T | undefined> => { setPhase("loading"); setError(""); try { const data=await task(); acceptResult(data,next); setPhase("success"); return data; } catch(e){setError(e instanceof Error?e.message:"Unexpected error");setPhase("error"); return undefined;} };
  const requireFile = () => { if(!file){setError("Choose a supported file first.");setPhase("error");return false} return true };
  const upload=async()=>{ if(!requireFile())return; const uploaded=await run(()=>api.uploadDocument(file!),1); if(!uploaded)return; setInventory(uploaded.inventory); const defaults=uploaded.inventory.blocks.filter(block=>block.default_selected); setStart(defaults[0]?.order ?? 0); setEnd(defaults.at(-1)?.order ?? Math.max(0,uploaded.inventory.block_count-1)); setSelectedBlocks(new Set(defaults.map(block=>block.block_id))); setVisualRanges([]); setRangeMode("automatic"); setIncludeHeadings(false); setIncludeCaptions(false); setIncludeTableHeaders(false); setExtraction(undefined); };
  const select=async()=>{ if(!inventory || extraction)return; const extracted=await run(()=>api.extractRanges(jobId,{ selection_mode: rangeMode, selected_blocks: rangeMode === "manual" ? [...selectedBlocks] : undefined, start_order: rangeMode === "range" ? start : undefined, end_order: rangeMode === "range" ? end : undefined, visual_ranges: rangeMode === "visual" ? visualRanges : undefined, include_headings: includeHeadings, include_captions: includeCaptions, include_table_headers: includeTableHeaders }),2); if(extracted)setExtraction(extracted); };
  const tabs = [{id:"document",label:"DOCX rewrite"},{id:"text",label:"Paste text"},{id:"detect",label:"Detection"},{id:"format",label:"Formatting"}] as const;

  return <section className="studio">
    <header className="studio-head"><div><p className="eyebrow">Writing workspace</p><h2>AIREM Studio</h2><p>Document rewriting plus the original v21 text, detection, and formatting tools.</p></div></header>
    <div className="studio-tabs" role="tablist">{tabs.map(t=><button role="tab" aria-selected={tab===t.id} onClick={()=>{setTab(t.id);setPhase("idle")}} key={t.id}>{t.label}</button>)}</div>
    {tab==="document" && <div className="studio-layout"><nav className="stepper" aria-label="Rewrite progress">{documentSteps.map((label,index)=><button key={label} className={index===step?"active":index<step?"done":""} onClick={()=>index===0||jobId?setStep(index):undefined}><span>{index<step?<Check size={13}/>:index+1}</span>{label}</button>)}</nav><div className="workspace-card card">
      {step===0&&<><Heading n="01" title="Upload a DOCX" copy="The processor inventories the immutable source document before any extraction is created."/><FilePicker accept=".docx" file={file} onChange={setFile}/><button className="button primary" disabled={!file||phase==="loading"} onClick={upload}><UploadCloud size={16}/>Upload and inspect</button></>}
      {step===1&&<><Heading n="02" title="Choose exactly what to rewrite" copy="Use the processor-generated Word inventory to select the automatic body, an ordered range, whole blocks, or exact character ranges."/>{inventory ? <><DocumentSelection inventory={inventory} mode={rangeMode} onModeChange={setRangeMode} selectedBlocks={selectedBlocks} onSelectedBlocksChange={setSelectedBlocks} startOrder={start} endOrder={end} onStartOrderChange={setStart} onEndOrderChange={setEnd} visualRanges={visualRanges} onVisualRangesChange={setVisualRanges} includeHeadings={includeHeadings} includeCaptions={includeCaptions} includeTableHeaders={includeTableHeaders} onIncludeHeadingsChange={setIncludeHeadings} onIncludeCaptionsChange={setIncludeCaptions} onIncludeTableHeadersChange={setIncludeTableHeaders} locked={Boolean(extraction)}/>{extraction?<div className="extraction-locked"><Check size={16}/><div><strong>Extraction locked</strong><span>{extraction.chunks.length} chunk(s) now reference the immutable v21 mapping.</span></div></div>:<button className="button primary selection-submit" disabled={rangeMode==="manual"&&!selectedBlocks.size||rangeMode==="visual"&&!visualRanges.length} onClick={select}>Create immutable extraction</button>}</> : <p className="empty-inline">Upload a DOCX first to load its structural inventory.</p>}</>}
      {step===2&&extraction&&<><Heading n="03" title="Rewrite, review and export" copy="Each editor is keyed by the canonical chunk number. Rewrite cycles always use the text currently shown in every editor."/><RewriteWorkspace jobId={jobId} extraction={extraction}/></>}
      {step===2&&!extraction&&<p className="empty-inline">Create an extraction before opening the rewrite workspace.</p>}
      {step<2&&<Operation phase={phase} error={error} onRetry={()=>setPhase("idle")}>{Object.keys(result).length>0&&<details><summary>Operation details</summary><pre>{message(result)}</pre></details>}</Operation>}
    </div></div>}
    {tab==="text"&&<TextRewriteStudio/>}
    {tab==="detect"&&<DetectionStudio/>}
    {tab==="format"&&<FormattingStudio/>}
  </section>
}
function Heading({n,title,copy}:{n:string,title:string,copy:string}){return <div className="workspace-heading"><span>{n}</span><div><h3>{title}</h3><p>{copy}</p></div></div>}
function FilePicker({accept,file,onChange}:{accept:string,file?:File,onChange:(f:File)=>void}){return <label className="dropzone"><input type="file" accept={accept} onChange={e=>e.target.files?.[0]&&onChange(e.target.files[0])}/><UploadCloud/><strong>{file?file.name:"Choose a file or drop it here"}</strong><span>{accept.replaceAll(",",", ")} · maximum size is enforced by the gateway</span></label>}
