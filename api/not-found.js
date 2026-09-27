"use strict";

const auth = require("./_admin-auth");

module.exports = function handler(_req, res) {
  return auth.notFound(res);
};
