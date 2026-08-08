import { useState, type ReactNode } from "react";
import type { RewriteProfile, SelectionMode, WritingStyle } from "@airem/contracts";
import { api } from "../lib/api";
import { AlertCircle, Check, ChevronRight, Download, LoaderCircle, RefreshCw, UploadCloud } from "lucide-react";

type Phase = "idle" | "loading" | "success" | "error";
type Result = Record<string, unknown>;
const message = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);

function Operation({ phase, error, onRetry, children }: { phase: Phase; error?: string; onRetry?: () => void; children?: ReactNode }) {
  if (phase === "loading") return <div className="operation-state"><LoaderCircle className="spin"/><strong>Processing…</strong><span>Please keep this page open.</span><progress aria-label="Operation progress" /></div>;
  if (phase === "error") return <div className="operation-state danger"><AlertCircle/><strong>Operation failed</strong><span>{error}</span>{onRetry && <button className="button secondary" onClick={onRetry}><RefreshCw size={14}/>Retry</button>}</div>;
  if (phase === "success") return <div className="operation-state success"><Check/><strong>Complete</strong>{children}</div>;
  return null;
}

const steps = ["Upload", "Select ranges", "Configure", "Rewrite", "Review", "Download"];
const profileOptions: RewriteProfile[] = ["light", "natural", "rewrite_compress", "compress", "plain", "expanded", "conservative", "balanced", "manual"];
const styleOptions: WritingStyle[] = ["natural_student", "simple_student", "natural_academic", "plain_professional"];

