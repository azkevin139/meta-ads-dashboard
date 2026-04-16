const express = require('express');
const { Readable, Writable } = require('stream');

async function invoke(app, { method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = new Readable({
    read() {
      this.push(null);
    },
  });
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.body = body;
  req.rawBody = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  req.socket = { remoteAddress: '127.0.0.1' };
  req.connection = req.socket;

  let payload = '';
  const res = new Writable({
    write(chunk, _encoding, callback) {
      payload += chunk.toString();
      callback();
    },
  });
  res.statusCode = 200;
  res.headers = {};
  res.locals = {};
  res.setHeader = (name, value) => { res.headers[String(name).toLowerCase()] = value; };
  res.getHeader = (name) => res.headers[String(name).toLowerCase()];
  res.removeHeader = (name) => { delete res.headers[String(name).toLowerCase()]; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (value) => {
    res.setHeader('Content-Type', 'application/json');
    payload = JSON.stringify(value);
    res.end();
    return res;
  };
  res.send = (value) => {
    payload = typeof value === 'string' ? value : JSON.stringify(value);
    res.end();
    return res;
  };

  await new Promise((resolve, reject) => {
    res.end = ((originalEnd) => function end(chunk, encoding, callback) {
      if (chunk) payload += chunk.toString();
      originalEnd.call(this, chunk, encoding, callback);
      resolve();
    })(Writable.prototype.end);
    app.handle(req, res, reject);
  });

  let json = null;
  try {
    json = payload ? JSON.parse(payload) : null;
  } catch (err) {
    json = null;
  }

  return {
    status: res.statusCode,
    headers: res.headers,
    text: payload,
    json,
  };
}

function makeJsonApp(router, beforeRoutes) {
  const app = express();
  if (beforeRoutes) app.use(beforeRoutes);
  app.use(router);
  return app;
}

function loadFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

module.exports = {
  invoke,
  makeJsonApp,
  loadFresh,
};
