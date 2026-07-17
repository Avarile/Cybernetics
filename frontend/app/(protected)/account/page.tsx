import { ChangePasswordCard } from '@/components/account/change-password-card'
import { SessionsCard } from '@/components/account/sessions-card'

export default function AccountPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Account</h1>
      <ChangePasswordCard />
      <SessionsCard />
    </div>
  )
}
