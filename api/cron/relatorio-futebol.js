'use strict';

const { criarHandlerPorEsporte } = require('../../src/cronHandlerPorEsporte');

/**
 * GET /api/cron/relatorio-futebol
 * Protegido por CRON_SECRET (ver vercel.json).
 */
module.exports = criarHandlerPorEsporte(['futebol'], 'Futebol');
