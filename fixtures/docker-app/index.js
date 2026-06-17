import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('Hello from docker-app'));
app.listen(3000);
