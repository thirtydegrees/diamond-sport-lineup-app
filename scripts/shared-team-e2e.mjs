import assert from 'node:assert/strict';
import {teamTestDatabase} from './team-test-db.mjs';

export async function checkSharedTeams(browser, baseURL) {
 const users=['a','b','c'].map((letter,i)=>({id:`${i+1}${'1'.repeat(7)}-1111-4111-8111-111111111111`,email:`${letter}@example.test`,aud:'authenticated',role:'authenticated'}));
 const {db,as}=await teamTestDatabase(users);
 const team=(await as(users[0].id,'select public.get_or_create_personal_team() as id')).rows[0].id;
 await as(users[0].id,"update public.teams set name='Shared Club' where id=$1",[team]);
 await as(users[0].id,"select public.create_named_team('Owner Private',$1)",[crypto.randomUUID()]);
 const game={schemaVersion:2,id:'live-game',date:'2026-09-12',opponent:'Visitors',innings:6,fielderCount:9,battingOrder:['p'],availability:{p:true},pitcherAssignments:{1:'p'},lockedCells:{},lineup:{'p-1':'P'},score:{us:{1:2},them:{}},status:'live',live:{inning:1,outsRecorded:1,assignments:{p:'P'}},outs:[{seq:1,inning:1,outInInning:1,assignments:{p:'P'}}],pitchCounts:{p:{live:5,byInning:{1:5},adjustment:0,confirmed:null,status:'live'}},pitchingAppearances:['p'],pitchingStints:['p'],playerNames:{p:'Shared Player'},exitedPlayers:{}};
 const data={roster:[{id:'p',name:'Shared Player',canPitch:true,canCatch:true,positions:{},preferredOrder:[]}],settings:{onboardingComplete:true},currentGame:game,games:[{...game,id:'history-game',status:'completed',date:'2026-09-01',live:null,pitchCounts:{p:{live:25,byInning:{1:25},adjustment:0,confirmed:25,status:'confirmed'}}}],defaultBattingOrder:['p']};
 await as(users[0].id,'select public.save_team_snapshot($1,null,$2,$3)',[team,data,crypto.randomUUID()]);
 const contexts=[];
 const errors=[];
 async function open(user) {
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});contexts.push(ctx);
  await ctx.route('https://*.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   try {
    if(path.endsWith('/user'))return route.fulfill({json:user});
    let result;
    if(path.endsWith('/teams')) {
     if(req.method()==='PATCH')result=(await as(user.id,'update public.teams set name=$1 where id=$2 returning id',[req.postDataJSON().name,url.searchParams.get('id').slice(3)])).rows[0];
     else result=(await as(user.id,'select id,name,is_personal,owner from public.teams order by created_at')).rows;
    } else if(path.endsWith('/team_snapshots'))result=(await as(user.id,'select revision,snapshot,mutation_id from public.team_snapshots where team_id=$1',[url.searchParams.get('team_id').slice(3)])).rows[0]??null;
    else {
     const names={get_or_create_personal_team:[],save_team_snapshot:['target_team','expected_revision','payload','request_id'],my_team_invitations:[],manage_team_access:['target_team','operation','target_email','target_user','invitation_id'],accept_team_invitation:['invitation_id'],create_named_team:['team_name','request_id']};
     const name=path.split('/').pop(),keys=names[name];
     if(!keys)throw Error('Unexpected API '+path);
     const args=req.postDataJSON()||{};
     result=(await as(user.id,`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) as result`,keys.map(k=>args[k]??null))).rows[0].result;
    }
    await route.fulfill({json:result});
   } catch(e) {await route.fulfill({status:400,json:{message:e.message,code:e.code||'TEST'}});}
  });
  await ctx.addInitScript(user=>{
   if(sessionStorage.getItem('auth-seeded'))return;sessionStorage.setItem('auth-seeded','1');
   const enc=x=>btoa(JSON.stringify(x)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
   const exp=Math.floor(Date.now()/1000)+3600;
   localStorage.setItem('sb-iwcayywuheygotuwlkts-auth-token',JSON.stringify({access_token:enc({alg:'HS256',typ:'JWT'})+'.'+enc({...user,sub:user.id,exp})+'.test',refresh_token:'mock',expires_at:exp,expires_in:3600,token_type:'bearer',user}));
  },user);
  const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseURL);await page.waitForSelector('.nav-title');
  await page.waitForFunction(()=>!!JSON.parse(localStorage.getItem('ybl_state_v3')||'{}').dataOwner);
  return page;
 }
 const nav=(page,name)=>page.locator('.nav-tab').filter({hasText:name}).click();
 const state=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('ybl_state_v3')));
 const switchTo=(page,name)=>page.getByText(name,{exact:true}).locator('..').getByRole('button',{name:'Switch',exact:true}).click();
 try {
  const a=await open(users[0]);await nav(a,'Settings');
  await a.getByLabel('Invite coach by email').fill(users[1].email);
  await a.getByRole('button',{name:'Create Invitation',exact:true}).click();
  await a.getByText(/Invitation ready/).waitFor();
  const b=await open(users[1]);await nav(b,'Settings');
  const personal=(await state(b)).dataOwner.teamId;assert.notEqual(personal,team);
  await b.getByRole('button',{name:'Join Team',exact:true}).click();
  await b.getByText(/Joined Shared Club/).waitFor();
  assert.equal((await state(b)).dataOwner.teamId,personal,'joining does not move or upload the personal dataset');
  await switchTo(b,'Shared Club');
  await b.waitForFunction(t=>JSON.parse(localStorage.getItem('ybl_state_v3')).dataOwner.teamId===t,team);
  const shared=await state(b), original=await state(a);
  for(const key of ['roster','games','currentGame','defaultBattingOrder'])assert.deepEqual(shared[key],original[key]);
  assert.equal(await b.getByRole('button',{name:'Create Invitation',exact:true}).count(),0,'coach has no admin controls');
  assert.equal(await b.getByText('Owner Private',{exact:true}).count(),0);
  await nav(b,'Roster');await b.locator('.player-item').first().click();
  await b.getByPlaceholder('e.g., Joe B.').fill('Updated by Coach B');
  await b.locator('.modal-footer').getByRole('button',{name:'Save',exact:true}).click();
  await a.waitForFunction(()=>JSON.parse(localStorage.getItem('ybl_state_v3')).roster[0]?.name==='Updated by Coach B',null,{timeout:25000});
  assert.deepEqual((await state(a)).currentGame,original.currentGame,'roster change does not replace live game');
  await nav(b,'Settings');await switchTo(b,'My Team');
  await b.waitForFunction(t=>JSON.parse(localStorage.getItem('ybl_state_v3')).dataOwner.teamId===t,personal);
  assert.equal((await state(b)).roster.length,0);
  await switchTo(b,'Shared Club');
  await b.waitForFunction(()=>JSON.parse(localStorage.getItem('ybl_state_v3')).roster[0]?.name==='Updated by Coach B');
  const c=await open(users[2]);await nav(c,'Settings');
  assert.equal(await c.getByText('Shared Club',{exact:true}).count(),0);
  assert.equal((await as(users[2].id,'select * from public.team_snapshots where team_id=$1',[team])).rows.length,0);
  await a.getByRole('button',{name:'Refresh invitations & teams',exact:true}).click();
  await a.getByRole('button',{name:'Remove Coach',exact:true}).click();
  await a.locator('.modal').getByRole('button',{name:'Remove Coach',exact:true}).click();
  await a.getByRole('button',{name:'Remove Coach',exact:true}).waitFor({state:'detached'});
  await b.getByRole('button',{name:'🔄 Sync Now',exact:true}).click();
  await b.getByText(/Team access is no longer available/).first().waitFor();
  await switchTo(b,'My Team');
  await b.waitForFunction(t=>JSON.parse(localStorage.getItem('ybl_state_v3')).dataOwner.teamId===t,personal);
  assert.deepEqual(errors,[]);
  console.log('OK: two authenticated browser sessions invite/join, share the same SQL snapshot, sync coach edits automatically, switch isolated teams, and lose access on removal; third account denied');
 } finally {for(const ctx of contexts)await ctx.close();await db.close();}
}
