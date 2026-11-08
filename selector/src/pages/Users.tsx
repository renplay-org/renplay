import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Avatar from '../components/Avatar'
import { Spinner, errorText, useToast } from '../lantern/ui'
import { Pill, TagPill } from '../lantern/controls'
import { useRoom } from '../lantern/Room'
import { adultLabels } from '../lib/adult'
import { ADULT_LEVELS, parseAdultLevel, type AdultLevel } from '@shared/levels'
import { api, del, post, put } from '../lib/api'
import { useAuth, useProviders } from '../lib/auth'
import { useGames } from '../lib/queries'
import { AccountSection } from './Account'
import type { People, PersonListed } from '@shared/api'
import Sheet from '../lantern/Sheet'

type Action = 'add' | 'edit' | 'password' | 'copy' | 'merge' | 'import' | 'remove'
const historyNotice = 'Nothing is overwritten without a copy in the destination’s save history.'

export default function Users() {
  const { data: me } = useAuth(), qc = useQueryClient(), toast = useToast()
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<People>('/api/users') })
  const providers = useProviders()
  const { data: games } = useGames()
  const [dialog, setDialog] = useState<{ action: Action; user?: PersonListed } | null>(null)
  const [menu, setMenu] = useState<PersonListed | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useRoom({ game: null, quiet: true })
  const all = users.data?.users ?? []
  const ceilingOf = (user: PersonListed): AdultLevel => parseAdultLevel(user.adult_ceiling) ?? users.data?.adultDefault ?? 'off'
  const choiceOf = (user: PersonListed): AdultLevel => parseAdultLevel(user.adult_choice) ?? ceilingOf(user)
  const lastAdmin = (user: PersonListed) => user.role === 'admin' && !user.disabled && all.filter((u) => u.role === 'admin' && !u.disabled).length === 1
  const open = (action: Action, user?: PersonListed) => { setMenu(null); setError(''); setDialog({ action, user }) }
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await fn(); await qc.invalidateQueries(); setDialog(null); toast('Changes saved', 'success') }
    catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  const titles: Record<Action, string> = { add: 'Add user', edit: 'Edit user', password: 'Reset password', copy: 'Copy saves', merge: 'Merge user', import: 'Import a save folder', remove: 'Remove user' }
  const destinations = all.filter((u) => u.id !== dialog?.user?.id)
  return (
    <div>
      <Link to="/settings" className="crumb row small muted hide-desk" style={{ gap: 6 }}>
        <ArrowLeft style={{ width: 16, height: 16 }} /> Settings
      </Link>
      <header className="row between wrap" style={{ gap: 12, marginTop: 8 }}>
        <div>
          <h1 className="h1">Users</h1>
          <p className="lead" style={{ marginTop: 6 }}>Everyone has their own saves, favourites and preferences. The library is shared.</p>
        </div>
        <Pill variant="p" icon={<Plus />} onClick={() => open('add')}>Add user</Pill>
      </header>
      {users.isPending ? (
        <Spinner />
      ) : users.isError ? (
        <p role="alert" className="small red">{errorText(users.error)}</p>
      ) : (
        <div className="rows" style={{ marginTop: 14 }}>
          {all.map((user) => (
            <div key={user.id} className="r stack-ph">
              <Avatar name={user.name} avatar={user.avatar} className="lg" />
              <div className="grow">
                <div className="row wrap" style={{ gap: 8 }}>
                  <span className="t">{user.name}</span>
                  <TagPill tone={user.role === 'admin' ? 'pink' : undefined}>{user.role === 'admin' ? 'Admin' : 'Player'}</TagPill>
                  {user.id === 1 && <TagPill>Owner</TagPill>}
                  {!!user.disabled && <TagPill tone="amber">Disabled</TagPill>}
                </div>
                <div className="m">
                  {user.username} · {user.games} {user.games === 1 ? 'game' : 'games'} · {user.saves} save {user.saves === 1 ? 'file' : 'files'} · Adult games at most {adultLabels[ceilingOf(user)]}
                  {choiceOf(user) !== ceilingOf(user) && `, chose ${adultLabels[choiceOf(user)]}`}
                </div>
                {user.role === 'admin' && <div className="m">{user.admin_source === 'provider' ? 'Admin access set by the sign-in provider.' : user.admin_source === 'allowlist' ? 'Admin access granted by RENPLAY_ADMINS.' : 'Admin access set in Renplay.'}</div>}
                {(user.roleManaged || user.adultManaged) && <div className="m">{user.roleManaged && user.adultManaged ? 'Role and adult games level' : user.roleManaged ? 'Role' : 'Adult games level'} set by the sign-in group.</div>}
                {lastAdmin(user) && <div className="m">Users cannot demote, disable or remove the last enabled admin. Provider sign-in can still revoke its grant.</div>}
              </div>
              <div className="end">
                <Pill variant="s" size="sm" onClick={() => open('edit', user)}>Edit</Pill>
                <button className="ib" aria-label={`More actions for ${user.name}`} onClick={() => setMenu(user)}>
                  <MoreHorizontal />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="grid2" style={{ marginTop: 24 }}>
        <AccountSection title="Moving saves">
          <p className="small muted">Copy one game or all save folders between users. {historyNotice} Merging also combines progress and archives the source account.</p>
          <div className="actions">
            <Pill size="sm" disabled={all.length < 2} onClick={() => open('copy')}>Copy saves</Pill>
            <Pill size="sm" disabled={!all.length} onClick={() => open('import')}>Import a save folder</Pill>
          </div>
        </AccountSection>
        <AccountSection title="Sign-in">
          <p className="small muted-2">{me?.auth ? 'Sign-in is on.' : `Sign-in is off. Everyone plays as ${me?.user.name || 'the owner'}. You can prepare accounts and move saves here before turning it on.`}</p>
          <p className="small muted">Password sign-in: {providers.data ? (providers.data.local ? 'On' : 'Off') : 'Loading'}. {providers.data?.oidc && `Single sign-on: ${providers.data.oidc}. `}{providers.data?.ldap && 'LDAP: On. '}New users are players unless an admin or provider rule grants access.</p>
          <a className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="https://renplay.org/docs/accounts/" target="_blank" rel="noreferrer">About accounts and sign-in ↗</a>
        </AccountSection>
      </div>
      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu ? `Actions for ${menu.name}` : 'PersonListed actions'}>
        {menu && (
          <div className="stack">
            <div className="stack" style={{ gap: 8 }}>
              <Pill onClick={() => open('edit', menu)}>Edit role and access</Pill>
              <Pill onClick={() => open('password', menu)}>Reset password</Pill>
              <Pill onClick={() => open('copy', menu)} disabled={all.length < 2}>Copy saves</Pill>
              <Pill href={`/api/users/${menu.id}/saves/export`}>Export save folder</Pill>
              <Pill onClick={() => open('import', menu)}>Import a save folder</Pill>
              <Pill disabled={menu.protected || lastAdmin(menu)} onClick={() => open('merge', menu)}>Merge into another user</Pill>
              <Pill variant="d" disabled={menu.protected || lastAdmin(menu)} onClick={() => open('remove', menu)}>Remove user</Pill>
            </div>
            {menu.protected && <p className="small muted">The owner and the account used with sign-in off must stay. Their saves can still be copied.</p>}
            {lastAdmin(menu) && <p className="small muted">Keep at least one enabled admin. Users cannot demote, disable or remove this account. Provider sign-in can still revoke its grant.</p>}
          </div>
        )}
      </Sheet>
      <Sheet open={!!dialog} onClose={() => !busy && setDialog(null)} title={dialog ? titles[dialog.action] : ''}>
        {dialog && (
          <form className="stack" onSubmit={(e) => {
            e.preventDefault(); const form = new FormData(e.currentTarget), action = dialog.action, id = dialog.user?.id ?? Number(form.get('source'))
            void run(async () => {
              if (action === 'add') return post('/api/users', { username: form.get('username'), name: form.get('name'), password: form.get('password'), role: form.get('role'), adultCeiling: form.get('adultCeiling') })
              if (action === 'edit') return put(`/api/users/${id}`, { ...(!dialog.user?.roleManaged ? { role: form.get('role') || dialog.user!.role } : {}), disabled: form.get('disabled') === 'on', ...(!dialog.user?.adultManaged ? { adultCeiling: form.get('adultCeiling') } : {}) })
              if (action === 'password') return post(`/api/users/${id}/password`, { password: form.get('password') })
              if (action === 'remove') return del(`/api/users/${id}`)
              if (action === 'import') { const upload = new FormData(); upload.append('file', form.get('file')!); return api(`/api/users/${id}/saves/import`, { method: 'POST', body: upload }) }
              const target = Number(form.get('target'))
              if (target === id) throw new Error('Choose two different users.')
              return post(`/api/users/${id}/${action === 'merge' ? 'merge' : 'saves/copy'}`, { target, ...(form.get('game') ? { game: form.get('game') } : {}) })
            })
          }}>
            {dialog.user && <p className="small muted-2" style={{ overflowWrap: 'anywhere' }}>{dialog.user.name} ({dialog.user.username})</p>}
            {dialog.action === 'add' && (
              <>
                <label className="field"><span>Username</span><input name="username" required minLength={2} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{1,63}" autoCapitalize="none" autoComplete="off" className="input" /></label>
                <label className="field"><span>Display name</span><input name="name" required maxLength={100} className="input" /></label>
              </>
            )}
            {(dialog.action === 'add' || dialog.action === 'password') && (
              <>
                <label className="field"><span>{dialog.action === 'password' ? 'New password' : 'Password'}</span><input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={1024} className="input" /></label>
                {dialog.action === 'password' && <p className="small muted">All of this user’s sessions will end. Saves are kept.</p>}
              </>
            )}
            {(dialog.action === 'add' || dialog.action === 'edit') && (
              <>
                <label className="field"><span>Role</span><select aria-label="Role" name="role" defaultValue={dialog.user?.role || 'player'} disabled={!!dialog.user && (lastAdmin(dialog.user) || dialog.user.roleManaged)} className="input"><option value="player">Player</option><option value="admin">Admin</option></select></label>
                <label className="field"><span>Adult games, at most</span><select aria-label="Adult games, at most" name="adultCeiling" disabled={dialog.user?.adultManaged} defaultValue={dialog.user ? ceilingOf(dialog.user) : users.data?.adultDefault ?? 'off'} className="input">{ADULT_LEVELS.map((level) => <option key={level} value={level}>{adultLabels[level]}</option>)}</select></label>
                {dialog.action === 'edit' && <label className="row" style={{ minHeight: 44 }}><input name="disabled" type="checkbox" defaultChecked={!!dialog.user?.disabled} disabled={!!dialog.user && lastAdmin(dialog.user)} style={{ width: 20, height: 20 }} />Disabled</label>}
                {dialog.user && lastAdmin(dialog.user) && <p className="small muted">Users cannot demote or disable the last enabled admin. Provider sign-in can still revoke its grant.</p>}
                {(dialog.user?.roleManaged || dialog.user?.adultManaged) && <p className="small muted">Locked permissions are set by the sign-in provider at every sign-in.</p>}
                {!dialog.user?.roleManaged && <p className="small muted">Admin access saved here is kept when sign-in rules change or a sign-in is unlinked.</p>}
                <p className="xs muted">Off hides adult games, Blurred shows them without pictures. The person can choose less on their account page, and nobody sees more than this installation allows.</p>
              </>
            )}
            {['copy', 'import'].includes(dialog.action) && !dialog.user && (
              <label className="field"><span>{dialog.action === 'import' ? 'Import into' : 'From'}</span><select aria-label={dialog.action === 'import' ? 'Import into' : 'From'} name="source" required className="input">{all.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select></label>
            )}
            {(dialog.action === 'copy' || dialog.action === 'merge') && (
              <>
                <label className="field"><span>To</span><select aria-label="To" name="target" required defaultValue={destinations.find((u) => u.id !== (dialog.user?.id ?? all[0]?.id))?.id} className="input">{destinations.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select></label>
                {dialog.action === 'copy' && (
                  <label className="field"><span>Game</span><select aria-label="Game" name="game" className="input"><option value="">All save folders</option>{games?.filter((g) => g.saveDir).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
                )}
                <p className="small muted-2">{historyNotice}</p>
              </>
            )}
            {dialog.action === 'import' && (
              <>
                <label className="field"><span>Save folder zip</span><input name="file" type="file" accept=".zip" required className="input" style={{ paddingTop: 12 }} /></label>
                <p className="small muted">Choose a whole save-folder export. {historyNotice}</p>
              </>
            )}
            {(dialog.action === 'merge' || dialog.action === 'remove') && (
              <p className="small muted-2">{dialog.action === 'merge' ? 'Saves and progress are copied to the destination, then this account is removed.' : 'This account will be removed and can no longer sign in.'} Its saves and history move to the server’s users-removed archive folder, not the trash. {historyNotice}</p>
            )}
            {dialog.action === 'edit' && dialog.user?.id === me?.user.id && <p className="small amber">You are editing your own account. Disabling it or changing its role changes your access immediately.</p>}
            {error && <p role="alert" className="small red">{error}</p>}
            <div>
              <Pill type="submit" loading={busy} variant={dialog.action === 'remove' || dialog.action === 'merge' ? 'd' : 'p'}>{dialog.action === 'edit' ? 'Save changes' : titles[dialog.action]}</Pill>
            </div>
          </form>
        )}
      </Sheet>
    </div>
  )
}
