import React from 'react';
import { Sync } from '../services/sync';
import { ConfirmDialog } from './ui';

/** Small membership panel, isolated from baseball state and team hydration. */
export function TeamAccess({user, team, onTeamsChanged}) {
  const owner = team?.owner === user.id;
  const [invites, setInvites] = React.useState([]);
  const [access, setAccess] = React.useState(null);
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [message, setMessage] = React.useState(null);
  const [remove, setRemove] = React.useState(null);
  const mounted = React.useRef(true);
  React.useEffect(() => {mounted.current=true; return () => {mounted.current=false;};}, []);
  const refresh = async () => {
    const pending = await Sync.pendingInvitations();
    const current = owner ? await Sync.manageAccess(team.id, 'list') : null;
    if(mounted.current) {setInvites(pending); setAccess(current);}
  };
  React.useEffect(() => {let cancelled=false; refresh().catch(e=>{if(!cancelled)setError(e.message);}); return()=>{cancelled=true;};}, [owner, team?.id]);
  const act = async (fn) => {
    setBusy(true); setError(null); setMessage(null);
    try {await fn(); await refresh(); await onTeamsChanged();}
    catch(e) {if(mounted.current)setError(e.message || 'Could not update team access');}
    finally {if(mounted.current)setBusy(false);}
  };
  return <section className="team-setup-controls" aria-label="Team access" style={{marginTop:'var(--space-lg)',paddingTop:'var(--space-md)',borderTop:'1px solid var(--border-light)'}}>
    <strong>Team access{team ? ` · ${owner ? 'Owner' : 'Coach'}` : ''}</strong>
    <p className="form-hint">Coaches share this team's roster, games and pitching history. Changes sync while the app is open. Conflicting edits are kept for review.</p>
    <button className="btn btn-secondary" disabled={busy} onClick={()=>act(async()=>{})}>Refresh invitations & teams</button>
    {invites.map(invite=><div key={invite.id} className="team-setup-controls" style={{padding:'var(--space-sm)',border:'1px solid var(--border-light)',borderRadius:8}}>
      <span>Invitation to <strong>{invite.team_name}</strong></span>
      <button className="btn btn-primary" disabled={busy} onClick={()=>act(async()=>{await Sync.acceptInvitation(invite.id); if(mounted.current)setMessage(`Joined ${invite.team_name}. Choose Switch in Your teams to open it. Your current team stays unchanged.`);})}>Join Team</button>
    </div>)}
    {owner && <>
      <form className="team-setup-controls" onSubmit={e=>{e.preventDefault();act(async()=>{const result=await Sync.manageAccess(team.id,'invite',{target_email:email.trim()}); if(mounted.current){setEmail('');setMessage(result.already_member ? 'That coach already belongs to this team.' : 'Invitation ready. Ask the coach to sign in with that email and open Settings to join. No invitation email is sent.');}});}}>
        <label className="form-label" htmlFor="invite-coach-email">Invite coach by email</label>
        <input id="invite-coach-email" className="form-input" type="email" required maxLength={254} autoComplete="off" value={email} onChange={e=>setEmail(e.target.value)} placeholder="coach@example.com" />
        <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>Create Invitation</button>
        <p className="form-hint">Share this app's link with the coach. Invitations appear in Settings after they sign in with the invited, verified email and expire after seven days. They may create an account first.</p>
      </form>
      {(access?.members || []).map(member=><div key={member.user_id} style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
        <span style={{overflowWrap:'anywhere',flex:1}}>{member.email || 'Team member'} · {member.role === 'owner' ? 'Owner' : 'Coach'}</span>
        {member.role !== 'owner' && <button className="btn btn-secondary" disabled={busy} onClick={()=>setRemove(member)}>Remove Coach</button>}
      </div>)}
      {(access?.invitations || []).map(invite=><div key={invite.id} style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
        <span style={{overflowWrap:'anywhere',flex:1}}>Pending: {invite.email}</span>
        <button className="btn btn-secondary" disabled={busy} onClick={()=>act(()=>Sync.manageAccess(team.id,'cancel',{invitation_id:invite.id}))}>Cancel Invitation</button>
      </div>)}
    </>}
    {message && <p role="status" className="text-small">{message}</p>}
    {error && <p role="alert" className="text-danger text-small">{error}</p>}
    {remove && <ConfirmDialog title="Remove Coach" message={`Remove ${remove.email || 'this coach'} from ${team.name}? Their cloud access ends; the team's data is kept. Copies already downloaded cannot be remotely erased.`} confirmLabel="Remove Coach" danger onCancel={()=>setRemove(null)} onConfirm={()=>{const id=remove.user_id;setRemove(null);act(()=>Sync.manageAccess(team.id,'remove',{target_user:id}));}} />}
  </section>;
}
