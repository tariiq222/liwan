import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const out = process.argv[2]
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto('http://localhost:3612/login', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000)
await p.getByLabel('اسم المستخدم').fill('admin'); await p.getByLabel('كلمة المرور').fill('admin'); await p.getByRole('button',{name:'دخول'}).click(); await p.waitForTimeout(5000)
await p.goto('http://localhost:3612/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(6000)
await p.screenshot({ path: out+'/product-home-1440.png', fullPage: true })
const m = await b.newPage({ viewport: { width: 1440, height: 900 } })
await m.goto('file:///Users/tariq/code/liwan-website/.mocks/dashboard-v2.html'); await m.waitForTimeout(2500)
await m.screenshot({ path: out+'/mock-home-1440.png', fullPage: true })
await b.close()
