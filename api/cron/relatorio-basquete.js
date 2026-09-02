'use strict';

const { criarHandlerPorEsporte } = require('../../src/cronHandlerPorEsporte');

/**
 * GET /api/cron/relatorio-basquete
 * Protegido por CRON_SECRET (ver vercel.json).
 */
module.exports = criarHandlerPorEsporte(['basquete'], 'Basquete');
