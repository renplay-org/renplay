import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, Clock, LogOut, Settings, User, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { post } from '../lib/api'
import Avatar from './Avatar'
import { Menu, errorText } from './ui'
import WhoIsPlaying from './WhoIsPlaying'

/** The avatar in the header: a small menu under it with your account, the admin's pages, and the way out. */
export default function AccountMenu() {
  const { data } = useAuth()
  const [error, setError] = useState('')
  const [switching, setSwitching] = useState(false)
  if (!data) return null
  const admin = data.user.role === 'admin'
  return (
    <>
      <Menu
        trigger={(toggle) => (
          <button aria-haspopup="true" aria-label={`Your account, ${data.user.name}`} onClick={toggle} className="avatar">
            <Avatar name={data.user.name} avatar={data.user.avatar} bare />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="row menu-who">
              <Avatar name={data.user.name} avatar={data.user.avatar} />
              <div className="grow">
                <div className="t">{data.user.name}</div>
                <div className="xs muted">{admin ? 'Admin' : 'Player'}</div>
              </div>
            </div>
            <Link to="/account" onClick={close}>
              <User /> Account
            </Link>
            {!admin && (
              <Link to="/settings" onClick={close}>
                <Settings /> This browser
              </Link>
            )}
            {admin && (
              <>
                <div className="sep" />
                <Link to="/settings" onClick={close}>
                  <Settings /> Settings
                </Link>
                <Link to="/settings/users" onClick={close}>
                  <Users /> Users
                </Link>
                <Link to="/activity" onClick={close}>
                  <Clock /> Activity
                </Link>
              </>
            )}
            {data.auth && (
              <>
                <div className="sep" />
                <button
                  type="button"
                  onClick={() => {
                    close()
                    setSwitching(true)
                  }}
                >
                  <ArrowLeftRight /> Who is playing?
                </button>
                <button
                  type="button"
                  className="d"
                  onClick={async () => {
                    try {
                      await post('/api/auth/logout')
                      window.location.assign('/signin')
                    } catch (e) {
                      setError(errorText(e))
                    }
                  }}
                >
                  <LogOut /> Sign out
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="red small" style={{ padding: '6px 10px' }}>
                {error}
              </p>
            )}
          </>
        )}
      </Menu>
      <WhoIsPlaying open={switching} onClose={() => setSwitching(false)} />
    </>
  )
}
