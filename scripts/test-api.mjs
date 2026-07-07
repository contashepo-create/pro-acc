fetch('https://pro-acc.vercel.app/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test@test.com', password: 'test123' }),
})
.then(r => r.json())
.then(d => { console.log('LOGIN:', JSON.stringify(d)); })
.catch(e => { console.log('ERROR:', e.message); });
