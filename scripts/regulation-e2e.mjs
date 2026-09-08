import assert from 'node:assert/strict';
export async function checkRegulation(browser, baseURL) {
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const page=await ctx.newPage();
 const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('ybl_state_v3')));
 await page.goto(baseURL);
 await page.getByText('Load Demo Roster',{exact:true}).click();
 await page.locator('.nav-tab').filter({hasText:'Game'}).click();
 await page.getByText('Continue to Lineup →',{exact:true}).click();
 await page.getByText('Auto-Generate',{exact:true}).click();
 await page.waitForSelector('.lineup-grid');
 const draft=await state();
 assert.equal(draft.currentGame.innings,6);
 for (const choice of ['Complete Game','Add Inning']) {
  if(choice==='Add Inning') {
   await page.evaluate(d=>localStorage.setItem('ybl_state_v3',JSON.stringify(d)),draft);
   await page.reload(); await page.waitForSelector('.lineup-grid');
  }
  await page.getByRole('button',{name:'▶ Start Game',exact:true}).click();
  await page.waitForSelector('.live-panel');
  assert.ok(await page.locator('.live-score').evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('.live-formation')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  assert.ok(await page.getByRole('button',{name:'🏁 Complete Game',exact:true}).evaluate(el=>el.classList.contains('btn-primary') && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'));
  for(let i=0;i<18;i++) {
   await page.getByRole('button',{name:'⬤ Record Defensive Out',exact:true}).click();
   const override=page.getByRole('button',{name:'Override & Apply',exact:true});
   if(await override.isVisible()) await override.click();
  }
  await page.getByText('Scheduled innings finished',{exact:true}).waitFor();
  const end=(await state()).currentGame;
  assert.equal(end.innings,6); assert.equal(end.live.inning,6); assert.equal(end.outs.length,18);
  assert.ok(!Object.keys(end.lineup).some(k=>k.endsWith('-7')));
  await page.getByRole('button',{name:choice,exact:true}).click();
  if(choice==='Complete Game') {
   const inputs=page.locator('input[aria-label^="Final pitches for"]');
   while(await inputs.count()) {await inputs.first().fill('10'); await page.getByRole('button',{name:'Confirm',exact:true}).first().click();}
   await page.locator('.modal-footer button').filter({hasText:'Complete Game'}).click();
   await page.getByText('Game & Workload History',{exact:true}).waitFor();
   assert.equal((await state()).games[0].outs.length,18);
  } else {
   const extended=(await state()).currentGame;
   assert.equal(extended.innings,7); assert.equal(extended.live.inning,7);
   assert.ok(extended.pitcherAssignments[7]);
   assert.equal(Object.keys(extended.lineup).filter(k=>k.endsWith('-7')).length,extended.battingOrder.length);
   const solve=page.getByRole('button',{name:'Re-solve Future Innings',exact:true});
   assert.equal(await solve.isEnabled(),true);
   await solve.click(); await page.getByRole('button',{name:'Confirm',exact:true}).click();
   assert.equal(await page.locator('.alert-error').count(),0, 'added inning resolves without error');
   assert.deepEqual((await state()).currentGame.outs,end.outs);
   assert.equal((await state()).currentGame.live.inning,7);
   await page.getByRole('button',{name:'+1 Pitch',exact:true}).click();
   assert.equal(await solve.isDisabled(),true);
  }
 }
 await ctx.close(); console.log('OK: mobile regulation stops at six; completion and explicit playable/resolvable seventh inning work');
}
