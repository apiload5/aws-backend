const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 3000,
  path: '/api/health',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  console.log(`Health Check Status: ${res.statusCode}`);
  
  if (res.statusCode === 200) {
    console.log('✅ Backend is healthy');
    process.exit(0);
  } else {
    console.log('❌ Backend health check failed');
    process.exit(1);
  }
});

req.on('error', (error) => {
  console.error('❌ Health check error:', error.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('❌ Health check timeout');
  req.destroy();
  process.exit(1);
});

req.end();
