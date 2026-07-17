import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { REFRESH_COOKIE } from '@/lib/config/constants'
import { DEFAULT_AUTHED_PATH, LOGIN_PATH } from '@/lib/auth/route-policy'

/**
 * Root route ("/") has no page of its own in this app — it redirects based on
 * session presence: authenticated users land on the dashboard, everyone else on
 * the login page. Uses the same refresh-cookie + route constants the middleware
 * relies on, so the two never disagree.
 */
export default async function Page() {
  const authed = (await cookies()).has(REFRESH_COOKIE)
  redirect(authed ? DEFAULT_AUTHED_PATH : LOGIN_PATH)
}
