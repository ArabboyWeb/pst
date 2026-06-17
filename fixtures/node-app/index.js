import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Hello from node-app');
});

app.listen(port, () => {
  console.log(`Listening on ${port}`);
});
