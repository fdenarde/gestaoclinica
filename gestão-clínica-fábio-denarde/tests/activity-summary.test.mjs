import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivitySummaryPlan, buildAccumulatedActivitySummary, getAccumulatedActivitySummaryLimitSessionId,
  validateActivitySummaryDraft, completeActivitySummary } from '../shared/activitySummary.js';
import { buildPackageTimeline } from '../shared/neuroFlowState.js';
const session=(n,extra={})=>({id:`s${n}`,patientId:'synthetic',date:`2026-08-${String(n*6).padStart(2,'0')}`,time:'08:00',
  status:'Realizada',consumesPackage:true,activitySessionNumber:n,activityPackageNumber:1,packageNumber:n,...extra});
const card=(n,extra={})=>({id:`c${n}`,patientId:'synthetic',packageNumber:1,sessionIds:[`s${n}`],status:'active',visibleToGuardian:true,url:'',observation:'',...extra});
const link=n=>card(n,{url:`https://photos.app.goo.gl/fixture${n}`});
const justification=(reason='',note='')=>({justification:{active:true,reason,note}});
const plan=extra=>buildActivitySummaryPlan({patientId:'synthetic',patientName:'Pessoa fictícia',packageNumber:1,throughSessionId:'s3',sessions:[session(1),session(2),session(3)],albums:[link(1),link(2),link(3)],...extra});

test('links válidos: todas as datas, ordem cronológica crescente, sem observação obrigatória',()=>{
  const p=plan();assert.equal(p.pending.length,0);
  assert.equal(p.summary,'*Segue abaixo o Registro das atividades - Pessoa fictícia*\n\n*Sessão 1*\n_06/08/2026 às 08:00_\nhttps://photos.app.goo.gl/fixture1\n\n*Sessão 2*\n_12/08/2026 às 08:00_\nhttps://photos.app.goo.gl/fixture2\n\n*Sessão 3*\n_18/08/2026 às 08:00_\nhttps://photos.app.goo.gl/fixture3');
});

test('sem link + observação compartilhável basta, sem código e sem motivo duplicado',()=>{
  const p=plan({albums:[link(1),card(2,{observation:'Não foi possível realizar registro fotográfico nesta sessão.'}),link(3)]});
  assert.equal(p.pending.length,0);assert.match(p.summary,/Não foi possível realizar registro fotográfico nesta sessão\./);
  assert.doesNotMatch(p.summary,/Motivo:|Observação:|Ausência/);
});

test('justificativa ativa com nota existente é reconhecida mesmo sem reason válido',()=>{
  const p=plan({albums:[link(1),card(2,{visibleToGuardian:false}),link(3)],statusBySession:{s2:justification('', 'Explicação fictícia pública')}});
  assert.equal(p.pending.length,0);assert.match(p.summary,/Explicação fictícia pública/);
});

test('mídia + sem mídia + ausência: nenhuma data omitida e ausência não depende de álbum',()=>{
  const p=plan({albums:[link(1),card(2,{observation:'Sem foto nesta sessão fictícia.'}),card(3,{visibleToGuardian:false})],
    sessions:[session(1),session(2),session(3,{status:'Falta',noReplacementReasonCode:'other',noReplacementObservation:'Reposição combinada fictícia.'})]});
  assert.equal(p.entries.length,3);assert.equal(p.pending.length,0);
  assert.match(p.summary,/Sem foto nesta sessão fictícia\./);
  assert.match(p.summary,/Ausência - Reposição combinada fictícia\./);
});

for(const[name,extra]of[
 ['sem observação',{albums:[link(1),card(2),link(3)]}],
 ['só whitespace',{albums:[link(1),card(2,{observation:'   '}),link(3)]}],
 ['apenas motivo de mídia sem nota',{albums:[link(1),card(2),link(3)],statusBySession:{s2:justification('technical_issue')}}],
 ['justificativa inativa',{albums:[link(1),card(2),link(3)],statusBySession:{s2:{justification:{active:false,reason:'other',note:'Nota removida fictícia'}}}}],
 ['link inválido e sem observação',{albums:[link(1),card(2,{url:'http://photos.app.goo.gl/unsafe'}),link(3)]}],
])test(`${name}: pendente e bloqueia o resumo inteiro`,()=>{
  const p=plan(extra);assert.equal(p.summary,'');assert.deepEqual(p.pending.map(e=>e.sessionId),['s2']);assert.match(p.pending[0].problem,/motivo \/ observação/);
});

