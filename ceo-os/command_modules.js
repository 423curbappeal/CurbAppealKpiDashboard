/* CEO OS additions: local-first interface with existing /api/state cloud persistence.
 * All user data is rendered via textContent, never raw HTML. */
(()=>{'use strict';
const api=window.ceoOSBridge;if(!api)return;
const $=id=>document.getElementById(id),now=()=>Date.now(),today=()=>api.today(),month=()=>today().slice(0,7);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
const dateCheck=d=>d?new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'No date';
const opt=(values)=>values.map(x=>'<option>'+x+'</option>').join('');
const state=()=>api.getState();
const uid=()=>String(Date.now())+'-'+Math.random().toString(36).slice(2);
const add=(key,entry)=>{const a=state()[key];if(a.length>=250)throw Error('250-entry limit reached');a.unshift({id:uid(),when:now(),text:entry.text,done:false,...entry});api.save();api.render();};
const remove=(key,id)=>{state()[key]=state()[key].filter(x=>x.id!==id);api.save();api.render();};
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
const empty=(target,text)=>target.append(el('p',text,'muted small'));
const action=(label,onClick,style='secondary')=>{const btn=el('button',label,style);btn.type='button';btn.addEventListener('click',onClick);return btn;};
const itemRow=(target,title,detail,actions=[])=>{const row=el('div',undefined,'command-item'),left=el('div');left.append(el('strong',title),el('div',detail,'command-muted'));const right=el('div',undefined,'command-actions');for(const a of actions)right.append(a);row.append(left,right);target.append(row);};
const pct=(a,b)=>b>0?Math.min(100,Math.max(0,Math.round(a/b*100))):0;
const progress=(target,value)=>{const track=el('div',undefined,'command-progress'),fill=el('div');fill.style.width=Math.min(100,value)+'%';track.append(fill);target.append(track);};
const fnum=(field)=>{const n=Number($(field).value);if(!Number.isFinite(n)||n<0||n>1e9)throw Error('Enter a valid amount');return Math.round(n*100)/100;};
const showError=(target,err)=>{$(target).textContent=err?.message||'Unable to save. Check your entries.';};
function card(container,html){const node=el('div');node.className='command-card';node.innerHTML=html;container.append(node);return node;}
function initialize(){
 const planner=$('planner'),business=$('business'),fitness=$('fitness'),finance=$('finance'),main=document.querySelector('main');
 const blocks=card(planner,`<div class="eyebrow">CEO daily planner</div><h2>Time blocks</h2>
 <form id="time-block-form" class="command-form"><label for="block-text">What are you working on?</label><input id="block-text" maxlength="160" placeholder="Sales calls, estimates, gym…" required>
 <div class="field-grid"><div><label class="field-label" for="block-date">Day</label><input id="block-date" type="date" required></div><div><label class="field-label" for="block-focus">Focus</label><select id="block-focus">${opt(['Work','Personal','Fitness'])}</select></div></div>
 <div class="field-grid"><div><label class="field-label" for="block-start">Start</label><input id="block-start" type="time" value="09:00" required></div><div><label class="field-label" for="block-end">End</label><input id="block-end" type="time" value="10:00" required></div></div>
 <button class="primary" type="submit">Schedule block</button></form><p id="block-error" class="command-note" aria-live="polite"></p>
 <div class="row" style="margin-top:14px"><h2 style="margin:0">Your schedule</h2><span class="muted small" id="block-count"></span></div><div id="block-list"></div>
 <p class="muted small">These blocks stay in CEO OS; Google Calendar remains read-only. Overlapping blocks are flagged.</p>`);
 $('block-date').value=today();
 $('time-block-form').addEventListener('submit',e=>{e.preventDefault();try{
  const start=$('block-start').value,end=$('block-end').value,date=$('block-date').value;
  if(!start||!end||start>=end)throw Error('End time must be after start time.');
  add('time_blocks',{text:$('block-text').value.trim(),date,start,end,focus:$('block-focus').value});
  $('block-text').value='';$('block-error').textContent='';
 }catch(err){showError('block-error',err);}});
 card(business,`<div class="eyebrow">Business command center</div><h2>Sales execution and revenue goals</h2>
 <div class="command-grid"><div><div class="muted small">Open opportunities</div><div class="command-stat" id="biz-open">0</div></div>
 <div><div class="muted small">Open quoted value · manually entered</div><div class="command-stat" id="biz-value">$0</div></div>
 <div><div class="muted small">Estimate close rate · tracked leads</div><div class="command-stat" id="biz-close">—</div></div>
 <div><div class="muted small">Next follow-ups due</div><div class="command-stat" id="biz-followups">0</div></div></div>
 <div id="biz-goal-progress" style="margin-top:14px"></div><p class="muted small">Your existing weekly KPI feed above remains read-only. Sales figures below come from your manually tracked opportunities, not Housecall Pro.</p>
 <button class="secondary" type="button" data-command-page="sales">Open sales pipeline</button>`);
 card(finance,`<div class="eyebrow">Financial freedom tracker</div><h2>Monthly bills and spending limits</h2>
 <p class="muted small">Uses manually entered bills and expenses only. Fictional Plaid Sandbox and locked live-bank figures are never included.</p>
 <div class="command-grid"><div><div class="muted small">Planned monthly bills</div><div class="command-stat" id="freedom-bills-total">$0</div></div>
 <div><div class="muted small">Bills marked paid this month</div><div class="command-stat" id="freedom-bills-paid">0 / 0</div></div>
 <div><div class="muted small">Monthly budget tracked</div><div class="command-stat" id="freedom-budget">$0</div></div>
 <div><div class="muted small">Manual spending this month</div><div class="command-stat" id="freedom-spent">$0</div></div></div>
 <div class="command-grid"><div><h2 style="margin-top:16px">Add monthly bill</h2><form id="bill-form" class="command-form">
 <input id="bill-name" maxlength="160" placeholder="Rent, truck payment…" required>
 <div class="field-grid"><div><label class="field-label" for="bill-amount">Amount ($)</label><input id="bill-amount" type="number" min="0" step=".01" required></div>
 <div><label class="field-label" for="bill-day">Due day</label><input id="bill-day" type="number" min="1" max="31" value="1" required></div></div><button class="primary">Add bill</button></form>
 <h2 style="margin-top:16px">Monthly bills</h2><div id="bill-list"></div></div>
 <div><h2 style="margin-top:16px">Set category spending limit</h2><form id="budget-form" class="command-form">
 <select id="budget-category">${opt(['Housing','Utilities','Transportation','Food','Insurance','Debt payment','Shopping','Entertainment','Health','Other'])}</select>
 <label class="field-label" for="budget-limit">Monthly limit ($)</label><input id="budget-limit" type="number" min="0" step=".01" required>
 <button class="primary">Save limit</button></form><h2 style="margin-top:16px">Budgets vs manual spending</h2><div id="budget-list"></div></div></div>
 <p id="freedom-error" class="command-note" aria-live="polite"></p>`);
 $('bill-form').addEventListener('submit',e=>{e.preventDefault();try{
  add('bills',{text:$('bill-name').value.trim(),amount:fnum('bill-amount'),due_day:Number($('bill-day').value),paid_months:[]});
  $('bill-name').value='';$('freedom-error').textContent='';
 }catch(err){showError('freedom-error',err);}});
 $('budget-form').addEventListener('submit',e=>{e.preventDefault();try{
  const cat=$('budget-category').value,limit=fnum('budget-limit'),existing=state().budgets.find(b=>b.category===cat);
  if(existing){existing.limit=limit;api.save();api.render();}
  else add('budgets',{text:cat+' spending limit',category:cat,limit});
  $('freedom-error').textContent='';
 }catch(err){showError('freedom-error',err);}});
 card(fitness,`<div class="eyebrow">Discipline & fitness</div><h2>Consistency scorecard</h2>
 <div class="command-grid"><div><div class="muted small">Workout days · last 7</div><div class="command-stat" id="discipline-days">0 / 7</div></div>
 <div><div class="muted small">Consecutive workout days</div><div class="command-stat" id="discipline-streak">0</div></div>
 <div><div class="muted small">Scheduled routine completions · last 7</div><div class="command-stat" id="discipline-routines">0 / 0</div></div>
 <div><div class="muted small">Weekly workout target</div><div class="command-stat" id="discipline-target">0 / 4</div></div></div>
 <div id="discipline-days-list" class="quick-links"></div>
 <p class="muted small">Calculated from workouts and habits you log. It does not read activity trackers or verify workouts automatically.</p>
 <button class="secondary" type="button" data-command-page="goals">Set fitness goals</button>`);
 const goals=el('section');goals.id='goals';goals.className='panel';goals.innerHTML=`
 <div class="command-grid"><div class="command-card"><div class="eyebrow">Goals & accountability</div><h2>Add a measurable goal</h2>
 <form id="goal-form" class="command-form"><label class="field-label" for="goal-name">What do you want to achieve?</label>
 <input id="goal-name" maxlength="160" placeholder="e.g. $1M annual Curb Appeal revenue" required>
 <div class="field-grid"><div><label class="field-label" for="goal-area">Area</label><select id="goal-area">${opt(['Business','Personal','Fitness'])}</select></div>
 <div><label class="field-label" for="goal-unit">Measure</label><select id="goal-unit">${opt(['USD','Count','Percent'])}</select></div></div>
 <div class="field-grid"><div><label class="field-label" for="goal-current">Current</label><input id="goal-current" type="number" min="0" step=".01" value="0" required></div>
 <div><label class="field-label" for="goal-target">Target</label><input id="goal-target" type="number" min=".01" step=".01" placeholder="1000000" required></div></div>
 <label class="field-label" for="goal-deadline">Target date (optional)</label><input id="goal-deadline" type="date"><button class="primary">Create goal</button></form>
 <p id="goal-error" class="command-note" aria-live="polite"></p></div>
 <div class="command-card"><h2>Accountability snapshot</h2><div class="command-grid"><div><div class="muted small">Active goals</div><div class="command-stat" id="goals-count">0</div></div>
 <div><div class="muted small">Targets reached</div><div class="command-stat" id="goals-won">0</div></div></div>
 <p class="muted small">You control the current numbers. CEO OS does not assume that weekly sales equal annual revenue.</p></div></div>
 <div class="command-card"><h2>Your goals</h2><div id="goal-list"></div></div>`;
 const sales=el('section');sales.id='sales';sales.className='panel';sales.innerHTML=`
 <div class="command-grid"><div class="command-card"><div class="eyebrow">Sales & follow-up center</div><h2>Add an opportunity</h2>
 <form id="lead-form" class="command-form"><label class="field-label" for="lead-name">Customer / opportunity</label><input id="lead-name" maxlength="160" required placeholder="Customer name or project label">
 <label class="field-label" for="lead-service">Service</label><input id="lead-service" maxlength="100" value="House wash" required>
 <div class="field-grid"><div><label class="field-label" for="lead-value">Estimate ($)</label><input id="lead-value" type="number" min="0" step=".01" required></div>
 <div><label class="field-label" for="lead-stage">Stage</label><select id="lead-stage">${opt(['New','Contacted','Quoted','Won','Lost'])}</select></div></div>
 <label class="field-label" for="lead-follow-up">Follow-up date (optional)</label><input id="lead-follow-up" type="date">
 <label class="field-label" for="lead-notes">Notes (optional)</label><textarea id="lead-notes" maxlength="500" rows="3" placeholder="What needs to happen next?"></textarea>
 <button class="primary">Save opportunity</button></form><p id="sales-error" class="command-note" aria-live="polite"></p></div>
 <div class="command-card"><h2>Pipeline snapshot</h2><div class="command-grid"><div><div class="muted small">Open leads</div><div class="command-stat" id="sales-open">0</div></div>
 <div><div class="muted small">Open pipeline value</div><div class="command-stat" id="sales-value">$0</div></div>
 <div><div class="muted small">Won opportunities</div><div class="command-stat" id="sales-won">0</div></div>
 <div><div class="muted small">Follow-ups due</div><div class="command-stat" id="sales-due">0</div></div></div>
 <p class="muted small">Manual tracking only. No automatic contact with customers or CRM integration.</p></div></div>
 <div class="command-card"><h2>Follow-ups due now</h2><div id="sales-due-list"></div></div>
 <div class="command-card"><div class="row" style="flex-wrap:wrap"><h2 style="margin:0">Opportunity pipeline</h2><select id="sales-filter" style="max-width:175px"><option>All</option>${opt(['New','Contacted','Quoted','Won','Lost'])}</select></div>
 <div id="sales-lead-list"></div></div>`;
 main.append(goals,sales);
 $('goal-form').addEventListener('submit',e=>{e.preventDefault();try{
  const target=fnum('goal-target'),current=fnum('goal-current'),unit=$('goal-unit').value;
  if(target<=0||(unit==='Percent'&&(target>100||current>100)))throw Error('Enter a valid target.');
  add('goals',{text:$('goal-name').value.trim(),area:$('goal-area').value,unit,target,current,deadline:$('goal-deadline').value});
  $('goal-name').value='';$('goal-error').textContent='';
 }catch(err){showError('goal-error',err);}});
 $('lead-form').addEventListener('submit',e=>{e.preventDefault();try{
  add('leads',{text:$('lead-name').value.trim(),service:$('lead-service').value.trim(),stage:$('lead-stage').value,
    value:fnum('lead-value'),follow_up:$('lead-follow-up').value,notes:$('lead-notes').value.trim()});
  $('lead-name').value='';$('lead-notes').value='';$('sales-error').textContent='';
 }catch(err){showError('sales-error',err);}});
 $('sales-filter').addEventListener('change',renderSales);
 document.querySelectorAll('[data-command-page]').forEach(btn=>btn.addEventListener('click',()=>api.navigate(btn.dataset.commandPage)));
}
function renderBlocks(){
 const target=$('block-list');target.replaceChildren();const d=$('block-date').value||today();
 const blocks=state().time_blocks.filter(b=>b.date===d).slice().sort((a,b)=>a.start.localeCompare(b.start));
 $('block-count').textContent=blocks.length+' blocks · '+dateCheck(d);
 if(!blocks.length){empty(target,'No time blocks scheduled for this day.');return;}
 for(const [i,b] of blocks.entries()){
  const overlap=i>0&&blocks[i-1].end>b.start;
  itemRow(target,b.start+'–'+b.end+' · '+b.text,b.focus+(overlap?' · ⚠ Overlaps another block':''),
   [action('Remove',()=>remove('time_blocks',b.id))]);}
}
function renderGoals(){
 const arr=state().goals,target=$('goal-list');target.replaceChildren();
 $('goals-count').textContent=arr.length;$('goals-won').textContent=arr.filter(g=>g.current>=g.target).length;
 if(!arr.length)empty(target,'Set a business, personal or fitness target to begin.');
 for(const g of arr){const row=el('div',undefined,'command-item'),body=el('div');body.style.flex='1';
  const number=n=>g.unit==='USD'?money(n):g.unit==='Percent'?Number(n).toFixed(1)+'%':String(n);
  body.append(el('strong',g.text),el('div',g.area+' · '+number(g.current)+' of '+number(g.target)+(g.deadline?' · Due '+dateCheck(g.deadline):''),'command-muted'));
  progress(body,pct(g.current,g.target));
  const controls=el('div',undefined,'command-actions');
  controls.append(action('Update',()=>{const val=window.prompt('Current progress for '+g.text+' ('+g.unit+')',String(g.current));
    if(val===null)return;const n=Number(val);if(!Number.isFinite(n)||n<0||n>1e9||(g.unit==='Percent'&&n>100))return window.alert('Enter a valid number.');
    g.current=Math.round(n*100)/100;api.save();api.render();}),action('Remove',()=>{if(confirm('Remove this goal?'))remove('goals',g.id);}));
  row.append(body,controls);target.append(row);
 }
 const revenueGoal=arr.find(g=>g.area==='Business'&&g.unit==='USD'&&/revenue/i.test(g.text));
 const progressContainer=$('biz-goal-progress');progressContainer.replaceChildren();
 if(revenueGoal){progressContainer.append(el('strong','Business revenue goal: '+money(revenueGoal.current)+' / '+money(revenueGoal.target)));
  progress(progressContainer,pct(revenueGoal.current,revenueGoal.target));}
 else progressContainer.append(el('span','No business revenue goal entered yet. Create one in Goals.','muted small'));
}
function renderSales(){
 const arr=state().leads,open=arr.filter(l=>!['Won','Lost'].includes(l.stage)),won=arr.filter(l=>l.stage==='Won');
 const due=open.filter(l=>l.follow_up&&l.follow_up<=today()),quoted=arr.filter(l=>['Quoted','Won','Lost'].includes(l.stage));
 const quoteValue=open.filter(l=>l.stage==='Quoted').reduce((s,l)=>s+l.value,0);
 const pipelineValue=open.reduce((s,l)=>s+l.value,0),closeRate=quoted.length?Math.round(won.length/quoted.length*100)+'%':'—';
 $('sales-open').textContent=open.length;$('sales-value').textContent=money(pipelineValue);
 $('sales-won').textContent=won.length;$('sales-due').textContent=due.length;
 $('biz-open').textContent=open.length;$('biz-value').textContent=money(quoteValue);
 $('biz-close').textContent=closeRate;$('biz-followups').textContent=due.length;
 const followups=$('sales-due-list');followups.replaceChildren();
 if(!due.length)empty(followups,'No overdue or due-today follow-ups.');
 for(const l of due.slice().sort((a,b)=>a.follow_up.localeCompare(b.follow_up))){
  itemRow(followups,l.text,l.service+' · Due '+dateCheck(l.follow_up)+' · '+l.stage,[action('Open',()=>{api.navigate('sales');$('sales-filter').value='All';renderSales();})]);
 }
 const list=$('sales-lead-list');list.replaceChildren();const filter=$('sales-filter').value;
 const view=arr.filter(l=>filter==='All'||l.stage===filter).slice().sort((a,b)=>(a.follow_up||'9999').localeCompare(b.follow_up||'9999'));
 if(!view.length)empty(list,'No opportunities in this stage.');
 for(const l of view){
  const actions=[];
  if(!['Won','Lost'].includes(l.stage))actions.push(action('Next stage',()=>{
   const stages=['New','Contacted','Quoted','Won'];const i=stages.indexOf(l.stage);l.stage=stages[Math.min(stages.length-1,i+1)];api.save();api.render();
  }));
  actions.push(action('Edit',()=>{const date=prompt('New follow-up date (YYYY-MM-DD, or blank)',l.follow_up||'');
   if(date===null)return;
   if(date&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))return alert('Enter YYYY-MM-DD');
   if(date&&Number.isNaN(new Date(date+'T12:00:00').getTime()))return alert('Enter a valid date');
   const stage=prompt('Stage: New, Contacted, Quoted, Won, Lost',l.stage);
   if(stage===null)return;
   if(!['New','Contacted','Quoted','Won','Lost'].includes(stage))return alert('Invalid stage');
   l.follow_up=date;l.stage=stage;api.save();api.render();
  }));
  actions.push(action('Remove',()=>{if(confirm('Remove this opportunity?'))remove('leads',l.id);}));
  itemRow(list,l.text,money(l.value)+' · '+l.stage+' · '+l.service+
    (l.follow_up?' · Follow up '+dateCheck(l.follow_up):'')+(l.notes?' · '+l.notes:''),actions);
 }
}
function renderFinanceFreedom(){
 const bills=state().bills,budgets=state().budgets,entries=state().money_entries,period=month();
 const total=bills.reduce((s,b)=>s+b.amount,0),paid=bills.filter(b=>(b.paid_months||[]).includes(period));
 $('freedom-bills-total').textContent=money(total);
 $('freedom-bills-paid').textContent=paid.length+' / '+bills.length;
 $('freedom-budget').textContent=money(budgets.reduce((s,b)=>s+b.limit,0));
 $('freedom-spent').textContent=money(entries.filter(e=>e.direction==='Expense'&&e.date?.startsWith(period)).reduce((s,e)=>s+e.amount,0));
 const billList=$('bill-list');billList.replaceChildren();if(!bills.length)empty(billList,'No monthly bills entered.');
 for(const b of bills.slice().sort((a,z)=>a.due_day-z.due_day)){
  const isPaid=(b.paid_months||[]).includes(period);
  itemRow(billList,b.text+' · '+money(b.amount),'Monthly due day '+b.due_day+' · '+(isPaid?'Paid this month':'Not marked paid'),
  [action(isPaid?'Undo paid':'Mark paid',()=>{const months=new Set(b.paid_months||[]);
   if(isPaid)months.delete(period);else months.add(period);
   b.paid_months=Array.from(months).sort().slice(-24);api.save();api.render();
  }),action('Remove',()=>remove('bills',b.id))]);}
 const budgetList=$('budget-list');budgetList.replaceChildren();if(!budgets.length)empty(budgetList,'No category spending limits yet.');
 for(const b of budgets){
  const used=entries.filter(e=>e.direction==='Expense'&&e.category===b.category&&e.date?.startsWith(period)).reduce((s,e)=>s+e.amount,0);
  const div=el('div',undefined,'command-item'),body=el('div');body.style.flex='1';
  body.append(el('strong',b.category),el('div',money(used)+' / '+money(b.limit)+(used>b.limit?' · Over limit':''),'command-muted'));
  progress(body,pct(used,b.limit));div.append(body,action('Remove',()=>remove('budgets',b.id)));budgetList.append(div);
 }
}
function renderDiscipline(){
 const d=new Date(),days=[],routines=state().routines,workouts=state().workouts;
 const workoutDays=new Set(workouts.map(w=>api.localDate(new Date(w.when))));
 let completed=0,scheduled=0;
 const marker=$('discipline-days-list');marker.replaceChildren();
 for(let i=6;i>=0;i--){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()-i),day=api.localDate(x);
  days.push(day);const needed=routines.filter(r=>Array.isArray(r.days)&&r.days.includes(x.getDay()));
  scheduled+=needed.length;completed+=needed.filter(r=>(r.completed||[]).includes(day)).length;
  const tag=el('span',(x.toLocaleDateString(undefined,{weekday:'short'}))+' '+(workoutDays.has(day)?'✓':'○'),'routine-tag');marker.append(tag);
 }
 let streak=0,day=new Date(d.getFullYear(),d.getMonth(),d.getDate());
 if(!workoutDays.has(api.localDate(day)))day.setDate(day.getDate()-1);
 while(streak<250&&workoutDays.has(api.localDate(day))){streak++;day.setDate(day.getDate()-1);}
 $('discipline-days').textContent=days.filter(day=>workoutDays.has(day)).length+' / 7';
 $('discipline-streak').textContent=streak;
 $('discipline-routines').textContent=completed+' / '+scheduled;
 const monday=new Date(d.getFullYear(),d.getMonth(),d.getDate()-((d.getDay()+6)%7));
 const count=workouts.filter(w=>w.when>=monday.getTime()).length;
 $('discipline-target').textContent=count+' / '+(state().fitness_goals[0]?.target||4);
}
function render(){
 if(!$('goal-list'))return;
 renderBlocks();renderGoals();renderSales();renderFinanceFreedom();renderDiscipline();
}
initialize();
window.ceoOSFeatures={render};
$('block-date').addEventListener('change',renderBlocks);
render();
if(location.hash==='#sales'||location.hash==='#goals')api.navigate(location.hash.slice(1));
})();