require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const { SECRET_MESSAGE, USERNAME, PASSWORD } = process.env;

const missingVars = ['SECRET_MESSAGE', 'USERNAME', 'PASSWORD'].filter(
  (key) => !process.env[key]
);

if (missingVars.length > 0) {
  console.error(
    `Missing required environment variable(s): ${missingVars.join(', ')}. ` +
    'Please set them in your .env file.'
  );
  process.exit(1);
}

function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Secret Area"');
    return res.status(401).send('Authentication required.');
  }

  const base64Credentials = authHeader.slice('Basic '.length).trim();
  let decoded;
  try {
    decoded = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  } catch (err) {
    res.set('WWW-Authenticate', 'Basic realm="Secret Area"');
    return res.status(400).send('Malformed Authorization header.');
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    res.set('WWW-Authenticate', 'Basic realm="Secret Area"');
    return res.status(400).send('Malformed Authorization header.');
  }

  const providedUser = decoded.slice(0, separatorIndex);
  const providedPass = decoded.slice(separatorIndex + 1);

  if (providedUser === USERNAME && providedPass === PASSWORD) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Secret Area"');
  return res.status(401).send('Invalid username or password.');
}

app.get('/', (_, res) => {
  res.send('Hello, world!');
});

app.get('/secret', basicAuth, (_, res) => {
  res.send(SECRET_MESSAGE);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`  - Public route:    http://localhost:${PORT}/`);
  console.log(`  - Protected route: http://localhost:${PORT}/secret`);
});
