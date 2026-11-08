/* Daily briefing and weekly CEO review. No Plaid or external write access. */
(()=>{'use strict';
const api=window.ceoOSBridge;if(!api)return;
const $=id=>document.getElementById(id);
const state=()=>api.getState();
const local=d=>api.localDate(d);
const today=()=>api.today();
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
const compact=d=>new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
function weekStart(d=new Date()){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-(x.getDay()+6)%7);return local(x);}
function plusDays(day,n){const x=new Date(day+'T12:00:00');x.setDate(x.getDate()+n);return local(x);}
function dueDate(year,month,day){return local(new Date(year,month,Math.min(day,new Date(year,month+1,0).getDate())));}
function upcomingBills(bills,day){
 const current=new Date(day+'T12:00:00'),results=[];
 for(const bill of bills){
   for(let offset=0;offset<=1;offset++){
     const year=current.getFullYear(),m=current.getMonth()+offset;
     const when=dueDate(year,m,bill.due_day),period=when.slice(0,7);
     if(when>=day&&when<=plusDays(day,7)&&!(bill.paid_months||[]).includes(period)){
       results.push({bill,when});break;
     }
   }
 }
 return results.sort((a,b)=>a.when.localeCompare(b.when));
}
const node=(tag,text,className)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(className)x.className=className;return x;};
function row(target,title,detail,actionLabel,onAction){
 const line=node('div',undefined,'command-item'),info=node('div');
 info.append(node('strong',title),node('div',detail,'command-muted'));line.append(info);
 if(actionLabel){const button=node('button',actionLabel,'secondary');button.type='button';button.addEventListener('click',onAction);line.append(button);}
 target.append(line);
}
function empty(target,message){target.append(node('p',message,'muted small'));}
function metric(target,value){$(target).textContent=String(value);}
function panel(container,markup){const div=node('div');div.className='command-card';div.innerHTML=markup;container.append(div);return div;}
const home=$('home');
const briefing=panel(home,`<div class="row"><div><div class="eyebrow">CEO morning briefing</div><h2 style="margin:5px 0">Your next moves</h2></div><span class="muted small" id="morning-date"></span></div>
 <div class="command-grid">
 <div><div class="muted small">Open priorities due</div><div class="command-stat" id="morning-priority-count">0</div></div>
 <div><div class="muted small">Sales follow-ups due</div><div class="command-stat" id="morning-lead-count">0</div></div>
 <div><div class="muted small">Bills due within 7 days</div><div class="command-stat" id="morning-bill-count">0</div></div>
 <div><div class="muted small">Workouts logged this week</div><div class="command-stat" id="morning-workouts">0 / 4</div></div>
 </div>
 <div class="command-grid">
 <div><h2 class="section" style="margin:16px 0 8px">Top priorities</h2><div id="morning-priorities"></div></div>
 <div><h2 class="section" style="margin:16px 0 8px">Follow-ups requiring action</h2><div id="morning-leads"></div></div>
 <div><h2 class="section" style="margin:16px 0 8px">Upcoming bills</h2><div id="morning-bills"></div></div>
 <div><h2 class="section" style="margin:16px 0 8px">Today's schedule</h2><div id="morning-schedule"></div></div></div>
 <div class="row" style="margin-top:12px"><button type="button" class="secondary" id="morning-open-review">Weekly CEO review</button>
 <span class="muted small">Calendar read-only · Bill and lead data manually entered</span></div>`);
