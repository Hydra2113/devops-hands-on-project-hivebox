const express = require('express');
const app = express();
const PORT = 3000;
const version = 'v0.0.1';


app.use(express.json())

while (true) {
    console.log(version);
}