export function RewriteStudio() {
  const [tab, setTab] = useState<"document"|"text"|"detect"|"format">("document");
  const [step, setStep] = useState(0); const [phase,setPhase]=useState<Phase>("idle");
  const [error,setError]=useState(""); const [result,setResult]=useState<Result>({}); const [file,setFile]=useState<File>();
  const [jobId,setJobId]=useState(""); const [text,setText]=useState(""); const [profile,setProfile]=useState<RewriteProfile>("natural");
  const [styleProfile,setStyleProfile]=useState<WritingStyle>("natural_student");
  const [rangeMode,setRangeMode]=useState<SelectionMode>("automatic"); const [start,setStart]=useState(0); const [end,setEnd]=useState(10); const [terms,setTerms]=useState("");
  const [cycles,setCycles]=useState(1); const [editedTexts,setEditedTexts]=useState<Record<string,string>>({}); const [formatJob,setFormatJob]=useState("");
  const [downloadUrl,setDownloadUrl]=useState("");

  const acceptResult = <T extends object>(data: T, next?: number) => {
    const record = data as Record<string, unknown>;
    setResult(record);
    const id = String(record.job_id ?? "");
    if (id) setJobId(id);
    if (next !== undefined) setStep(next);
  };
  const run = async <T extends object>(task:()=>Promise<T>, next?:number): Promise<T | undefined> => {
    setPhase("loading"); setError("");
    try { const data=await task(); acceptResult(data,next); setPhase("success"); return data; }
    catch(e){setError(e instanceof Error?e.message:"Unexpected error");setPhase("error"); return undefined;}
  };
  const requireFile = () => { if(!file){setError("Choose a supported file first.");setPhase("error");return false} return true };
  const upload=()=>requireFile()&&run(()=>api.uploadDocument(file!),1);
  const select=()=>run(()=>api.extractRanges(jobId,{
    selection_mode: rangeMode,
    selected_blocks: rangeMode==="manual" ? text.split(",").map(value=>value.trim()).filter(Boolean) : undefined,
    start_order: rangeMode==="range" ? start : undefined,
    end_order: rangeMode==="range" ? end : undefined,
    include_headings: true,
    include_captions: true,
  }),2);
  const rewrite=async()=>{
    const protectedTerms=terms.split("\n").map(value=>value.trim()).filter(Boolean);
    const manualSettings = profile === "manual" ? { target_change_percent: -2, length_tolerance: 7, lexical_intensity: 70, connector_intensity: 70, compression_intensity: 70 } : undefined;
    const first=await run(()=>api.rewriteDocument(jobId,{profile,style_profile:styleProfile,protected_terms:protectedTerms,manual_settings:manualSettings}),4);
    if(!first)return;
    let current=first.edited_texts;
    setEditedTexts(current);
    for(let i=1;i<cycles;i++){
      const next=await run(()=>api.rewriteDocumentCycle(jobId,{profile,style_profile:styleProfile,protected_terms:protectedTerms,manual_settings:manualSettings,edited_texts:current}),4);
      if(!next)return;
      current=next.edited_texts;
      setEditedTexts(current);
    }
  };
  const validate=()=>run(()=>api.validateDocument(jobId,{edited_texts:editedTexts}),5);
  const reinsert=async()=>{
    const response=await run(()=>api.reinsertDocument(jobId,{edited_texts:editedTexts}));
    if(response)setDownloadUrl(response.download_url);
  };
  const firstChunkKey=Object.keys(editedTexts).sort((a,b)=>Number(a)-Number(b))[0];
  const firstChunk=firstChunkKey ? editedTexts[firstChunkKey] : "";
  const tabs = [{id:"document",label:"DOCX rewrite"},{id:"text",label:"Paste text"},{id:"detect",label:"AI detection"},{id:"format",label:"Formatting"}] as const;

  return <section className="studio">
    <header className="studio-head"><div><p className="eyebrow">Writing workspace</p><h2>Document studio</h2><p>Rewrite, inspect, validate and export without losing your formatting.</p></div></header>
    <div className="studio-tabs" role="tablist">{tabs.map(t=><button role="tab" aria-selected={tab===t.id} onClick={()=>{setTab(t.id);setPhase("idle")}} key={t.id}>{t.label}</button>)}</div>
    {tab==="document" && <div className="studio-layout"><nav className="stepper" aria-label="Rewrite progress">{steps.map((s,i)=><button key={s} className={i===step?"active":i<step?"done":""} onClick={()=>jobId||i===0?setStep(i):undefined}><span>{i<step?<Check size={13}/>:i+1}</span>{s}</button>)}</nav><div className="workspace-card card">
      {step===0&&<><Heading n="01" title="Upload a DOCX" copy="Your original remains untouched. Files are processed through the secure document gateway."/><FilePicker accept=".docx" file={file} onChange={setFile}/><button className="button primary" disabled={!file||phase==="loading"} onClick={upload}><UploadCloud size={16}/>Upload and inspect</button></>}
      {step===1&&<><Heading n="02" title="Choose what to rewrite" copy="Use the v21 automatic, block, or ordered-range extraction modes. Turnitin highlights become saved visual ranges after report mapping."/><div className="choice-grid">{(["automatic","manual","range"] as SelectionMode[]).map(x=><button className={rangeMode===x?"selected":""} onClick={()=>setRangeMode(x)} key={x}><strong>{x}</strong><span>{x==="automatic"?"Detect body content":x==="manual"?"Enter block IDs":"Use block order boundaries"}</span></button>)}</div>{rangeMode==="manual"&&<label className="field"><span>Block IDs</span><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="p_12,p_13"/></label>}{rangeMode==="range"&&<div className="field-row"><label className="field"><span>Start order</span><input type="number" value={start} min={0} onChange={e=>setStart(+e.target.value)}/></label><label className="field"><span>End order</span><input type="number" value={end} min={start} onChange={e=>setEnd(+e.target.value)}/></label></div>}<button className="button primary" onClick={select}>Extract selection<ChevronRight size={16}/></button></>}
      {step===2&&<><Heading n="03" title="Configure extraction" copy="Protect names, citations, terminology and phrases from modification."/><label className="field"><span>Protected terms · one per line</span><textarea value={terms} onChange={e=>setTerms(e.target.value)} placeholder="AIREM\nSmith et al. (2024)"/></label><button className="button primary" onClick={()=>setStep(3)}>Continue<ChevronRight size={16}/></button></>}
      {step===3&&<><Heading n="04" title="Rewrite controls" copy="These controls map directly to v21 rewrite profiles and writing styles."/><div className="field-row"><label className="field"><span>Rewrite profile</span><select value={profile} onChange={e=>setProfile(e.target.value as RewriteProfile)}>{profileOptions.map(value=><option value={value} key={value}>{value}</option>)}</select></label><label className="field"><span>Writing style</span><select value={styleProfile} onChange={e=>setStyleProfile(e.target.value as WritingStyle)}>{styleOptions.map(value=><option value={value} key={value}>{value}</option>)}</select></label></div><label className="field"><span>Total rewrite passes</span><input type="number" min="1" value={cycles} onChange={e=>setCycles(Math.max(1,+e.target.value||1))}/></label>{profile==="manual"&&<p className="small">Manual mode currently submits the documented v21 constrained defaults; full manual controls are restored in the dedicated workspace parity PR.</p>}<button className="button primary" onClick={rewrite}>Start rewrite<ChevronRight size={16}/></button></>}
      {step===4&&<><Heading n="05" title="Review & diagnostics" copy="Mapped v21 output is stored per extraction chunk. Edit the current chunk without losing the other chunk mappings."/><div className="comparison"><label className="field"><span>Current chunk</span><textarea value={firstChunk} onChange={e=>firstChunkKey&&setEditedTexts(current=>({...current,[firstChunkKey]:e.target.value}))} placeholder="Run a rewrite to populate mapped text"/></label><div className="field"><span>Mapped chunks</span><pre>{JSON.stringify(editedTexts,null,2)}</pre></div></div><div className="diagnostics"><span><Check size={14}/> Paragraph mapping</span><span><Check size={14}/> Protected terms</span><span><Check size={14}/> Formatting structure</span></div><button className="button primary" disabled={!Object.keys(editedTexts).length} onClick={validate}>Validate and continue</button></>}
      {step===5&&<><Heading n="06" title="Reinsert & download" copy="Merge validated mapped chunks into a copy of your original DOCX."/><button className="button secondary" disabled={!Object.keys(editedTexts).length} onClick={reinsert}>Reinsert into DOCX</button>{downloadUrl?<a className="button primary" href={downloadUrl}><Download size={16}/>Download final DOCX</a>:<p className="empty-inline">Reinsert the validated content to receive the canonical output URL.</p>}</>}
      <Operation phase={phase} error={error} onRetry={()=>setPhase("idle")}>{Object.keys(result).length>0&&<details><summary>Operation details</summary><pre>{message(result)}</pre></details>}</Operation>
    </div></div>}
    {tab==="text"&&<Tool title="Rewrite pasted text" description="Rewrite short-form content without uploading a document."><label className="field"><span>Text</span><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste at least one sentence…"/></label><div className="field-row"><label className="field"><span>Profile</span><select value={profile} onChange={e=>setProfile(e.target.value as RewriteProfile)}>{profileOptions.filter(value=>value!=="manual").map(value=><option value={value} key={value}>{value}</option>)}</select></label><label className="field"><span>Writing style</span><select value={styleProfile} onChange={e=>setStyleProfile(e.target.value as WritingStyle)}>{styleOptions.map(value=><option value={value} key={value}>{value}</option>)}</select></label></div><button className="button primary" disabled={!text.trim()} onClick={()=>run(()=>api.rewriteText({text,profile,style_profile:styleProfile}))}>Rewrite text</button><Operation phase={phase} error={error} onRetry={()=>run(()=>api.rewriteText({text,profile,style_profile:styleProfile}))}><pre>{message(result)}</pre></Operation></Tool>}
    {tab==="detect"&&<Tool title="AI-content detection" description="Analyse pasted text or a DOCX/TXT file and review confidence signals."><label className="field"><span>Text to analyse</span><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste text…"/></label><FilePicker accept=".docx,.txt" file={file} onChange={setFile}/><div className="button-row"><button className="button primary" disabled={!text.trim()} onClick={()=>run(()=>api.detectText(text))}>Detect text</button><button className="button secondary" disabled={!file} onClick={()=>file&&run(()=>api.detectFile(file))}>Detect file</button></div><Operation phase={phase} error={error} onRetry={()=>setPhase("idle")}><pre>{message(result)}</pre></Operation></Tool>}
    {tab==="format"&&<Tool title="Formatting workspace" description="Analyse styles, preview recommended changes, configure rules and export a clean DOCX."><FilePicker accept=".docx" file={file} onChange={setFile}/><button className="button primary" disabled={!file} onClick={()=>file&&run(async()=>{const r=await api.analyseFormatting(file);setFormatJob(r.job_id);return r})}>Analyse formatting</button><div className="format-preview"><div><strong>Document preview</strong><h3>1. Introduction</h3><p>Style findings and a live structural preview appear here after analysis.</p></div><div className="check-list"><label><input type="checkbox" defaultChecked/> Normalise heading hierarchy</label><label><input type="checkbox" defaultChecked/> Standardise body spacing</label><label><input type="checkbox"/> Add page numbers</label></div></div><button className="button secondary" disabled={!formatJob} onClick={()=>run(async()=>{const r=await api.applyFormatting(formatJob,{page_numbers:false,line_spacing:1.5});setDownloadUrl(r.download_url);return r})}>Apply configuration</button>{downloadUrl&&<a className="button primary" href={downloadUrl}><Download size={16}/>Export DOCX</a>}<Operation phase={phase} error={error} onRetry={()=>setPhase("idle")}><pre>{message(result)}</pre></Operation></Tool>}
  </section>
}
function Heading({n,title,copy}:{n:string,title:string,copy:string}){return <div className="workspace-heading"><span>{n}</span><div><h3>{title}</h3><p>{copy}</p></div></div>}
function Tool({title,description,children}:{title:string,description:string,children:ReactNode}){return <div className="tool-card card"><h3>{title}</h3><p>{description}</p>{children}</div>}
function FilePicker({accept,file,onChange}:{accept:string,file?:File,onChange:(f:File)=>void}){return <label className="dropzone"><input type="file" accept={accept} onChange={e=>e.target.files?.[0]&&onChange(e.target.files[0])}/><UploadCloud/><strong>{file?file.name:"Choose a file or drop it here"}</strong><span>{accept.replaceAll(",",", ")} · maximum size is enforced by the gateway</span></label>}
