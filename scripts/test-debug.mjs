fetch('https://pro-acc.vercel.app/api/debug')
  .then(r => r.json())
  .then(d => console.log(JSON.stringify(d, null, 2)))
  .catch(e => console.log('ERROR:', e.message));
