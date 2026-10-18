import { afterEach, describe, expect, it } from 'vitest'

import { setAppLocale } from '../../i18n'
import { DELETE_CONFIRMATION_WORD, isDeleteConfirmed } from './delete'
import { PROVIDER_NAMES, continueWithLabel } from './providers'
import {
  CODE_LENGTH,
  CODE_LIFETIME_MINUTES,
  codeDigits,
  isCompleteCode,
  isEmailAddress,
} from './sign-in'

afterEach(() => {
  setAppLocale('en')
})

describe('isEmailAddress', () => {
  it('takes ordinary addresses, around spaces', () => {
    for (const address of ['a@b.co', 'first.last+tag@example.com', ' me@sub.example.org '])
      expect(isEmailAddress(address), address).toBe(true)
  })

  it('refuses slips', () => {
    for (const text of ['', 'me', 'me@', '@example.com', 'me@example', 'me @example.com', 'a@b..c'])
      expect(isEmailAddress(text), text).toBe(false)
  })
})

describe('the code', () => {
  it('keeps the digits of a typed or pasted code, at most six', () => {
    expect(CODE_LENGTH).toBe(6)
    expect(codeDigits('123 456')).toBe('123456')
    expect(codeDigits('123-456')).toBe('123456')
    expect(codeDigits('12a')).toBe('12')
    expect(codeDigits('1234567')).toBe('123456')
    expect(codeDigits('')).toBe('')
  })

  it('is whole at exactly six digits', () => {
    expect(isCompleteCode('123456')).toBe(true)
    expect(isCompleteCode('12345')).toBe(false)
    expect(isCompleteCode('12345a')).toBe(false)
  })

  it('lasts ten minutes', () => {
    expect(CODE_LIFETIME_MINUTES).toBe(10)
  })
})

describe('deleting the account', () => {
  it('asks for DELETE, in any case, around spaces', () => {
    expect(DELETE_CONFIRMATION_WORD).toBe('DELETE')
    expect(isDeleteConfirmed('DELETE')).toBe(true)
    expect(isDeleteConfirmed(' Delete ')).toBe(true)
    expect(isDeleteConfirmed('DELET')).toBe(false)
    expect(isDeleteConfirmed('DELETE IT')).toBe(false)
    expect(isDeleteConfirmed('')).toBe(false)
  })
})

describe('provider buttons', () => {
  it('name each provider by its brand in every language', () => {
    expect(PROVIDER_NAMES).toEqual({ google: 'Google', github: 'GitHub', apple: 'Apple' })
    expect(continueWithLabel('github')).toBe('Continue with GitHub')
    setAppLocale('zh-TW')
    expect(continueWithLabel('google')).toBe('使用 Google 繼續')
    setAppLocale('ja')
    expect(continueWithLabel('apple')).toBe('Apple で続ける')
  })
})
