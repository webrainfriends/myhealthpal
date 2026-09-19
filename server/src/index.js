const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`MyHealthPal API listening on port ${config.port}`);
});
