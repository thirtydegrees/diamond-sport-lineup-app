import assert from "node:assert/strict";

// Isolated fake account: all Supabase requests are intercepted, no live data is used.
export async function checkTeamTransitions(browser, baseURL) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "coach@example.test",
    aud: "authenticated",
    role: "authenticated",
  };
  const teams = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Alpha Club",
      is_personal: true,
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Beta Club",
      is_personal: false,
    },
  ];
  const snapshots = teams.map((t, i) => ({
    revision: 1,
    mutation_id: crypto.randomUUID(),
    snapshot: {
      roster: [
        {
          id: "player" + i,
          name: t.name + " Player",
          canPitch: true,
          positions: {},
        },
      ],
      settings: { onboardingComplete: true },
      games: [],
      currentGame: null,
      defaultBattingOrder: null,
    },
  }));
  snapshots[0].snapshot.games = [
    {
      schemaVersion: 2,
      id: "outside",
      date: "2026-09-06",
      opponent: "Skills camp",
      workloadSource: "Skills camp",
      innings: 1,
      fielderCount: 9,
      battingOrder: ["player0"],
      availability: { player0: true },
      pitcherAssignments: {},
      lockedCells: {},
      lineup: {},
      score: { us: {}, them: {} },
      status: "completed",
      live: null,
      outs: [],
      exitedPlayers: {},
      playerNames: { player0: "Alpha Club Player" },
      pitchingAppearances: ["player0"],
      pitchCounts: {
        player0: {
          live: 25,
          byInning: {},
          adjustment: 25,
          confirmed: 25,
          status: "confirmed",
        },
      },
    },
  ];
  let releaseFetch;
  let waitForBeta = false;
  let failAlpha = false;
  let failLogout = true;
  let logoutScope;
  let savedSession;
  await context.route("https://*.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    let data;
    if (url.pathname.endsWith('/logout')) {
      logoutScope = url.searchParams.get('scope');
      await route.fulfill({status: failLogout ? 400 : 204, ...(failLogout ? {json:{message:'Test logout failed'}} : {body:''})});
      return;
    } else if (url.pathname.endsWith('/token')) data = savedSession;
    else if (url.pathname.endsWith("/teams")) {
      if (route.request().method() === "PATCH") {
        teams[1].name = route.request().postDataJSON().name;
        data = { id: teams[1].id };
      } else data = teams;
    } else if (url.pathname.endsWith("/team_snapshots")) {
      const index =
        url.searchParams.get("team_id") === "eq." + teams[1].id ? 1 : 0;
      if (index === 1 && waitForBeta) {
        waitForBeta = false;
        await new Promise((resolve) => {
          releaseFetch = resolve;
        });
      }
      if (index === 0 && failAlpha) {
        await route.fulfill({
          status: 503,
          json: { message: "Test team unavailable" },
        });
        return;
      }
      data = snapshots[index];
    } else if (url.pathname.endsWith("/user")) data = user;
    else {
      await route.fulfill({
        status: 500,
        json: { message: "Unexpected mock request: " + url.pathname },
      });
      return;
    }
    await route.fulfill({ json: data });
  });
  await context.addInitScript(
    ({ user }) => {
      const encode = (value) =>
        btoa(JSON.stringify(value))
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token =
        encode({ alg: "HS256", typ: "JWT" }) +
        "." +
        encode({ ...user, sub: user.id, exp }) +
        ".test";
      localStorage.setItem(
        "sb-iwcayywuheygotuwlkts-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "mock",
          expires_at: exp,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      );
    },
    { user },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(baseURL);
    await page
      .locator(".active-team strong")
      .filter({ hasText: "Alpha Club" })
      .waitFor();
    assert.equal(await page.getByText(/^Build [a-f0-9]+$/).count(), 0);
    await page.locator(".nav-tab").filter({ hasText: "Settings" }).click();
    const switchButton = (name) =>
      page
        .locator("div")
        .filter({ has: page.locator("span.text-small", { hasText: name }) })
        .filter({
          has: page.getByRole("button", { name: "Switch", exact: true }),
        })
        .last()
        .getByRole("button", { name: "Switch", exact: true });
    // Hold the destination fetch to examine the real pending state.
    waitForBeta = true;
    await switchButton("Beta Club").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Switching to Beta Club" })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".active-team strong")?.textContent ===
        "Alpha Club",
    );
    for (let i = 0; !releaseFetch && i < 300; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(releaseFetch, "destination request started");
    releaseFetch();
    await page
      .locator(".active-team strong")
      .filter({ hasText: "Beta Club" })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".team-transition"),
    );
    assert.match(
      await page.locator(".nav-tab.active").textContent(),
      /Settings/,
    );
    assert.equal(
      await page
        .getByText("Updated with newer changes from your account", {
          exact: true,
        })
        .count(),
      0,
    );
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ybl_state_v3")),
    );
    assert.equal(state.roster[0].name, "Beta Club Player");
    assert.equal(state.dataOwner.teamId, teams[1].id);
    // Same-status rename must update header too.
    await page
      .getByPlaceholder("Beta Club", { exact: true })
      .fill("Beta Renamed");
    await page
      .getByRole("button", { name: "Rename Team", exact: true })
      .click();
    await page
      .locator(".active-team strong")
      .filter({ hasText: "Beta Renamed" })
      .waitFor();
    await page.screenshot({
      path: ".e2e-artifacts/stabilization-settings.png",
      fullPage: true,
    });
    failAlpha = true;
    await switchButton("Alpha Club").click();
    await page.getByText("Test team unavailable", { exact: true }).waitFor();
    assert.match(
      await page.locator(".nav-tab.active").textContent(),
      /Settings/,
    );
    assert.equal(
      await page.locator(".active-team strong").textContent(),
      "Beta Renamed",
    );
    assert.equal(
      (
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("ybl_state_v3")),
        )
      ).roster[0].name,
      "Beta Club Player",
    );
    failAlpha = false;
    await switchButton("Alpha Club").click();
    await page
      .locator(".active-team strong")
      .filter({ hasText: "Alpha Club" })
      .waitFor();
    assert.match(
      await page.locator(".nav-tab.active").textContent(),
      /Settings/,
    );
    await page.locator(".nav-tab").filter({ hasText: "History" }).click();
    await page.locator(".player-name").filter({hasText:"Outside pitching · Skills camp"}).click();
    assert.equal(
      await page.getByText("vs Skills camp", { exact: true }).count(),
      0,
    );
    assert.equal(await page.getByText("0 - 0", { exact: true }).count(), 0);
    assert.equal(
      await page.getByText("✏️ Fix Participation", { exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "Delete Workload" }).waitFor();
    console.log(
      "OK: outside pitching history has workload identity and no score or participation editor",
    );
    console.log(
      "OK: team switching keeps Settings, hydrates identity/data, handles failed fetch and same-status rename",
    );
    await page.locator('.nav-tab').filter({hasText:'Settings'}).click();
    await switchButton('Beta Renamed').click();
    await page.locator('.active-team strong').filter({hasText:'Beta Renamed'}).waitFor();
    const beforeSignOut = await page.evaluate(() => JSON.parse(localStorage.getItem('ybl_state_v3')));
    savedSession = await page.evaluate(() => JSON.parse(localStorage.getItem('sb-iwcayywuheygotuwlkts-auth-token')));
    const signOut = page.locator('.card-header').getByRole('button',{name:'Sign Out',exact:true});
    await signOut.click();
    await page.getByText('Test logout failed',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Sign In',exact:true}).count(),0);
    failLogout = false;
    await signOut.click();
    await page.getByRole('button',{name:'Sign In',exact:true}).waitFor();
    assert.equal(logoutScope,'local');
    assert.match(await page.locator('.nav-tab.active').textContent(),/Settings/);
    assert.equal(await page.locator('.active-team-label').textContent(),'Saved team');
    assert.equal(await page.evaluate(() => localStorage.getItem('sb-iwcayywuheygotuwlkts-auth-token')),null);
    const afterSignOut = await page.evaluate(() => JSON.parse(localStorage.getItem('ybl_state_v3')));
    for (const key of ['roster','games','currentGame','settings','dataOwner','snapshotMeta']) assert.deepEqual(afterSignOut[key],beforeSignOut[key]);
    await page.getByPlaceholder('coach@example.com').fill(user.email);
    await page.locator('input[type="password"]').fill('TestPassword123');
    await page.getByRole('button',{name:'Sign In',exact:true}).click();
    await page.getByText('Signed in as',{exact:false}).waitFor();
    await page.waitForFunction(() => document.querySelector('.card-subtitle')?.textContent.includes('Synced'));
    assert.equal(await page.locator('.active-team strong').textContent(),'Beta Renamed');
    assert.equal(await page.locator('.active-team-label').textContent(),'Team');
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('ybl_state_v3')));
    assert.equal(restored.dataOwner.teamId,teams[1].id);
    assert.equal(restored.dataOwner.userId,user.id);
    assert.deepEqual(restored.roster,beforeSignOut.roster);
    assert.deepEqual(restored.games,beforeSignOut.games);
    console.log('OK: visible sign out uses local Supabase logout, handles failure, preserves data, clears session, and sign-in restores the selected nonpersonal team');

  } finally {
    await context.close();
  }
}