home.insertBefore(briefing,home.firstElementChild);
const review=panel(home,`<div class="eyebrow">Weekly CEO review</div><div class="row"><h2 style="margin:5px 0">Review, learn, plan</h2><span class="muted small" id="review-dates"></span></div>
 <p class="muted small">A Sunday review for the Monday–Sunday week. Historical KPI figures are labeled by their saved week; they're not automatically today's revenue.</p>
 <div class="command-grid">
 <div><div class="muted small">Workout sessions · this week</div><div class="command-stat" id="review-workouts">0</div></div>
 <div><div class="muted small">Priorities due this week completed</div><div class="command-stat" id="review-tasks">0 / 0</div></div>
 <div><div class="muted small">Won leads · all-time tracked</div><div class="command-stat" id="review-won">0</div></div>
 <div><div class="muted small">Latest saved KPI week revenue</div><div class="command-stat" id="review-revenue">—</div><div class="command-muted" id="review-revenue-date">Unavailable</div></div>
 </div>
 <form id="weekly-review-form" class="command-form" style="margin-top:16px">
 <label for="review-wins">What went well this week?</label><textarea id="review-wins" rows="2" maxlength="500" placeholder="A win worth repeating"></textarea>
 <label for="review-improve">What should improve next week?</label><textarea id="review-improve" rows="2" maxlength="500" placeholder="One lesson or obstacle"></textarea>
 <label for="review-focus">Next week's main priority</label><textarea id="review-focus" rows="2" maxlength="500" placeholder="Your highest-leverage move"></textarea>
 <h2 style="margin:8px 0 0">Next week's targets</h2>
 <div class="field-grid">
  <div><label for="review-revenue-target" class="field-label">Revenue ($) · manual target</label><input id="review-revenue-target" type="number" min="0" max="1000000000" step=".01" value="0"></div>
  <div><label for="review-outreach-target" class="field-label">Sales outreach · contacts</label><input id="review-outreach-target" type="number" min="0" max="10000" step="1" value="0"></div>
 </div>
 <label for="review-workouts-target" class="field-label">Workout sessions</label><input id="review-workouts-target" type="number" min="0" max="10000" step="1" value="4">
 <button type="submit" class="primary">Save weekly review</button>
 <p id="review-save-status" class="command-note" aria-live="polite"></p></form>
 <div id="review-last-save" class="muted small"></div>`);
