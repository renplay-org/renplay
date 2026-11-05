import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Avatar from '../components/Avatar'
import { accountInput } from '../components/AdultPreferences'
import { Badge, Button, Modal, Spinner, errorText, useToast } from '../components/ui'
import { api, del, post, put } from '../lib/api'
import { useAuth, type Account } from '../lib/auth'
import { useGames } from '../lib/queries'
import { AccountSection } from './Account'

interface User extends Account { disabled: number; games: number; saves: number; protected: boolean }
type Action = 'add' | 'edit' | 'password' | 'copy' | 'merge' | 'import' | 'remove'
const historyNotice = 'Nothing is overwritten without a copy in the destination’s save history.'

export default function Users() {
  const { data: me } = useAuth(), qc = useQueryClient(), toast = useToast()
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: User[]; adultDefault: boolean }>('/api/users') })
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<{ enabled: boolean; local: boolean; oidc: string | null; ldap: boolean }>('/api/auth/providers') })
  const { data: games } = useGames()
  const [dialog, setDialog] = useState<{ action: Action; user?: User } | null>(null)
  const [menu, setMenu] = useState<User | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const all = users.data?.users ?? []
  const lastAdmin = (user: User) => user.role === 'admin' && !user.disabled && all.filter((u) => u.role === 'admin' && !u.disabled).length === 1
  const open = (action: Action, user?: User) => { setMenu(null); setError(''); setDialog({ action, user }) }
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await fn(); await qc.invalidateQueries(); setDialog(null); toast('Changes saved', 'success') }
    catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  const titles: Record<Action, string> = { add: 'Add user', edit: 'Edit user', password: 'Reset password', copy: 'Copy saves', merge: 'Merge user', import: 'Import a save folder', remove: 'Remove user' }
  const destinations = all.filter((u) => u.id !== dialog?.user?.id)
  return <div className="animate-fade-in space-y-6">
    <Link to="/settings" className="inline-flex min-h-11 items-center text-sm text-zinc-400">← Settings</Link>
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="font-display text-3xl font-bold text-white">Users</h1><p className="mt-1 text-sm text-zinc-400">Everyone has their own saves, favourites and preferences. The library is shared.</p></div><Button variant="primary" className="min-h-11" onClick={() => open('add')}>Add user</Button></header>
    {users.isPending ? <Spinner /> : users.isError ? <p role="alert" className="text-sm text-rose-300">{errorText(users.error)}</p> : <div className="space-y-3">{all.map((user) => <article key={user.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.07]">
      <Avatar name={user.name} avatar={user.avatar} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words font-medium text-white">{user.name}</h2><Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role === 'admin' ? 'Admin' : 'Player'}</Badge>{user.id === 1 && <Badge>Owner</Badge>}{!!user.disabled && <Badge tone="amber">Disabled</Badge>}</div><p className="mt-1 break-words text-xs text-zinc-400">{user.username} · {user.games} {user.games === 1 ? 'game' : 'games'} · {user.saves} save {user.saves === 1 ? 'file' : 'files'} · Adult access: {user.adult_access ? 'Allowed' : 'Blocked'}</p>{user.role === 'admin' && <p className="mt-1 text-xs text-zinc-400">{user.admin_source === 'provider' ? 'Admin access set by the sign-in provider.' : user.admin_source === 'allowlist' ? 'Admin access granted by RENPLAY_ADMINS.' : 'Admin access set in Renplay.'}</p>}{(user.roleManaged || user.adultManaged) && <p className="mt-1 text-xs text-zinc-400">{user.roleManaged && user.adultManaged ? 'Role and adult access' : user.roleManaged ? 'Role' : 'Adult access'} set by the sign-in provider.</p>}{lastAdmin(user) && <p className="mt-1 text-xs text-zinc-400">Users cannot demote, disable or remove the last enabled admin. Provider sign-in can still revoke its grant.</p>}</div><Button className="min-h-11 min-w-11 px-2" aria-label={`Actions for ${user.name}`} onClick={() => setMenu(user)}>•••</Button>
    </article>)}</div>}
    <AccountSection title="Moving saves"><p className="text-sm text-zinc-400">Copy one game or all save folders between users. {historyNotice} Merging also combines progress and archives the source account.</p><div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={all.length < 2} onClick={() => open('copy')}>Copy saves…</Button><Button className="min-h-11" disabled={!all.length} onClick={() => open('import')}>Import a save folder</Button></div></AccountSection>
    <AccountSection title="Sign-in"><p className="text-sm text-zinc-300">{me?.auth ? 'Sign-in is on.' : `Sign-in is off. Everyone plays as ${me?.user.name || 'the owner'}. You can prepare accounts and move saves here before turning it on.`}</p><p className="text-sm text-zinc-400">Password sign-in: {providers.data ? providers.data.local ? 'On' : 'Off' : 'Loading'}. {providers.data?.oidc && `Single sign-on: ${providers.data.oidc}. `}{providers.data?.ldap && 'LDAP: On. '}New users are players unless an admin or provider rule grants access.</p><a className="inline-flex min-h-11 items-center text-sm text-accent-300 underline" href="https://renplay.org/docs/accounts/" target="_blank" rel="noreferrer">About accounts and sign-in</a></AccountSection>
    <Modal open={!!menu} onClose={() => setMenu(null)} title={menu ? `Actions for ${menu.name}` : 'User actions'}>
      {menu && <div className="space-y-3">
        <div className="grid gap-2"><Button className="min-h-11" onClick={() => open('edit', menu)}>Edit role and access</Button><Button className="min-h-11" onClick={() => open('password', menu)}>Reset password</Button><Button className="min-h-11" onClick={() => open('copy', menu)} disabled={all.length < 2}>Copy saves…</Button><a className="flex min-h-11 items-center justify-center rounded-xl bg-white/[0.07] text-sm text-zinc-200" href={`/api/users/${menu.id}/saves/export`}>Export save folder</a><Button className="min-h-11" onClick={() => open('import', menu)}>Import a save folder</Button><Button className="min-h-11" disabled={menu.protected || lastAdmin(menu)} onClick={() => open('merge', menu)}>Merge into another user…</Button><Button className="min-h-11" variant="danger" disabled={menu.protected || lastAdmin(menu)} onClick={() => open('remove', menu)}>Remove user…</Button></div>
        {menu.protected && <p className="text-sm text-zinc-400">The owner and the account used with sign-in off must stay. Their saves can still be copied.</p>}
        {lastAdmin(menu) && <p className="text-sm text-zinc-400">Keep at least one enabled admin. Users cannot demote, disable or remove this account. Provider sign-in can still revoke its grant.</p>}
      </div>}
    </Modal>
    <Modal open={!!dialog} onClose={() => !busy && setDialog(null)} title={dialog ? titles[dialog.action] : ''}>
      {dialog && <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault(); const form = new FormData(e.currentTarget), action = dialog.action, id = dialog.user?.id ?? Number(form.get('source'))
        void run(async () => {
          if (action === 'add') return post('/api/users', { username: form.get('username'), name: form.get('name'), password: form.get('password'), role: form.get('role'), adultAccess: form.get('adultAccess') === 'on' })
          if (action === 'edit') return put(`/api/users/${id}`, { ...(!dialog.user?.roleManaged ? { role: form.get('role') || dialog.user!.role } : {}), disabled: form.get('disabled') === 'on', ...(!dialog.user?.adultManaged ? { adultAccess: form.get('adultAccess') === 'on' } : {}) })
          if (action === 'password') return post(`/api/users/${id}/password`, { password: form.get('password') })
          if (action === 'remove') return del(`/api/users/${id}`)
          if (action === 'import') { const upload = new FormData(); upload.append('file', form.get('file')!); return api(`/api/users/${id}/saves/import`, { method: 'POST', body: upload }) }
          const target = Number(form.get('target'))
          if (target === id) throw new Error('Choose two different users.')
          return post(`/api/users/${id}/${action === 'merge' ? 'merge' : 'saves/copy'}`, { target, ...(form.get('game') ? { game: form.get('game') } : {}) })
        })
      }}>
        {dialog.user && <p className="break-words text-sm text-zinc-300">{dialog.user.name} ({dialog.user.username})</p>}
        {dialog.action === 'add' && <><label className="block text-sm text-zinc-300">Username<input name="username" required minLength={2} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{1,63}" autoCapitalize="none" autoComplete="off" className={accountInput} /></label><label className="block text-sm text-zinc-300">Display name<input name="name" required maxLength={100} className={accountInput} /></label></>}
        {(dialog.action === 'add' || dialog.action === 'password') && <><label className="block text-sm text-zinc-300">{dialog.action === 'password' ? 'New password' : 'Password'}<input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={1024} className={accountInput} /></label>{dialog.action === 'password' && <p className="text-sm text-zinc-400">All of this user’s sessions will end. Saves are kept.</p>}</>}
        {(dialog.action === 'add' || dialog.action === 'edit') && <>
          <label className="block text-sm text-zinc-300">Role<select aria-label="Role" name="role" defaultValue={dialog.user?.role || 'player'} disabled={!!dialog.user && (lastAdmin(dialog.user) || dialog.user.roleManaged)} className={`${accountInput} account-select`}><option value="player">Player</option><option value="admin">Admin</option></select></label>
          <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-300"><input name="adultAccess" type="checkbox" disabled={dialog.user?.adultManaged} defaultChecked={dialog.user ? !!dialog.user.adult_access : users.data?.adultDefault} className="size-5" />Allow adult games</label>
          {dialog.action === 'edit' && <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-300"><input name="disabled" type="checkbox" defaultChecked={!!dialog.user?.disabled} disabled={!!dialog.user && lastAdmin(dialog.user)} className="size-5" />Disabled</label>}
          {dialog.user && lastAdmin(dialog.user) && <p className="text-sm text-zinc-400">Users cannot demote or disable the last enabled admin. Provider sign-in can still revoke its grant.</p>}
          {(dialog.user?.roleManaged || dialog.user?.adultManaged) && <p className="text-sm text-zinc-400">Locked permissions are set by the sign-in provider at every sign-in.</p>}
          {!dialog.user?.roleManaged && <p className="text-sm text-zinc-400">Admin access saved here is kept when sign-in rules change or a sign-in is unlinked.</p>}
          <p className="text-xs text-zinc-400">Adult access cannot override a server that blocks adult games.</p>
        </>}
        {(['copy', 'import'].includes(dialog.action) && !dialog.user) && <label className="block text-sm text-zinc-300">{dialog.action === 'import' ? 'Import into' : 'From'}<select aria-label={dialog.action === 'import' ? 'Import into' : 'From'} name="source" required className={`${accountInput} account-select`}>{all.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select></label>}
        {(dialog.action === 'copy' || dialog.action === 'merge') && <><label className="block text-sm text-zinc-300">To<select aria-label="To" name="target" required defaultValue={destinations.find((u) => u.id !== (dialog.user?.id ?? all[0]?.id))?.id} className={`${accountInput} account-select`}>{destinations.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select></label>{dialog.action === 'copy' && <label className="block text-sm text-zinc-300">Game<select aria-label="Game" name="game" className={`${accountInput} account-select`}><option value="">All save folders</option>{games?.filter((g) => g.saveDir).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>}<p className="text-sm text-zinc-300">{historyNotice}</p></>}
        {dialog.action === 'import' && <><label className="block text-sm text-zinc-300">Save folder zip<input name="file" type="file" accept=".zip" required className={`${accountInput} py-3`} /></label><p className="text-sm text-zinc-400">Choose a whole save-folder export. {historyNotice}</p></>}
        {(dialog.action === 'merge' || dialog.action === 'remove') && <p className="text-sm text-zinc-300">{dialog.action === 'merge' ? 'Saves and progress are copied to the destination, then this account is removed.' : 'This account will be removed and can no longer sign in.'} Its saves and history move to the server’s users-removed archive folder, not the trash. {historyNotice}</p>}
        {dialog.action === 'edit' && dialog.user?.id === me?.user.id && <p className="text-sm text-amber-200">You are editing your own account. Disabling it or changing its role changes your access immediately.</p>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <Button className="min-h-11" type="submit" loading={busy} variant={dialog.action === 'remove' || dialog.action === 'merge' ? 'danger' : 'primary'}>{dialog.action === 'edit' ? 'Save changes' : titles[dialog.action]}</Button>
      </form>}
    </Modal>
  </div>
}
