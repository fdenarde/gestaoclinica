import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { auth } from '../src/firebase.ts';
import Gallery from '../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx';
import Modal from '../src/components/Common/Modal.tsx';
import { resetGooglePhotosAlbumsCacheForTests } from '../src/lib/googlePhotosAlbumsApi.ts';
import { createEmptyGooglePhotosAlbumCard } from '../shared/googlePhotosAlbums.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let run = 0;
const textOf = node => Array.isArray(node) ? node.map(textOf).join(' ') : typeof node === 'string' ? node : node ? textOf(node.children || []) : '';
const json = (value,status=200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const session = n => ({ id: `synthetic-s${n}`, patientId: 'synthetic-p', date: `2026-08-${String(n*6).padStart(2,'0')}`,
  time: '08:00', type: 'Sessão simples (50 min)', status: 'Realizada', packageNumber: n, consumesPackage: true });
const album = (n,extra={}) => ({ ...createEmptyGooglePhotosAlbumCard({ patientId: 'synthetic-p', patientName: 'Pessoa fictícia',
  packageNumber: 1, activityDate: session(n).date, sessionTime: '08:00', sessionIds: [session(n).id], title: 'Atividade fictícia' }),
  visibleToGuardian: true, isVirtual: false, ...extra });

async function fixture(options, inspect) {
  await auth.authStateReady?.(); resetGooglePhotosAlbumsCacheForTests();
  const previous = Object.fromEntries(['fetch','window','document','HTMLElement','navigator','CustomEvent'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const previousUser = Object.getOwnPropertyDescriptor(auth,'currentUser');
  const writes=[], copies=[], canonicalWrites=[];
  let sessions = options.sessions || [session(1),session(2),session(3)];
  const albums = options.albums || [album(1),album(2),album(3,{ url:'https://photos.app.goo.gl/synthetic3' })];
  const statuses = { ...(options.statuses || {}) };
  const install = (key,value) => Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  install('window',{ sessionStorage: { getItem:()=>null,setItem(){},removeItem(){} }, addEventListener(){},removeEventListener(){},dispatchEvent(){},
    confirm:()=>{ throw new Error('Native confirmations forbidden'); },setTimeout,clearTimeout });
  install('document',{ activeElement:null,addEventListener(){},removeEventListener(){},getElementById:()=>null });
  install('HTMLElement',class {});
  install('CustomEvent',class { constructor(type,options){this.type=type;this.detail=options.detail;} });
  install('navigator',{ clipboard:{writeText:async text=>copies.push(text)} });
  Object.defineProperty(auth,'currentUser',{configurable:true,value:{uid:`synthetic-summary-${++run}`,getIdToken:async()=> 'synthetic-token'}});
  install('fetch', async (url,init={}) => {
    const address=new URL(String(url),'http://localhost:4173');
    const body=init.method==='POST'?JSON.parse(String(init.body)):{};
    if(body.action==='saveSessionNoMediaJustification') {
      writes.push(body);
      if(options.failSession===body.sessionId) return json({error:{code:'INTERNAL',message:'Falha sintética.'}},500);
      const status={sessionId:body.sessionId,patientId:body.patientId,hasMedia:false,mediaCount:0,
        justification:{active:true,reason:body.reason,note:body.note}};
      statuses[body.sessionId]=status;
      return json({status});
    }
    assert.ok(init.method==='GET'||body.action==='listProfessionalGallery','only synthetic known reads/writers');
    if(body.action==='listProfessionalGallery') return json({items:[{sessions:sessions.map(s=>({...s,mediaCount:0,state:'excused',justification:statuses[s.id]?.justification||null}))}],monitoringStart:'2026-01-01T00:00:00Z'});
    if(address.searchParams.get('mode')==='sessions') return json({sessions});
    if(address.pathname==='/api/google-photos-albums') return json({albums,packageKey:'synthetic-p__package_1',packageNumber:1,scope:'manage',ownerUserId:'synthetic-owner',
      permissions:{canView:true,canEdit:true,canCreate:true,canHide:true,canReactivate:true,canRemove:true}});
    throw new Error('Unexpected fixture route');
  });
  let view;
  const props={active:true,navigationKey:1,patients:[{id:'synthetic-p',name:options.patientName || 'Pessoa fictícia',packageTolerances:[]}],sessions,payments:[],currentUserName:'Equipe fictícia',initialPatientId:'synthetic-p',
    onUpdate:async update=>{canonicalWrites.push(update);if(options.canonicalFailure)return false;sessions=update.sessions;return true;}};
  try {
    await act(async()=>{view=TestRenderer.create(React.createElement(Gallery,props));});
    await act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
    const articles=()=>view.root.findAll(node=>node.type==='article'&&String(node.props.id||'').startsWith('google-photos-card-'));
    const copy=async(number)=>{
      const card=articles().find(a=>number ? textOf(a).includes(`Sessão ${number}`) : textOf(a).includes("18/08/2026")); assert.ok(card);
      const button=card.findAllByType('button').find(b=>textOf(b).includes('Copiar resumo até aqui'));assert.ok(button);assert.equal(button.props.disabled,false);
      await act(async()=>{await button.props.onClick();});
    };
    const modal=()=>view.root.findAllByType(Modal).find(node=>node.props.title==='Complete as sessões antes de copiar');
    const button=label=>modal().findAllByType('button').find(b=>textOf(b)===label);
    const field=(label)=>modal().find(node=>node.props['aria-label']===label);
    const fill=async(n,note='Explicação fictícia compartilhável')=> {
      await act(async()=>field(`Observação compartilhável da sessão ${n}`).props.onChange({target:{value:note}}));
    };
    await inspect({view,props,copy,modal,button,field,fill,writes,copies,canonicalWrites,articles});
  } finally {
    if(view)await act(async()=>view.unmount());resetGooglePhotosAlbumsCacheForTests();
    for(const [key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    if(previousUser)Object.defineProperty(auth,'currentUser',previousUser);else delete auth.currentUser;
  }
}

test('modal único: somente textarea editável por sessão; digitação e cancelar não escrevem/copiam',async()=>{
  await fixture({},async f=>{
    await f.copy();assert.equal(f.modal().props.isOpen,true);
    assert.equal(f.modal().findAllByType('select').length,0);assert.equal(f.modal().findAllByType('textarea').length,2);
    assert.equal(f.field('Observação compartilhável da sessão 1').props.disabled,false);
    assert.match(textOf(f.modal()),/2\s+sessões precisam de revisão/);assert.equal(f.button('Salvar e copiar resumo').props.disabled,true);
    await f.fill(1,'Nota fictícia complementar');assert.match(textOf(f.modal()),/1\s+sessões precisam de revisão/);
    await act(async()=>f.button('Cancelar').props.onClick());
    assert.equal(f.modal().props.isOpen,false);assert.deepEqual(f.writes,[]);assert.deepEqual(f.canonicalWrites,[]);assert.deepEqual(f.copies,[]);
  });
});

test('observação compartilhável existente dispensa seleção/redigitação e não aparece como pendente',async()=>{
  await fixture({albums:[album(1,{observation:'Não foi possível realizar registro fotográfico nesta sessão.'}),album(2),album(3,{url:'https://photos.app.goo.gl/synthetic3'})]},async f=>{
    await f.copy();assert.equal(f.modal().findAllByType('textarea').length,1);
    assert.equal(f.modal().findAllByType('select').length,0);
    await f.fill(2,'Explicação fictícia');assert.equal(f.button('Salvar e copiar resumo').props.disabled,false);
    await act(async()=>{await f.button('Salvar e copiar resumo').props.onClick();});
    assert.equal(f.writes.length,1);assert.equal(f.writes[0].sessionId,'synthetic-s2');assert.equal(f.writes[0].note,'Explicação fictícia');
    assert.equal(f.copies.length,1);assert.match(f.copies[0],/Não foi possível realizar registro fotográfico nesta sessão\./);
    assert.equal(f.copies[0], [
      '*Segue abaixo o Registro das atividades - Pessoa fictícia*', '',
      '*Sessão 1*', '_06/08/2026 às 08:00_', 'Não foi possível realizar registro fotográfico nesta sessão.', '',
      '*Sessão 2*', '_12/08/2026 às 08:00_', 'Explicação fictícia', '',
      '*Sessão 3*', '_18/08/2026 às 08:00_', 'https://photos.app.goo.gl/synthetic3',
    ].join('\n'));
    assert.doesNotMatch(f.copies[0],/Motivo:|Observação:/);assert.equal(f.modal().props.isOpen,false);
  });
});

test('falha parcial mostra estado individual, mantém sucesso e não repete writer confirmado',async()=>{
  await fixture({failSession:'synthetic-s2'},async f=>{
    await f.copy();await f.fill(1);await f.fill(2);
    await act(async()=>{await f.button('Salvar e copiar resumo').props.onClick();});
    assert.equal(f.writes.length,2);assert.equal(f.copies.length,0);
    assert.match(textOf(f.modal()),/Salvo e confirmado/);assert.match(textOf(f.modal()),/Não foi possível confirmar o salvamento desta sessão/);
    assert.equal(f.field('Observação compartilhável da sessão 1').props.disabled,true);
    await act(async()=>{await f.button('Salvar e copiar resumo').props.onClick();});
    assert.equal(f.writes.length,3);assert.equal(f.writes[2].sessionId,'synthetic-s2');assert.deepEqual(f.copies,[]);
  });
});

test('ausência sem explicação usa writer existente de observação, sem criar motivo/status ou mudar consumo',async()=>{
  const absence={...session(1),status:'Falta',noReplacementObservation:'',consumesPackage:true,privateNotes:'Privado fictício'};
  await fixture({sessions:[absence,session(2),session(3)]},async f=>{
    await f.copy();assert.equal(f.modal().findAllByType('select').length,0);
    await f.fill(1,'Observação fictícia compartilhável');await f.fill(2);
    await act(async()=>{await f.button('Salvar e copiar resumo').props.onClick();});
    assert.equal(f.canonicalWrites.length,1);const saved=f.canonicalWrites[0].sessions.find(s=>s.id===absence.id);
    assert.equal(saved.status,'Falta');assert.equal(saved.consumesPackage,true);assert.equal(saved.privateNotes,'Privado fictício');
    assert.equal(saved.noReplacementReasonCode,undefined);assert.equal(saved.noReplacementReasonText,undefined);
    assert.equal(f.writes.length,1);assert.equal(f.writes[0].sessionId,'synthetic-s2');assert.equal(f.copies.length,1);
    assert.match(f.copies[0],/Ausência - Observação fictícia compartilhável/);assert.doesNotMatch(f.copies[0],/Privado fictício/);
  });
});

test('Somente equipe permanece privado; textarea nova explícita não sobrescreve nem compartilha nota privada',async()=>{
  await fixture({albums:[album(1,{visibleToGuardian:false,observation:'Privado fictício'}),album(2),album(3,{url:'https://photos.app.goo.gl/synthetic3'})]},async f=>{
    await f.copy();assert.doesNotMatch(textOf(f.modal()),/Privado fictício/);
    assert.equal(f.field('Observação compartilhável da sessão 1').props.value,'');assert.equal(f.field('Observação compartilhável da sessão 1').props.disabled,false);
    await f.fill(1,'Nova explicação pública fictícia');await f.fill(2);
    await act(async()=>{await f.button('Salvar e copiar resumo').props.onClick();});
    assert.equal(f.copies.length,1);assert.match(f.copies[0],/Nova explicação pública fictícia/);assert.doesNotMatch(f.copies[0],/Privado fictício/);
    assert.equal(f.canonicalWrites.length,0);assert.ok(f.writes.every(w=>w.action==='saveSessionNoMediaJustification'));
  });
});

test('links e notas existentes copiam imediatamente, sem modal ou gravação',async()=>{
  await fixture({albums:[album(1,{observation:'Nota compartilhável existente'}),album(2,{visibleToGuardian:false}),album(3,{url:'https://photos.app.goo.gl/synthetic3'})],
    statuses:{'synthetic-s2':{justification:{active:true,reason:'',note:'Nota compartilhável da justificativa'}}}},async f=>{
    await f.copy();assert.equal(f.modal().props.isOpen,false);assert.equal(f.copies.length,1);
    assert.match(f.copies[0],/Sessão 1[\s\S]*Sessão 2[\s\S]*Sessão 3/);assert.deepEqual(f.writes,[]);
  });
});

test('ausência canônica com motivo existente não precisa de observação duplicada',async()=>{
  await fixture({sessions:[{...session(1),status:'Falta',noReplacementReasonCode:'health_issue'},session(2),session(3)],
    albums:[album(1,{visibleToGuardian:false}),album(2,{observation:'Nota fictícia pública'}),album(3,{url:'https://photos.app.goo.gl/synthetic3'})]},async f=>{
    await f.copy();assert.equal(f.modal().props.isOpen,false);assert.match(f.copies[0],/Ausência - Problema de saúde/);assert.deepEqual(f.writes,[]);
  });
});

test('troca de contexto fecha modal sem escrever/copiar',async()=>{
  await fixture({},async f=>{
    await f.copy();await f.fill(1);await f.fill(2);
    await act(async()=>f.view.update(React.createElement(Gallery,{...f.props,active:false,navigationKey:2})));
    assert.equal(f.modal().props.isOpen,false);assert.deepEqual(f.writes,[]);assert.deepEqual(f.copies,[]);
  });
});

function whatsappFixture() {
  return {
    patientName: 'Gabrielly', // Nome solicitado para esta fixture inteiramente fictícia.
    sessions: [
      { ...session(1), date: '2026-08-06', time: '19:00' },
      { ...session(2), date: '2026-08-07', status: 'Falta', consumesPackage: false,
        noReplacementObservation: 'Ocorrência não contabilizada fictícia' },
      { ...session(3), date: '2026-08-13', time: '19:00' },
      { ...session(4), date: '2026-08-20', time: '18:00', status: 'Falta',
        noReplacementObservation: 'Ausência registrada nesta data. Reposição fragmentada com 25 min de acréscimo nas sessões futuras' },
    ],
    albums: [
      album(1, { url: 'https://photos.app.goo.gl/synthetic1' }),
      album(2, { visibleToGuardian: false, observation: 'Somente equipe: nota fictícia excluída' }),
      album(3, { url: 'https://photos.app.goo.gl/synthetic3' }),
      album(4, { visibleToGuardian: false, observation: 'Somente equipe: nota fictícia privada' }),
    ],
  };
}

const whatsappExpected = [
  '*Segue abaixo o Registro das atividades - Gabrielly*', '',
  '*Sessão 1*', '_06/08/2026 às 19:00_', 'https://photos.app.goo.gl/synthetic1', '',
  '*Sessão 2*', '_13/08/2026 às 19:00_', 'https://photos.app.goo.gl/synthetic3', '',
  '*Sessão 3*', '_20/08/2026 às 18:00_',
  'Ausência - Reposição fragmentada com 25 min de acréscimo nas sessões futuras',
].join('\n');

for (const fallback of [false, true]) test(`R11: botão real até clipboard ${fallback ? 'textarea' : 'writeText'} preserva marcação WhatsApp e R5`, async () => {
  await fixture(whatsappFixture(), async f => {
    let textarea;
    if (fallback) {
      navigator.clipboard = undefined;
      document.createElement = tag => {
        assert.equal(tag, 'textarea');
        textarea = { value: '', style: {}, setAttribute() {}, select() {}, remove() {} };
        return textarea;
      };
      document.body = { appendChild(node) { assert.equal(node, textarea); } };
      document.execCommand = command => {
        assert.equal(command, 'copy');
        f.copies.push(textarea.value);
        return true;
      };
    }
    await f.copy(3);
    assert.equal(f.modal().props.isOpen, false);
    assert.deepEqual(f.copies, [whatsappExpected]);
    assert.doesNotMatch(f.copies[0], /Ausência registrada nesta data|Falta|Sem mídia|Fotos:|Somente equipe|Ocorrência não contabilizada/);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.canonicalWrites, []);
  });
});
