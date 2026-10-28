import { test, expect } from '@playwright/test';

test('Vercel production opens account forms and uses PostgreSQL without platform blocks', async ({ page, request }) => {
 const errors: string[]=[];
 const failures: string[]=[];
 page.on('pageerror', error=>errors.push(error.message));
 page.on('console', message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('response', response=>{if(response.status()>=400)failures.push(response.url());});

 const response=await page.goto('/');
 expect(response?.status()).toBe(200);
 await expect(page).toHaveTitle('ANJEMIN — Mager? ANJEMIN Aja!');
 await expect(page.locator('#login-form')).toBeVisible({timeout:60000});
 await expect(page.locator('#app h1')).toContainText('ANJEMIN');
 await expect(page.locator('html')).not.toHaveClass(/app-booting/);
 await page.locator('[data-auth-tab="signup"]').first().click();
 await expect(page.locator('#signup-form')).toBeVisible();
 await expect(page.locator('#toast-area')).not.toContainText('Layanan akun belum tersedia');

 const config=await request.get('/api/config');
 expect(config.status()).toBe(200);
 const data=await config.json();
 expect(data).toMatchObject({brand:'ANJEMIN',mode:'production',paymentMode:'DISABLED'});
 expect(data).not.toHaveProperty('backendAvailable');
 const me=await request.get('/api/auth/me');
 expect(me.status()).toBe(200);
 expect(await me.json()).toEqual({user:null});
 expect(errors).toEqual([]);
 expect(failures).toEqual([]);

 const login=await request.post('/api/auth/login',{headers:{Origin:'http://localhost:3100'},data:{identifier:'missing',password:'invalid-password'}});
 expect(login.status()).toBe(401);
 expect(await login.json()).toMatchObject({error:'Email/username atau password salah.'});
});
