'use strict';

const { criarHandlerPorEsporte } = require('../../src/cronHandlerPorEsporte');

/**
 * GET /api/cron/relatorio-beisebol
 * Protegido por CRON_SECRET (ver vercel.json).
 */
module.exports = criarHandlerPorEsporte(['beisebol'], 'Beisebol');
