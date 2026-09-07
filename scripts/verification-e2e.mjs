import assert from 'node:assert/strict';

export async function checkVerificationTransition(browser, baseURL) {
  const context = await browser.newContext({serviceWorkers:'block'});
  const oldUser = {id:'11111111-1111-4111-8111-111111111111',email:'old@example.test',aud:'authenticated',role:'authenticated'};
  const newUser = {id:'33333333-3333-4333-8333-333333333333',email:'new@example.test',aud:'authenticated',role:'authenticated'};
  const team = {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'My Team',is_personal:true};
  const session = user => {
    const exp=Math.floor(Date.now()/1000)+3600;
    const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    return {access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({...user,sub:user.id,exp})+'.test',refresh_token:'mock',expires_at:exp,expires_in:3600,token_type:'bearer',user};
  };
  const verified=session(newUser);
  const url=baseURL+'/#'+new URLSearchParams({access_token:verified.access_token,refresh_token:verified.refresh_token,expires_in:'3600',token_type:'bearer',type:'signup'});
  let provisioned=false, failProvision=true, failWrite=true, row=null;
  const writes=[];
  await context.addInitScript(({oldSession,oldUser})=>{
    if(sessionStorage.getItem('seeded'))return;
    sessionStorage.setItem('seeded','yes');
    localStorage.setItem('sb-iwcayywuheygotuwlkts-auth-token',JSON.stringify(oldSession));
    localStorage.setItem('ybl_state_v3',JSON.stringify({roster:[{id:'old-player',name:'Previous Team Player',positions:{}}],settings:{},games:[],currentGame:null,defaultBattingOrder:null,dataOwner:{userId:oldUser.id,teamId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',teamName:'Previous Team'},snapshotMeta:{teamId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:4,dirty:true,localRevision:1}}));
  },{oldSession:session(oldUser),oldUser});
  await context.route('https://*.supabase.co/**',async route=>{
    const request=route.request(), path=new URL(request.url()).pathname;
    if(path.endsWith('/user'))return route.fulfill({json:newUser});
    if(path.endsWith('/logout'))return route.fulfill({status:204,body:''});
    if(path.endsWith('/teams'))return route.fulfill({json:provisioned?[team]:[]});
    if(path.endsWith('/get_or_create_personal_team')) {
      if(failProvision)return route.fulfill({status:400,json:{message:'Provisioning unavailable'}});
      provisioned=true;return route.fulfill({json:team.id});
    }
    if(path.endsWith('/team_snapshots'))return route.fulfill({json:row});
    if(path.endsWith('/save_team_snapshot')) {
      const args=request.postDataJSON();writes.push(args);
      assert.equal(args.target_team,team.id);
      assert.ok(!args.payload.roster.some(p=>p.id==='old-player'),'old account data must never be uploaded');
      if(failWrite)return route.fulfill({status:400,json:{message:'First write unavailable'}});
      assert.equal(args.expected_revision,row?.revision ?? null);
      row={revision:(row?.revision || 0)+1,snapshot:args.payload,mutation_id:args.request_id};
      return route.fulfill({json:row.revision});
    }
    throw new Error('Unexpected request '+path);
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  try {
    await page.goto(url);
    await page.getByText('Open a Different Account',{exact:true}).waitFor();
    assert.match(await page.locator('.modal-body').textContent(),/new@example.test/);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByText('Open a Different Account',{exact:true}).count(),1);
    await page.locator('.modal').getByRole('button',{name:'Sign Out',exact:true}).click();
    await page.getByRole('button',{name:'Sign In',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('sb-iwcayywuheygotuwlkts-auth-token')),null);
    assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('ybl_state_v3')))).roster[0].id,'old-player');
    // A second emailed link opens a new document, not a same-document hash navigation.
    await page.goto('about:blank');
    await page.goto(url);
    await page.getByRole('button',{name:'Open This Account',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Provisioning unavailable'}).waitFor();
    assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('ybl_state_v3')))).dataOwner.userId,oldUser.id);
    failProvision=false;
    await page.getByRole('button',{name:'Open This Account',exact:true}).click();
    await page.getByText('Open a Different Account',{exact:true}).waitFor({state:'detached'});
    const opened=await page.evaluate(()=>JSON.parse(localStorage.getItem('ybl_state_v3')));
    assert.equal(opened.dataOwner.userId,newUser.id);
    assert.deepEqual(opened.roster,[]);
    assert.equal(row,null,'new account starts without a snapshot');
    const archive=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('ybl_recovery_')).map(k=>JSON.parse(localStorage.getItem(k))));
    assert.ok(archive.some(copy=>copy.owner.userId===oldUser.id && copy.data.roster[0]?.id==='old-player' && copy.meta.dirty));
    await page.locator('.nav-tab').filter({hasText:'Roster'}).click();
    await page.getByText('Load Demo Roster',{exact:true}).click();
    await page.locator('.nav-tab').filter({hasText:'Settings'}).click();
    await page.getByText(/First write unavailable/).waitFor();
    const pending=await page.evaluate(()=>JSON.parse(localStorage.getItem('ybl_state_v3')));
    assert.equal(pending.snapshotMeta.dirty,true);
    assert.equal(pending.snapshotMeta.revision,null);
    assert.equal(pending.roster.length,12);
    failWrite=false;
    await page.getByRole('button',{name:'Sync Now'}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ybl_state_v3')).snapshotMeta.revision===1);
    assert.equal(writes.at(-1).request_id,writes[0].request_id);
    assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('ybl_state_v3')))).snapshotMeta.dirty,false);
    console.log('OK: verification replaces Auth session, explicit account transition preserves old edits, new team provisions, first-write failure retries safely');
  } finally {await context.close();}
}