test('Somente equipe e notas clínicas nunca satisfazem o resumo externo nem são pré-carregadas',()=>{
  const p=plan({albums:[link(1),card(2,{visibleToGuardian:false,url:'https://photos.app.goo.gl/private',observation:'Nota privada fictícia'}),link(3)],
    sessions:[session(1),session(2,{privateNotes:'Nota clínica fictícia'}),session(3)]});
  assert.equal(p.summary,'');assert.equal(p.pending[0].note,'');assert.equal(p.pending[0].url,'');
  assert.equal(p.pending[0].teamOnlyObservation,'Nota privada fictícia');assert.equal(p.pending[0].blocked,false);
  assert.equal(validateActivitySummaryDraft(p.pending[0],{note:'Explicação nova, explicitamente compartilhável.'}),'');
});

test('conteúdo privado do card não invalida ausência canônica ou justificativa independente',()=>{
  for(const extra of [
    {sessions:[session(1),session(2,{status:'Falta',noReplacementReasonCode:'health_issue'}),session(3)]},
    {statusBySession:{s2:justification('other','Nota compartilhável fictícia')}}]){
    const p=plan({...extra,albums:[link(1),card(2,{visibleToGuardian:false,observation:'Nota privada fictícia'}),link(3)]});
    assert.equal(p.pending.length,0);assert.doesNotMatch(p.summary,/Nota privada fictícia/);
  }
});

test('ausência com motivo canônico válido dispensa nota duplicada; observação disponível prevalece',()=>{
  for(const extra of [{noReplacementReasonCode:'health_issue'}, {noReplacementReasonText:'Problema de saúde'},
    {noReplacementReasonCode:'other',noReplacementObservation:'Nota da ausência fictícia'}]){
    const p=plan({sessions:[session(1),session(2,{status:'Falta',...extra}),session(3)],albums:[link(1),card(2),link(3)]});
    assert.equal(p.pending.length,0);assert.match(p.summary,/Ausência - (Problema de saúde|Nota da ausência fictícia)/);
  }
});

test('ausência sem código mas com observação é completa; sem nenhuma explicação é pendente',()=>{
  for(const note of ['Nota canônica fictícia','']){
    const p=plan({sessions:[session(1),session(2,{status:'Falta',noReplacementObservation:note}),session(3)],albums:[link(1),card(2),link(3)]});
    assert.equal(p.pending.length,note?0:1);
  }
});

test('legado: nota ativa explica sem mídia e não converte automaticamente em ausência',()=>{
  const p=plan({albums:[link(1),card(2),link(3)],statusBySession:{s2:justification('problema técnico','Nota legada fictícia')}});
  assert.match(p.summary,/Nota legada fictícia/);assert.doesNotMatch(p.summary,/Ausência/);
});

test('cutoff/paciente/pacote/dedup permanecem isolados, inclusive com álbum agrupado',()=>{
  const p=plan({sessions:[session(3),session(1),session(2),session(2),session(4),session(0,{id:'other',patientId:'other'}),session(0,{id:'other-package',activityPackageNumber:2})],
    albums:[link(1),{...link(2),sessionIds:['s2','s3']},link(3),link(4),link(2)]});
  assert.deepEqual(p.entries.map(e=>e.sessionId),['s1','s2','s3']);assert.equal((p.summary.match(/Sessão 2/g)||[]).length,1);
  assert.equal(getAccumulatedActivitySummaryLimitSessionId({card:{sessionIds:['s3','s1']},sessions:[session(3),session(1)]}),'s3');
  assert.equal(buildAccumulatedActivitySummary({patientId:'synthetic',throughSessionId:'missing',sessions:[session(1)]}),'');
});

test('pipeline real de numeração do pacote mantém ausência e todas as 10 datas',()=>{
  const raw=Array.from({length:11},(_,i)=>session(i+1,{date:`2026-${String(1+Math.floor(i/4)).padStart(2,'0')}-${String(i%4+1).padStart(2,'0')}`,activityPackageNumber:undefined,activitySessionNumber:undefined,consumesPackage:true}));
  raw[1]={...raw[1],status:'Falta',noReplacementObservation:'Ausência fictícia'};
  const p=plan({sessions:buildPackageTimeline(raw,'synthetic',1),throughSessionId:'s10',albums:Array.from({length:10},(_,i)=>link(i+1))});
  assert.equal(p.entries.length,10);assert.match(p.summary,/Ausência - Ausência fictícia/);assert.doesNotMatch(p.summary,/Sessão 11/);
});

function completionFixture(){
  const input={albums:[card(1),card(2),link(3)],statusBySession:{}};const writes=[],copies=[],saved=[];
  const config={plan:plan(input),drafts:{s1:{note:'Primeira nota fictícia'},s2:{note:'Segunda nota fictícia'}},isCurrent:()=>true,onSaved:id=>saved.push(id),
    saveEntry:async(e,d)=>{writes.push({id:e.sessionId,...d});input.statusBySession[e.sessionId]=justification(d.reasonCode,d.note);return true;},
    revalidate:()=>plan(input),copy:async text=>copies.push(text)};
  return{config,input,writes,copies,saved};
}

