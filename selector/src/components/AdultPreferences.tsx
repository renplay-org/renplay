import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { put } from '../lib/api'
import { useAuth } from '../lib/auth'
import { accountAdultPictures, adultPictureModes, useAdultPictures, type AdultPictures } from '../lib/prefs'
import { errorText, useToast } from './ui'

const labels = { show: 'Show', 'hide-pictures': 'Hide pictures', 'hide-games': 'Hide adult games' }
export const accountInput = 'mt-2 min-h-11 w-full min-w-0 rounded-xl bg-zinc-900 px-3 text-sm text-zinc-100 ring-1 ring-white/10'

export function DeviceAdultPreference() {
  const { data } = useAuth()
  const [mode, set, override] = useAdultPictures()
  const account = accountAdultPictures(data?.user.prefs)
  if (!data?.user.adult_access) return null
  return <label className="block text-sm text-zinc-300">On this device
    <select className={`${accountInput} account-select`} value={override ? mode : ''} onChange={(e) => set(e.target.value as AdultPictures | '')}>
      <option value="">Use account preference</option>
      {adultPictureModes.map((value, index) => <option key={value} value={value} disabled={index < adultPictureModes.indexOf(account)}>{labels[value]}</option>)}
    </select>
    <span className="mt-2 block text-xs text-zinc-400">This device can hide more, but never show more than your account allows.</span>
  </label>
}

export default function AdultPreferences() {
  const { data } = useAuth(), qc = useQueryClient(), toast = useToast()
  const [saving, setSaving] = useState(false)
  if (!data?.user.adult_access) return null
  return <div className="space-y-5">
    <label className="block text-sm text-zinc-300">For your account
      <select className={`${accountInput} account-select`} disabled={saving} value={accountAdultPictures(data.user.prefs)} onChange={async (e) => {
        setSaving(true)
        try { await put('/api/me/prefs', { adultPictures: e.target.value }); await qc.invalidateQueries() } catch (error) { toast(errorText(error), 'error') }
        finally { setSaving(false) }
      }}>{adultPictureModes.map((mode) => <option key={mode} value={mode}>{labels[mode]}</option>)}</select>
      <span className="mt-2 block text-xs text-zinc-400">Applies on every device. Hide pictures keeps game titles visible.</span>
    </label>
    <DeviceAdultPreference />
  </div>
}
