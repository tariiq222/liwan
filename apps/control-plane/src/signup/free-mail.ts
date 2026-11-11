/**
 * Self-signup needs a business email (owner decision), so addresses at free consumer mail providers are refused.
 * Matching is on the exact domain, case-insensitively; a company subdomain or a look-alike is not a match.
 * This is the single list: add a provider here and nowhere else.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.co.jp', 'yahoo.com.au', 'yahoo.com.br', 'yahoo.ca', 'yahoo.de', 'yahoo.es', 'yahoo.fr', 'yahoo.it',
  'ymail.com', 'rocketmail.com',
  'outlook.com', 'outlook.sa', 'outlook.com.br', 'outlook.de', 'outlook.es', 'outlook.fr', 'outlook.it', 'outlook.jp',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.de', 'hotmail.es', 'hotmail.fr', 'hotmail.it', 'hotmail.com.br',
  'live.com', 'live.co.uk', 'live.de', 'live.fr', 'live.it', 'live.nl', 'msn.com', 'windowslive.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch', 'gmx.fr', 'web.de',
  'mail.com',
  'yandex.com', 'yandex.ru', 'yandex.ua', 'yandex.kz', 'yandex.by', 'ya.ru',
  'zoho.com', 'zohomail.com', 'zohomail.sa',
  'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru',
  'tutanota.com', 'tuta.com', 'tutamail.com', 'fastmail.com',
  'qq.com', '163.com', '126.com', 'sina.com',
  'maktoob.com',
])

const emailDomain = (email: string): string => email.slice(email.lastIndexOf('@') + 1).toLowerCase()

export const isFreeMailAddress = (email: string): boolean => FREE_MAIL_DOMAINS.has(emailDomain(email))