test('sem nota valida todas antes de escrever; zero clipboard/escritas',async()=>{
  const f=completionFixture();f.config.drafts.s2.note='';const r=await completeActivitySummary(f.config);
  assert.equal(r.ok,false);assert.equal(r.sessionId,'s2');assert.deepEqual(f.writes,[]);assert.deepEqual(f.copies,[]);
});

test('somente textarea: writers confirmados, revalidação completa antes de cópia única',async()=>{
  const f=completionFixture();assert.equal((await completeActivitySummary(f.config)).ok,true);
  assert.deepEqual(f.writes.map(w=>w.id),['s1','s2']);assert.ok(f.writes.every(w=>w.reasonCode==='other'));
  assert.equal(f.copies.length,1);assert.match(f.copies[0],/Sessão 1[\s\S]*Sessão 2[\s\S]*Sessão 3/);
});

test('falha parcial preserva sucesso anterior e nova tentativa só salva pendente',async()=>{
  const f=completionFixture(),save=f.config.saveEntry;f.config.saveEntry=async(e,d)=>{if(e.sessionId==='s2')throw Error('Synthetic');return save(e,d);};
  assert.equal((await completeActivitySummary(f.config)).sessionId,'s2');assert.deepEqual(f.saved,['s1']);assert.deepEqual(f.copies,[]);
  f.config.plan=plan(f.input);f.config.saveEntry=save;assert.equal((await completeActivitySummary(f.config)).ok,true);assert.deepEqual(f.writes.map(w=>w.id),['s1','s2']);
});

test('writer false ou revalidação incompleta impede clipboard',async()=>{
  for(const change of [f=>f.config.saveEntry=async()=>false,f=>f.config.revalidate=()=>f.config.plan]){const f=completionFixture();change(f);assert.equal((await completeActivitySummary(f.config)).ok,false);assert.deepEqual(f.copies,[]);}
});

test('contexto alterado durante persistência interrompe próximo writer e clipboard',async()=>{
  const f=completionFixture();let active=true;f.config.isCurrent=()=>active;const save=f.config.saveEntry;
  f.config.saveEntry=async(e,d)=>{const r=await save(e,d);active=false;return r;};
  assert.equal((await completeActivitySummary(f.config)).ok,false);assert.equal(f.writes.length,1);assert.deepEqual(f.copies,[]);
});

test('ausência pendente sem fonte local editável continua protegida, sem writer improvisado',()=>{
  const p=plan({sessions:[session(1),session(2,{status:'Falta'}),session(3)],albums:[link(1),card(2),link(3)],writableAbsenceSessionIds:[]});
  assert.equal(p.pending[0].blocked,true);assert.match(p.pending[0].problem,/fonte canônica local/);
});

test('motivo canônico já registrado em reasonText é reconhecido sem exigir catálogo ou nova observação',()=>{
  const p=plan({sessions:[session(1),session(2,{status:'Falta',noReplacementReasonText:'Ausência previamente acordada fictícia.'}),session(3)],
    albums:[link(1),card(2,{visibleToGuardian:false,observation:'Nota interna fictícia'}),link(3)]});
  assert.equal(p.pending.length,0);assert.match(p.summary,/Ausência - Ausência previamente acordada fictícia\./);
  assert.doesNotMatch(p.summary,/Nota interna fictícia/);
});

test('formato exato: link sem Fotos e preservado como cadastrado, com nome, número, data e horário',()=>{
  const url='https://PHOTOS.app.goo.gl/Fixture%7e123?x=%2f&y=2#Original';
  const p=plan({throughSessionId:'s1',albums:[card(1,{url})]});
  assert.equal(p.summary,`*Segue abaixo o Registro das atividades - Pessoa fictícia*\n\n*Sessão 1*\n_06/08/2026 às 08:00_\n${url}`);
  assert.doesNotMatch(p.summary,/Fotos:/);
});

test('formato exato: ausência com observação, sem Sem mídia/Falta/Ausência registrada e sem alterar status',()=>{
  const absence=Object.freeze(session(1,{status:'Falta',noReplacementObservation:'Reposição fragmentada com 25 min de acréscimo nas sessões futuras'}));
  const p=plan({sessions:[absence],throughSessionId:'s1',albums:[card(1)]});
  assert.equal(p.summary,'*Segue abaixo o Registro das atividades - Pessoa fictícia*\n\n*Sessão 1*\n_06/08/2026 às 08:00_\nAusência - Reposição fragmentada com 25 min de acréscimo nas sessões futuras');
  assert.doesNotMatch(p.summary,/Sem mídia|Falta|Ausência registrada|Fotos:/);assert.equal(absence.status,'Falta');
});

