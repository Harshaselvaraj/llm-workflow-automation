import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

async function api(path, options) {
  const response = await fetch('/api' + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
  return data;
}
const post = data => ({method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
function App() {
  const [workflows,setWorkflows] = useState([]), [runs,setRuns] = useState([]), [selected,setSelected] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [form,setForm] = useState({name:'Document review',task:'extract',provider:'demo',model:'gpt-4o-mini',instructions:'Extract vendor, amount and date as a JSON object.',require_approval:true,output:'save',webhook_url:''});
  const [rule,setRule] = useState({field:'',operator:'exists',value:''});
  const [text,setText] = useState('{"vendor":"Acme Supplies","amount":1250,"date":"2026-10-12"}');
  const [file,setFile] = useState(null), [active,setActive] = useState(null);
  async function refresh() { const [w,r] = await Promise.all([api('/workflows'),api('/runs')]); setWorkflows(w);setRuns(r);setSelected(current=>current || w[0]?.id || ''); }
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);
  async function perform(fn) {setBusy(true);setError('');setNotice('');try {await fn();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const change = e=>setForm({...form,[e.target.name]:e.target.type==='checkbox'?e.target.checked:e.target.value});
  return <main>
    <header><a className="brand" href="/">◈ <strong>FlowForge</strong><span>AI AUTOMATION</span></a><span className="badge">Development workspace</span></header>
    <section className="intro"><div><p className="eyebrow">FROM DOCUMENT TO DECISION</p><h1>Your workflow.<br/><em>Any industry.</em></h1><p>Turn documents into structured results, apply your rules,<br/>and keep people in control of the next action.</p></div><div className="stat"><strong>{workflows.length.toString().padStart(2,'0')}</strong><span>automations created</span></div></section>
    {error && <p className="alert" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <div className="grid"><section className="panel"><div className="section-title"><span className="number">01</span><h2>Create automation</h2></div>
      <form onSubmit={e=>{e.preventDefault();perform(async()=>{const w=await api('/workflows',post({...form,rules:rule.field?[rule]:[]}));setSelected(w.id);setNotice('Automation saved. Submit a document to run it.');});}}>
        <label>Automation name<input required name="name" value={form.name} onChange={change}/></label>
        <div className="two"><label>AI task<select name="task" value={form.task} onChange={change}><option value="extract">Extract information</option><option value="classify">Classify request</option><option value="summarize">Summarize document</option></select></label><label>Model provider<select name="provider" value={form.provider} onChange={change}><option value="demo">Demo · no credentials</option><option value="openai">OpenAI</option><option value="ollama">Ollama</option></select></label></div>
        {form.provider !== 'demo' && <label>Model name<input required name="model" value={form.model} onChange={change}/></label>}
        <label>Processing instructions<textarea name="instructions" value={form.instructions} onChange={change}/></label>
        <fieldset><legend>Validation rule <span>optional</span></legend><div className="two"><input aria-label="Rule field" placeholder="Field, e.g. amount" value={rule.field} onChange={e=>setRule({...rule,field:e.target.value})}/><select aria-label="Rule operator" value={rule.operator} onChange={e=>setRule({...rule,operator:e.target.value})}><option value="exists">Must exist</option><option value="equals">Equals</option><option value="greater_than">Greater than</option></select></div>{rule.operator!=='exists' && <input aria-label="Rule value" placeholder="Comparison value" value={rule.value} onChange={e=>setRule({...rule,value:e.target.value})}/>}<small>A failed rule stops the run before approval or output.</small></fieldset>
        <label className="check"><input type="checkbox" name="require_approval" checked={form.require_approval} onChange={change}/> Require human approval before output</label>
        <label>Output destination<select name="output" value={form.output} onChange={change}><option value="save">Save execution result</option><option value="webhook">External HTTPS API</option></select></label>
        {form.output==='webhook' && <label>Webhook URL<input required type="url" name="webhook_url" value={form.webhook_url} onChange={change}/><small>Administrator must allow the destination hostname.</small></label>}
        <div className="preview">INPUT <span>→</span> {form.task.toUpperCase()} <span>→</span> {form.require_approval?'APPROVAL':'RULES'} <span>→</span> OUTPUT</div>
        <button disabled={busy} className="primary">Create automation ↗</button>
      </form>
    </section><div><section className="panel"><div className="section-title"><span className="number">02</span><h2>Run a document</h2></div>
      <label>Automation<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select an automation</option>{workflows.map(w=><option key={w.id} value={w.id}>{w.name} · {w.provider}</option>)}</select></label>
      <label>Document text or JSON<textarea className="document" value={text} onChange={e=>setText(e.target.value)}/></label>
      <label className="upload">Or upload a document<input type="file" accept=".pdf,.txt,.json" onChange={e=>setFile(e.target.files[0] || null)}/><small>Text-based PDF, TXT or JSON · maximum 5 MB. Uploaded file takes priority.</small></label>
      <button className="primary" disabled={busy || !selected || (!file && !text.trim())} onClick={()=>perform(async()=>{let options=post({text});if(file){const body=new FormData();body.append('file',file);options={method:'POST',body};}const r=await api(`/workflows/${selected}/${file?'upload':'runs'}`,options);setActive(r);setNotice(`Execution ${r.status.replaceAll('_',' ')}.`);})}>{busy?'Working…':'Run automation →'}</button>
      <p className="muted">Demo extraction preserves JSON objects or returns document text. Choose a live model for semantic extraction.</p>
    </section><section className="panel history"><div className="section-title"><span className="number">03</span><h2>Execution history</h2><button className="quiet" disabled={busy} onClick={()=>perform(refresh)}>Refresh</button></div>
      {runs.length===0?<p className="empty">Your first execution will appear here.</p>:runs.map(r=><button className={'run '+(active?.id===r.id?'selected':'')} key={r.id} onClick={()=>setActive(r)}><span><strong>{r.workflow.name}</strong><small>{new Date(r.created_at).toLocaleString()}</small></span><span className={'status '+r.status}>{r.status.replaceAll('_',' ')}</span></button>)}
    </section></div></div>
    {active && <section className="panel result"><div className="section-title"><h2>Execution details</h2><span className={'status '+active.status}>{active.status.replaceAll('_',' ')}</span></div><p className="muted">Run {active.id}</p><pre>{JSON.stringify(active.result,null,2)}</pre>{active.error && <p className="alert">Execution failed: {active.error}. Check provider configuration and server logs.</p>}<ol className="steps">{active.steps.map((s,i)=><li key={i}><strong>{s.step}</strong><span>{s.status}</span><small>{s.detail}</small></li>)}</ol>{active.status==='awaiting_approval' && <div className="actions"><button disabled={busy} className="primary" onClick={()=>perform(async()=>setActive(await api(`/runs/${active.id}/decision`,post({approve:true}))))}>Approve & send output</button><button disabled={busy} onClick={()=>perform(async()=>setActive(await api(`/runs/${active.id}/decision`,post({approve:false}))))}>Reject</button></div>}</section>}
    <footer>FlowForge · Local prototype · Add identity, durable workers and deployment hardening before customer use.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