home.insertBefore(review,briefing.nextSibling);
const focusDate=()=>today();
const reviewWeek=()=>weekStart();
function renderMorning(){
 const date=focusDate(),s=state(),d=new Date(date+'T12:00:00');
 metric('morning-date',d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}));
 const priorities=s.tasks.filter(t=>!t.done&&(!t.due||t.due<=date)).sort((a,b)=>(a.priority==='top'?0:1)-(b.priority==='top'?0:1)||(a.due||'9999').localeCompare(b.due||'9999'));
 const leads=s.leads.filter(l=>!['Won','Lost'].includes(l.stage)&&l.follow_up&&l.follow_up<=date).sort((a,b)=>a.follow_up.localeCompare(b.follow_up));
 const bills=upcomingBills(s.bills,date);
 const monday=weekStart();
 const workouts=s.workouts.filter(w=>w.when>=new Date(monday+'T00:00:00').getTime()).length;
 metric('morning-priority-count',priorities.length);metric('morning-lead-count',leads.length);
 metric('morning-bill-count',bills.length);
 metric('morning-workouts',workouts+' / '+(s.fitness_goals[0]?.target||4));
 const p=$('morning-priorities');p.replaceChildren();
 if(!priorities.length)empty(p,'Nothing due. Add a priority in Today.');
 for(const t of priorities.slice(0,4))row(p,t.text,(t.priority==='top'?'Top priority · ':'')+(t.due?'Due '+compact(t.due):'No deadline'),'Today',()=>api.navigate('planner'));
 const l=$('morning-leads');l.replaceChildren();
 if(!leads.length)empty(l,'No overdue or due-today sales follow-ups.');
 for(const lead of leads.slice(0,4))row(l,lead.text,lead.stage+' · Due '+compact(lead.follow_up),'Sales',()=>api.navigate('sales'));
 const b=$('morning-bills');b.replaceChildren();
 if(!bills.length)empty(b,'No unpaid bills due in the next seven days.');
 for(const {bill,when} of bills.slice(0,4))row(b,bill.text,money(bill.amount)+' · Due '+compact(when),'Finance',()=>api.navigate('finance'));
 const a=$('morning-schedule');a.replaceChildren();
 const blocks=s.time_blocks.filter(x=>x.date===date).sort((x,y)=>x.start.localeCompare(y.start));
 const cal=api.getCalendar(),events=cal.events.filter(e=>e.start&&e.end&&e.start.slice(0,10)<=date&&(e.end.slice(0,10)>date||(!e.all_day&&e.end.slice(0,10)===date)));
 const activities=[
  ...blocks.map(x=>({sort:x.start,label:x.text,detail:x.start+'–'+x.end+' · CEO OS block'})),
  ...events.map(e=>({sort:e.all_day?'00:00':new Date(e.start).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false}),label:e.title,detail:e.all_day?'All day · Google Calendar':'Google Calendar · read-only'}))
 ].sort((x,y)=>x.sort.localeCompare(y.sort));
 if(!activities.length)empty(a,cal.status==='connected'?'No appointments or time blocks today.': 'No saved time blocks. Calendar may be unavailable.');
 for(const task of activities.slice(0,6))row(a,task.label,task.detail);
}
function reviewData(){return state().weekly_reviews.find(r=>r.week_start===reviewWeek());}
let dirtyReview=false;
function populateReview(){
 const r=reviewData();
 $('review-wins').value=r?.wins||'';$('review-improve').value=r?.improve||'';$('review-focus').value=r?.next_focus||'';
 $('review-revenue-target').value=r?.targets?.revenue??0;$('review-outreach-target').value=r?.targets?.outreach??0;
 $('review-workouts-target').value=r?.targets?.workouts??(state().fitness_goals[0]?.target||4);
 $('review-last-save').textContent=r?'Review saved for the week beginning '+compact(r.week_start):'No review saved for this week yet.';
 dirtyReview=false;
}
function renderReview(){
 const monday=reviewWeek(),end=plusDays(monday,6),s=state();
 metric('review-dates',compact(monday)+' – '+compact(end));
 const sessions=s.workouts.filter(w=>w.when>=new Date(monday+'T00:00:00').getTime()&&w.when<new Date(plusDays(end,1)+'T00:00:00').getTime()).length;
 const due=s.tasks.filter(t=>t.due&&t.due>=monday&&t.due<=end);
 metric('review-workouts',sessions);metric('review-tasks',due.filter(t=>t.done).length+' / '+due.length);
 metric('review-won',s.leads.filter(l=>l.stage==='Won').length);
 const latest=api.getKpi();
 metric('review-revenue',latest?.revenue==null?'—':money(latest.revenue));
 metric('review-revenue-date',latest?.week_ending?'Saved KPI week ending '+latest.week_ending:'KPI source unavailable');
 if(!dirtyReview)populateReview();
}
function render(){renderMorning();renderReview();}
$('morning-open-review').addEventListener('click',()=>review.scrollIntoView({behavior:'smooth',block:'start'}));
for(const id of ['review-wins','review-improve','review-focus','review-revenue-target','review-outreach-target','review-workouts-target'])
 $(id).addEventListener('input',()=>{dirtyReview=true;});
$('weekly-review-form').addEventListener('submit',e=>{
 e.preventDefault();
 const fields=['revenue','outreach','workouts'];
 const ids=['review-revenue-target','review-outreach-target','review-workouts-target'];
 const values=ids.map(id=>Number($(id).value));
 if(values.some(n=>!Number.isFinite(n)||n<0||n>1e9)||values[1]>10000||values[2]>10000||!Number.isInteger(values[1])||!Number.isInteger(values[2])){
   $('review-save-status').textContent='Enter nonnegative revenue and whole-number outreach/workout targets.';return;
 }
 const targets=Object.fromEntries(fields.map((f,i)=>[f,values[i]]));
 const data={text:'CEO weekly review',week_start:reviewWeek(),wins:$('review-wins').value.trim(),
  improve:$('review-improve').value.trim(),next_focus:$('review-focus').value.trim(),targets};
 const old=reviewData();
 if(!old&&state().weekly_reviews.length>=250){
  $('review-save-status').textContent='Maximum review history reached.';return;
 }
 if(old)Object.assign(old,data);
 else state().weekly_reviews.unshift({id:'weekly-'+data.week_start,when:Date.now(),done:false,...data});
 dirtyReview=false;api.save();api.render();
 $('review-save-status').textContent=api.cloudReady()?'Review saved. Cloud sync requested.':'Saved on this device only until cloud reconnects; review details are not retained offline.';
});
window.ceoOSMorning={render};
render();
})();