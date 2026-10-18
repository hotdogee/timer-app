/**
 * What the account UI needs from the app's auth state and sync controller: the parts of
 * `authStore` (`state/auth.svelte.ts`) and `remoteSync` (`sync/remote.svelte.ts`) it reads and
 * calls, as structural types, so tests and the screenshot harness can pass small fakes. Type-only
 * imports: nothing here loads those modules.
 */
import type { AuthStore } from '../../state/auth.svelte'
import type { RemoteSync, RemoteSyncStatus } from '../../sync/remote.svelte'

export type { AccountUser, AuthError, AuthStatus } from '../../state/auth.svelte'

/**
 * The auth state the account UI reads and the actions it calls. The actions resolve to whether
 * they worked and leave the reason in `error`; they never reject.
 */
export type AccountAuth = Pick<
  AuthStore,
  | 'status'
  | 'user'
  | 'providers'
  | 'error'
  | 'sendCode'
  | 'verifyCode'
  | 'signInWith'
  | 'signOut'
  | 'deleteAccount'
> &
  Partial<Pick<AuthStore, 'refresh'>>

/** The sync connection: off (signed out or stopped), connecting, online, or offline (retrying). */
export type SyncStatus = RemoteSyncStatus

/** The sync controller's state, as the account UI shows it. */
export type SyncInfo = Pick<RemoteSync, 'status' | 'lastSyncAt'>

/**
 * The device sign-in approval (`/device`): each call claims the code for the signed-in user and
 * then approves or denies it. They reject with the server's error (see `deviceErrorKind` in
 * `errors.ts`).
 */
export interface DeviceApprovalApi {
  approve(userCode: string): Promise<void>
  deny(userCode: string): Promise<void>
}