test('formato exato misto: ordem crescente, links sem prefixo e observação normal sem texto inventado',()=>{
  const p=plan({sessions:[session(3),session(1),session(2,{status:'Falta',noReplacementObservation:'Reposição fictícia combinada.'})],
    albums:[link(1),card(2),card(3,{observation:'Não foi possível realizar registro fotográfico nesta sessão.'})]});
  assert.equal(p.summary,'*Segue abaixo o Registro das atividades - Pessoa fictícia*\n\n*Sessão 1*\n_06/08/2026 às 08:00_\nhttps://photos.app.goo.gl/fixture1\n\n*Sessão 2*\n_12/08/2026 às 08:00_\nAusência - Reposição fictícia combinada.\n\n*Sessão 3*\n_18/08/2026 às 08:00_\nNão foi possível realizar registro fotográfico nesta sessão.');
  assert.doesNotMatch(p.summary,/Fotos:|Sem mídia|Falta|Ausência registrada|Somente equipe|synthetic|s1/);
});

test('somente apresentação: remove introdução redundante da ausência e troca Falta sem mudar nota canônica',()=>{
  const note='Ausência registrada nesta data. Falta do profissional; reposição fictícia acordada.';
  const absence=session(1,{status:'Falta',noReplacementObservation:note});
  const p=plan({sessions:[absence],throughSessionId:'s1',albums:[card(1)]});
  assert.equal(p.summary,'*Segue abaixo o Registro das atividades - Pessoa fictícia*\n\n*Sessão 1*\n_06/08/2026 às 08:00_\nAusência - Ausência do profissional; reposição fictícia acordada.');
  assert.equal(absence.noReplacementObservation,note);assert.equal(absence.status,'Falta');
  const normal=plan({throughSessionId:'s1',albums:[card(1,{observation:'Falta de oportunidade de registro.'})]});
  assert.match(normal.summary,/Falta de oportunidade de registro\./);
});

test('sem link e sem observação: resumo inteiro continua vazio e sessão permanece no modal',()=>{
  const p=plan({albums:[link(1),card(2),link(3)]});
  assert.equal(p.summary,'');assert.deepEqual(p.pending.map(e=>e.sessionId),['s2']);
});

test('rótulos antigos dentro da observação não duplicam o rótulo externo de ausência',()=>{
  for(const note of ['Sem mídia - Ausência registrada nesta data. Reposição fictícia combinada.', 'Ausência registrada - Reposição fictícia combinada.', 'Falta - Reposição fictícia combinada.']){
    const p=plan({sessions:[session(1,{status:'Falta',noReplacementObservation:note})],throughSessionId:'s1',albums:[card(1)]});
    assert.equal(p.summary,'*Segue abaixo o Registro das atividades - Pessoa fictícia*\n\n*Sessão 1*\n_06/08/2026 às 08:00_\nAusência - Reposição fictícia combinada.');
    assert.doesNotMatch(p.summary,/Sem mídia|Falta|Ausência registrada/);
  }
});

test('R5: ocorrência não contabilizada sai antes da numeração; próxima contabilizada recebe número contínuo',()=>{
  const raw=[
    session(1),
    session(2,{status:'Falta',consumesPackage:false,noReplacementObservation:'Texto livre diz contabilizada, mas decisão canônica é não.'}),
    session(3,{status:'Falta',consumesPackage:true,noReplacementObservation:'Reposição fictícia combinada.'}),
    session(4,{status:'Realizada',consumesPackage:false}),
  ];
  const sessions=buildPackageTimeline(raw,'synthetic',1);
  const p=plan({sessions,throughSessionId:'s4',albums:[link(1),card(2),card(3),link(4)]});
  assert.deepEqual(p.entries.map(e=>e.sessionId),['s1','s3','s4']);
  assert.deepEqual(p.entries.map(e=>e.number),[1,2,3]);
  assert.equal(p.pending.length,0);
  assert.match(p.summary,/\*Sessão 2\*\n_18\/08\/2026 às 08:00_\nAusência - Reposição fictícia combinada\./);
  assert.match(p.summary,/\*Sessão 3\*\n_24\/08\/2026 às 08:00_\nhttps:\/\/photos\.app\.goo\.gl\/fixture4/);
  assert.doesNotMatch(p.summary,/12\/08\/2026|Texto livre diz contabilizada|Sessão 4|Sem mídia|Falta|Ausência registrada|Fotos:/);
});
