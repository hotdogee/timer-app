import { describe, expect, it, vi } from 'vitest'

import { createWebNotifier, type NotificationConstructorLike } from './notifications'

interface FakeNotificationClass extends NotificationConstructorLike {
  permission: NotificationPermission
  readonly created: FakeNotification[]
  /** What `requestPermission` answers, and how. */
  answer: NotificationPermission | Error
  style: 'promise' | 'callback'
  requests: number
}

interface FakeNotification {
  readonly title: string
  readonly options: NotificationOptions | undefined
  onclick: ((event: Event) => unknown) | null
  closes: number
  close(): void
}

/** A stand-in for the `Notification` constructor with scripted permission behavior. */
function fakeNotificationClass(permission: NotificationPermission): FakeNotificationClass {
  const created: FakeNotification[] = []
  const Fake = function (this: FakeNotification, title: string, options?: NotificationOptions) {
    const notification: FakeNotification = {
      title,
      options,
      onclick: null,
      closes: 0,
      close() {
        notification.closes += 1
      },
    }
    created.push(notification)
    return notification
  } as unknown as FakeNotificationClass
  Object.assign(Fake, {
    permission,
    created,
    answer: 'granted',
    style: 'promise',
    requests: 0,
    requestPermission(callback?: (permission: NotificationPermission) => void) {
      Fake.requests += 1
      const { answer } = Fake
      if (Fake.style === 'callback') {
        if (!(answer instanceof Error)) {
          Fake.permission = answer
          callback?.(answer)
        }
        return undefined
      }
      if (answer instanceof Error) return Promise.reject(answer)
      Fake.permission = answer
      return Promise.resolve(answer)
    },
  })
  return Fake
}

const request = { title: 'Tea', body: "Time's up", tag: 'card-1' }

describe('createWebNotifier', () => {
  describe('without the Notification API', () => {
    const notifier = createWebNotifier({ Notification: null })

    it('reports unsupported', () => {
      expect(notifier.supported).toBe(false)
      expect(notifier.permission()).toBe('unsupported')
    })

    it('resolves request() to false', async () => {
      await expect(notifier.request()).resolves.toBe(false)
    })

    it('shows nothing', () => {
      expect(notifier.show(request)).toBeNull()
    })
  })

  it('reads the permission fresh on every call', () => {
    const Fake = fakeNotificationClass('default')
    const notifier = createWebNotifier({ Notification: Fake })
    expect(notifier.supported).toBe(true)
    expect(notifier.permission()).toBe('default')
    Fake.permission = 'denied'
    expect(notifier.permission()).toBe('denied')
  })

  describe('request', () => {
    it('asks when undecided and resolves true when granted', async () => {
      const Fake = fakeNotificationClass('default')
      await expect(createWebNotifier({ Notification: Fake }).request()).resolves.toBe(true)
      expect(Fake.requests).toBe(1)
    })

    it('resolves false when the user declines', async () => {
      const Fake = fakeNotificationClass('default')
      Fake.answer = 'denied'
      await expect(createWebNotifier({ Notification: Fake }).request()).resolves.toBe(false)
    })

    it('does not ask again once decided', async () => {
      const granted = fakeNotificationClass('granted')
      const denied = fakeNotificationClass('denied')
      await expect(createWebNotifier({ Notification: granted }).request()).resolves.toBe(true)
      await expect(createWebNotifier({ Notification: denied }).request()).resolves.toBe(false)
      expect(granted.requests + denied.requests).toBe(0)
    })

    it('supports the old callback-only requestPermission', async () => {
      const Fake = fakeNotificationClass('default')
      Fake.style = 'callback'
      await expect(createWebNotifier({ Notification: Fake }).request()).resolves.toBe(true)
    })

    it('asks synchronously, inside the caller gesture', () => {
      const Fake = fakeNotificationClass('default')
      void createWebNotifier({ Notification: Fake }).request()
      expect(Fake.requests).toBe(1)
    })

    it('resolves false instead of rejecting when the browser throws', async () => {
      const Fake = fakeNotificationClass('default')
      Fake.answer = new Error('blocked')
      await expect(createWebNotifier({ Notification: Fake }).request()).resolves.toBe(false)
    })
  })

  describe('show', () => {
    it('shows nothing without permission', () => {
      for (const permission of ['default', 'denied'] as const) {
        const Fake = fakeNotificationClass(permission)
        expect(createWebNotifier({ Notification: Fake }).show(request)).toBeNull()
        expect(Fake.created).toHaveLength(0)
      }
    })

    it('shows the title, body and tag', () => {
      const Fake = fakeNotificationClass('granted')
      const handle = createWebNotifier({ Notification: Fake }).show(request)
      expect(handle).not.toBeNull()
      expect(Fake.created).toHaveLength(1)
      expect(Fake.created[0]?.title).toBe('Tea')
      expect(Fake.created[0]?.options).toEqual({
        body: "Time's up",
        tag: 'card-1',
        requireInteraction: false,
      })
    })

    it('passes requireInteraction through', () => {
      const Fake = fakeNotificationClass('granted')
      createWebNotifier({ Notification: Fake }).show({ ...request, requireInteraction: true })
      expect(Fake.created[0]?.options?.requireInteraction).toBe(true)
    })

    it('focuses the window, closes the notification and runs onClick when clicked', () => {
      const Fake = fakeNotificationClass('granted')
      const order: string[] = []
      const focus = vi.fn(() => order.push('focus'))
      const onClick = vi.fn(() => order.push('click'))
      createWebNotifier({ Notification: Fake, focus }).show({ ...request, onClick })
      const notification = Fake.created[0]
      notification?.onclick?.(new Event('click'))
      expect(order).toEqual(['focus', 'click'])
      expect(notification?.closes).toBe(1)
    })

    it('focuses the window on click even without onClick', () => {
      const Fake = fakeNotificationClass('granted')
      const focus = vi.fn()
      createWebNotifier({ Notification: Fake, focus }).show(request)
      Fake.created[0]?.onclick?.(new Event('click'))
      expect(focus).toHaveBeenCalledTimes(1)
    })

    it('closes once through the handle, however often close() is called', () => {
      const Fake = fakeNotificationClass('granted')
      const handle = createWebNotifier({ Notification: Fake }).show(request)
      handle?.close()
      handle?.close()
      Fake.created[0]?.onclick?.(new Event('click'))
      expect(Fake.created[0]?.closes).toBe(1)
    })

    it('swallows errors from closing a notification that is already gone', () => {
      const Fake = fakeNotificationClass('granted')
      const handle = createWebNotifier({ Notification: Fake }).show(request)
      const notification = Fake.created[0]
      if (notification) {
        notification.close = () => {
          throw new Error('gone')
        }
      }
      expect(() => handle?.close()).not.toThrow()
    })

    it('returns null when the constructor throws (Chrome on Android)', () => {
      const Throwing = Object.assign(
        function () {
          throw new TypeError('Illegal constructor')
        },
        { permission: 'granted', requestPermission: () => Promise.resolve('granted') },
      ) as unknown as NotificationConstructorLike
      expect(createWebNotifier({ Notification: Throwing }).show(request)).toBeNull()
    })
  })
})
